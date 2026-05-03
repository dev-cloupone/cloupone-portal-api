import path from 'path';
import fs from 'fs';
import { eq, and, or, inArray, asc, between } from 'drizzle-orm';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require('pdfmake/js/Printer').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const UrlResolver = require('pdfmake/js/URLResolver').default;
import type { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces';
import { db } from '../db';
import { expenses, projectExpensePeriods, projectExpenseCategories, users, projects, clients } from '../db/schema';
import { AppError } from '../utils/app-error';

const fonts = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

const printer = new PdfPrinter(fonts, undefined, new UrlResolver());

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('pt-BR');
}

function formatCurrency(value: number): string {
  return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPeriod(weekStart: string, weekEnd: string): string {
  const s = new Date(weekStart + 'T00:00:00');
  const e = new Date(weekEnd + 'T00:00:00');
  return `${s.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} a ${e.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
}

export interface ExpenseReportFilters {
  projectId: string;
  weekIds: string[];
  consultantId?: string;
  view: 'client' | 'consultant';
}

interface ExpenseEntry {
  date: string;
  category: string;
  description: string;
  amount: number;
  consultantName: string;
}

interface ConsultantGroup {
  consultantId: string;
  consultantName: string;
  entries: ExpenseEntry[];
  subtotal: number;
}

interface WeekGroup {
  weekId: string;
  weekStart: string;
  weekEnd: string;
  consultants: ConsultantGroup[];
  weekTotal: number;
}

export interface ExpenseReportResult {
  project: { id: string; name: string; clientName: string };
  view: 'client' | 'consultant';
  weeks: WeekGroup[];
  grandTotal: number;
}

export async function getExpenseReportData(filters: ExpenseReportFilters): Promise<ExpenseReportResult> {
  // 1. Buscar projeto
  const [project] = await db
    .select({ id: projects.id, name: projects.name, clientName: clients.companyName })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(eq(projects.id, filters.projectId))
    .limit(1);
  if (!project) throw new AppError('Projeto não encontrado.', 404);

  // 2. Buscar períodos selecionados
  const periods = await db
    .select()
    .from(projectExpensePeriods)
    .where(and(
      eq(projectExpensePeriods.projectId, filters.projectId),
      inArray(projectExpensePeriods.id, filters.weekIds),
    ))
    .orderBy(asc(projectExpensePeriods.weekStart));

  if (periods.length === 0) throw new AppError('Nenhum período encontrado.', 404);

  // 3. Buscar todas as despesas aprovadas dos períodos em uma única query
  const dateConditions = periods.map((p) => between(expenses.date, p.weekStart, p.weekEnd));
  const baseConditions = [
    eq(expenses.projectId, filters.projectId),
    eq(expenses.status, 'approved'),
    or(...dateConditions)!,
  ];

  if (filters.consultantId) {
    baseConditions.push(eq(expenses.consultantUserId, filters.consultantId));
  }

  if (filters.view === 'consultant') {
    baseConditions.push(eq(expenses.requiresReimbursement, true));
  }

  const allEntries = await db
    .select({
      date: expenses.date,
      consultantUserId: expenses.consultantUserId,
      createdByUserId: expenses.createdByUserId,
      consultantName: users.name,
      categoryName: projectExpenseCategories.name,
      description: expenses.description,
      amount: expenses.amount,
      clientChargeAmount: expenses.clientChargeAmount,
    })
    .from(expenses)
    .leftJoin(users, eq(expenses.consultantUserId, users.id))
    .leftJoin(projectExpenseCategories, eq(expenses.expenseCategoryId, projectExpenseCategories.id))
    .where(and(...baseConditions))
    .orderBy(asc(users.name), asc(expenses.date));

  // Group entries by period in memory
  const weeks: WeekGroup[] = [];
  let grandTotal = 0;

  for (const period of periods) {
    const periodEntries = allEntries.filter(
      (e) => e.date >= period.weekStart && e.date <= period.weekEnd,
    );

    // Filter client view entries with clientChargeAmount > 0
    const filteredEntries = filters.view === 'client'
      ? periodEntries.filter((e) => Number(e.clientChargeAmount) > 0)
      : periodEntries;

    // Group by consultant
    const consultantMap = new Map<string, ConsultantGroup>();
    for (const e of filteredEntries) {
      const cId = e.consultantUserId || e.createdByUserId || 'unknown';
      const cName = e.consultantName || 'Sem consultor';
      const group = consultantMap.get(cId) || { consultantId: cId, consultantName: cName, entries: [], subtotal: 0 };

      const value = filters.view === 'client' ? Number(e.clientChargeAmount) : Number(e.amount);
      group.entries.push({
        date: e.date,
        category: e.categoryName || 'Sem categoria',
        description: e.description || '-',
        amount: value,
        consultantName: cName,
      });
      group.subtotal += value;
      consultantMap.set(cId, group);
    }

    const consultants = Array.from(consultantMap.values());
    const weekTotal = consultants.reduce((sum, c) => sum + c.subtotal, 0);
    grandTotal += weekTotal;

    weeks.push({
      weekId: period.id,
      weekStart: period.weekStart,
      weekEnd: period.weekEnd,
      consultants,
      weekTotal,
    });
  }

  return { project, view: filters.view, weeks, grandTotal };
}

export async function generateExpenseReportPdf(filters: ExpenseReportFilters): Promise<Buffer> {
  const data = await getExpenseReportData(filters);

  const periodRange = data.weeks.length > 0
    ? `${formatPeriod(data.weeks[0].weekStart, data.weeks[data.weeks.length - 1].weekEnd)}`
    : '';

  // Logo SVG (versão escura para PDF)
  const logoSvgPath = path.resolve(__dirname, '../assets/cloup-one-brand.svg');
  const logoSvg = fs.readFileSync(logoSvgPath, 'utf-8');

  const content: Content[] = [
    { svg: logoSvg, width: 140, margin: [0, 0, 0, 10] as [number, number, number, number] } as unknown as Content,
    { text: 'Relatório de Despesas', style: 'title' },
    { text: `Projeto: ${data.project.name} (${data.project.clientName})`, style: 'subtitle' },
    { text: `Visão: ${data.view === 'client' ? 'Cliente' : 'Consultor'} | Período: ${periodRange}`, style: 'subtitle' },
  ];

  for (const week of data.weeks) {
    content.push(
      { text: `Semana: ${formatPeriod(week.weekStart, week.weekEnd)}`, style: 'sectionTitle' },
    );

    for (const consultant of week.consultants) {
      content.push(
        { text: consultant.consultantName, style: 'consultantTitle' },
      );

      const tableBody: TableCell[][] = [
        [
          { text: 'Data', style: 'tableHeader' },
          { text: 'Categoria', style: 'tableHeader' },
          { text: 'Descrição', style: 'tableHeader' },
          { text: 'Valor', style: 'tableHeader', alignment: 'right' },
        ],
        ...consultant.entries.map((e) => [
          formatDate(e.date),
          e.category,
          e.description,
          { text: formatCurrency(e.amount), alignment: 'right' as const },
        ]),
        [
          { text: '', colSpan: 2 }, {},
          { text: `Subtotal ${consultant.consultantName}`, bold: true },
          { text: formatCurrency(consultant.subtotal), bold: true, alignment: 'right' as const },
        ],
      ];

      content.push({
        table: {
          headerRows: 1,
          widths: [55, 80, '*', 75],
          body: tableBody,
        },
        layout: 'lightHorizontalLines',
        margin: [0, 0, 0, 8] as [number, number, number, number],
      });
    }

    // Week total
    content.push({
      columns: [
        { text: `Total da Semana`, bold: true, width: '*' },
        { text: formatCurrency(week.weekTotal), bold: true, width: 100, alignment: 'right' },
      ],
      margin: [0, 2, 0, 10] as [number, number, number, number],
    });
  }

  // Grand total
  content.push(
    {
      canvas: [{ type: 'line', x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 2 }],
      margin: [0, 5, 0, 5] as [number, number, number, number],
    },
    {
      columns: [
        { text: 'TOTAL GERAL', bold: true, fontSize: 12, width: '*' },
        { text: formatCurrency(data.grandTotal), bold: true, fontSize: 12, width: 120, alignment: 'right' },
      ],
    },
  );

  const now = new Date();
  const generatedAt = `Gerado em ${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

  const docDefinition: TDocumentDefinitions = {
    defaultStyle: { font: 'Helvetica', fontSize: 9 },
    pageSize: 'A4',
    pageMargins: [40, 60, 40, 60],
    content,
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: generatedAt, fontSize: 7, color: '#999', margin: [40, 0, 0, 0] },
        { text: `Página ${currentPage} de ${pageCount}`, fontSize: 7, color: '#999', alignment: 'right', margin: [0, 0, 40, 0] },
      ],
      margin: [0, 20, 0, 0] as [number, number, number, number],
    }),
    styles: {
      brand: { fontSize: 14, bold: true, color: '#10b981', margin: [0, 0, 0, 5] },
      title: { fontSize: 16, bold: true, margin: [0, 0, 0, 5] },
      subtitle: { fontSize: 10, color: '#666', margin: [0, 0, 0, 3] },
      sectionTitle: { fontSize: 11, bold: true, margin: [0, 15, 0, 8], color: '#333' },
      consultantTitle: { fontSize: 9, bold: true, margin: [0, 4, 0, 2], color: '#555' },
      tableHeader: { bold: true, fontSize: 8, fillColor: '#f0f0f0' },
    },
  };

  return pdfToBuffer(docDefinition);
}

async function pdfToBuffer(docDefinition: TDocumentDefinitions): Promise<Buffer> {
  const pdfDoc = await printer.createPdfKitDocument(docDefinition);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
    pdfDoc.on('error', reject);
    pdfDoc.end();
  });
}
