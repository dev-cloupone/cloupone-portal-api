import { eq, and, between, sql, sum } from 'drizzle-orm';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require('pdfmake/js/Printer').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const UrlResolver = require('pdfmake/js/URLResolver').default;
import type { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces';
import { db } from '../db';
import { timeEntries, projects, clients, users, consultantProfiles, activityCategories, tickets, expenses, expenseCategories } from '../db/schema';
import { AppError } from '../utils/app-error';

const MSG = {
  CLIENT_NOT_FOUND: 'Cliente nao encontrado.',
  NO_DATA: 'Nenhum dado encontrado para o periodo selecionado.',
  INVALID_DATES: 'Datas de inicio e fim sao obrigatorias.',
} as const;

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

function formatMonthYear(from: string, to: string): string {
  const fromDate = new Date(from + 'T00:00:00');
  const toDate = new Date(to + 'T00:00:00');
  const fromStr = fromDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const toStr = toDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${fromStr} a ${toStr}`;
}

// --- Client Report (for billing) ---

interface ClientReportEntry {
  date: string;
  consultantName: string | null;
  activityName: string | null;
  description: string | null;
  hours: string;
}

export async function getClientReportData(clientId: string, from: string, to: string) {
  if (!from || !to) throw new AppError(MSG.INVALID_DATES, 400);

  // Verify client exists
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new AppError(MSG.CLIENT_NOT_FOUND, 404);

  const entries = await db
    .select({
      date: timeEntries.date,
      consultantName: users.name,
      activityName: activityCategories.name,
      description: timeEntries.description,
      hours: timeEntries.hours,
      projectName: projects.name,
      billingRate: projects.billingRate,
    })
    .from(timeEntries)
    .innerJoin(projects, eq(timeEntries.projectId, projects.id))
    .innerJoin(users, eq(timeEntries.userId, users.id))
    .leftJoin(activityCategories, eq(timeEntries.categoryId, activityCategories.id))
    .where(and(
      eq(projects.clientId, clientId),
      sql`EXISTS (SELECT 1 FROM monthly_timesheets mt WHERE mt.user_id = ${timeEntries.userId} AND mt.year = EXTRACT(YEAR FROM ${timeEntries.date})::integer AND mt.month = EXTRACT(MONTH FROM ${timeEntries.date})::integer AND mt.status = 'approved')`,
      between(timeEntries.date, from, to),
    ))
    .orderBy(timeEntries.date, users.name);

  const totalHours = entries.reduce((sum, e) => sum + Number(e.hours), 0);

  // Group by project for totals
  const projectTotals = new Map<string, { hours: number; rate: number }>();
  for (const entry of entries) {
    const existing = projectTotals.get(entry.projectName) || { hours: 0, rate: Number(entry.billingRate) };
    existing.hours += Number(entry.hours);
    projectTotals.set(entry.projectName, existing);
  }

  let totalValue = 0;
  const projectSummary = Array.from(projectTotals.entries()).map(([name, data]) => {
    const value = data.hours * data.rate;
    totalValue += value;
    return { projectName: name, hours: data.hours, rate: data.rate, value };
  });

  return { client, entries, totalHours, totalValue, projectSummary };
}

export async function generateClientPdf(clientId: string, from: string, to: string): Promise<Buffer> {
  const data = await getClientReportData(clientId, from, to);
  const expenseEntries = await getClientReportExpenses(clientId, from, to);

  if (data.entries.length === 0 && expenseEntries.length === 0) throw new AppError(MSG.NO_DATA, 404);

  const tableBody: TableCell[][] = [
    [
      { text: 'Data', style: 'tableHeader' },
      { text: 'Consultor', style: 'tableHeader' },
      { text: 'Atividade', style: 'tableHeader' },
      { text: 'Descricao', style: 'tableHeader' },
      { text: 'Horas', style: 'tableHeader', alignment: 'right' },
    ],
    ...data.entries.map((e) => [
      formatDate(e.date),
      e.consultantName || '-',
      e.activityName || '-',
      e.description || '-',
      { text: Number(e.hours).toFixed(1), alignment: 'right' as const },
    ]),
  ];

  const projectRows: Content[] = data.projectSummary.map((p) => ({
    columns: [
      { text: p.projectName, width: '*' },
      { text: `${p.hours.toFixed(1)}h`, width: 60, alignment: 'right' as const },
      { text: `R$ ${p.rate.toFixed(2)}/h`, width: 80, alignment: 'right' as const },
      { text: `R$ ${p.value.toFixed(2)}`, width: 80, alignment: 'right' as const },
    ],
    margin: [0, 2, 0, 2] as [number, number, number, number],
  }));

  const contentBlocks: Content[] = [
    { text: 'CLOUPONE', style: 'brand' },
    { text: `Relatorio de Horas - ${data.client.companyName}`, style: 'title' },
    { text: `Periodo: ${formatMonthYear(from, to)}`, style: 'subtitle' },
  ];

  if (data.entries.length > 0) {
    contentBlocks.push(
      { text: ' ', margin: [0, 10, 0, 0] },
      {
        table: {
          headerRows: 1,
          widths: [60, 80, 70, '*', 40],
          body: tableBody,
        },
        layout: 'lightHorizontalLines',
      },
      { text: ' ', margin: [0, 15, 0, 0] },
      { text: 'Resumo por Projeto', style: 'sectionTitle' },
      ...projectRows,
      {
        canvas: [{ type: 'line', x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 1 }],
        margin: [0, 10, 0, 5] as [number, number, number, number],
      },
      {
        columns: [
          { text: 'TOTAL HORAS', bold: true, width: '*' },
          { text: `${data.totalHours.toFixed(1)}h`, bold: true, width: 60, alignment: 'right' },
          { text: '', width: 80 },
          { text: `R$ ${data.totalValue.toFixed(2)}`, bold: true, width: 80, alignment: 'right' },
        ],
      },
    );
  }

  // Expenses section
  if (expenseEntries.length > 0) {
    const expenseTotal = expenseEntries.reduce((s, e) => s + Number(e.amount), 0);

    contentBlocks.push(
      { text: ' ', margin: [0, 15, 0, 0] },
      { text: 'DESPESAS', style: 'sectionTitle' },
      {
        table: {
          headerRows: 1,
          widths: [55, 75, 65, '*', 60],
          body: [
            [
              { text: 'Data', style: 'tableHeader' },
              { text: 'Consultor', style: 'tableHeader' },
              { text: 'Categoria', style: 'tableHeader' },
              { text: 'Descricao', style: 'tableHeader' },
              { text: 'Valor', style: 'tableHeader', alignment: 'right' },
            ],
            ...expenseEntries.map((e) => [
              formatDate(e.date),
              e.consultantName || '-',
              e.categoryName || '-',
              e.description,
              { text: `R$ ${Number(e.amount).toFixed(2)}`, alignment: 'right' as const },
            ]),
          ],
        },
        layout: 'lightHorizontalLines',
        margin: [0, 0, 0, 5] as [number, number, number, number],
      },
      {
        columns: [
          { text: 'TOTAL DESPESAS', bold: true, width: '*' },
          { text: `R$ ${expenseTotal.toFixed(2)}`, bold: true, width: 80, alignment: 'right' },
        ],
      },
    );

    // Grand total (hours + expenses)
    const grandTotal = data.totalValue + expenseTotal;
    contentBlocks.push(
      {
        canvas: [{ type: 'line', x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 2 }],
        margin: [0, 10, 0, 5] as [number, number, number, number],
      },
      {
        columns: [
          { text: 'TOTAL GERAL (Horas + Despesas)', bold: true, fontSize: 11, width: '*' },
          { text: `R$ ${grandTotal.toFixed(2)}`, bold: true, fontSize: 11, width: 100, alignment: 'right' },
        ],
      },
    );
  }

  const docDefinition: TDocumentDefinitions = {
    defaultStyle: { font: 'Helvetica', fontSize: 9 },
    pageSize: 'A4',
    pageMargins: [40, 60, 40, 60],
    content: contentBlocks,
    styles: {
      brand: { fontSize: 14, bold: true, color: '#10b981', margin: [0, 0, 0, 5] },
      title: { fontSize: 16, bold: true, margin: [0, 0, 0, 5] },
      subtitle: { fontSize: 10, color: '#666', margin: [0, 0, 0, 10] },
      sectionTitle: { fontSize: 11, bold: true, margin: [0, 0, 0, 8] },
      tableHeader: { bold: true, fontSize: 8, fillColor: '#f0f0f0' },
    },
  };

  return pdfToBuffer(docDefinition);
}

// --- Billing Report ---

export async function generateBillingPdf(from: string, to: string): Promise<Buffer> {
  if (!from || !to) throw new AppError(MSG.INVALID_DATES, 400);

  const entries = await db
    .select({
      clientName: clients.companyName,
      projectName: projects.name,
      billingRate: projects.billingRate,
      hours: sum(timeEntries.hours),
    })
    .from(timeEntries)
    .innerJoin(projects, eq(timeEntries.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(and(
      sql`EXISTS (SELECT 1 FROM monthly_timesheets mt WHERE mt.user_id = ${timeEntries.userId} AND mt.year = EXTRACT(YEAR FROM ${timeEntries.date})::integer AND mt.month = EXTRACT(MONTH FROM ${timeEntries.date})::integer AND mt.status = 'approved')`,
      between(timeEntries.date, from, to),
    ))
    .groupBy(clients.companyName, projects.name, projects.billingRate)
    .orderBy(clients.companyName, projects.name);

  // Expense totals by client
  const expenseRows = await db
    .select({
      clientName: clients.companyName,
      totalExpenses: sum(expenses.amount),
    })
    .from(expenses)
    .innerJoin(projects, eq(expenses.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(and(
      eq(expenses.status, 'approved'),
      between(expenses.date, from, to),
    ))
    .groupBy(clients.companyName);

  const expenseByClient = new Map<string, number>();
  for (const e of expenseRows) {
    expenseByClient.set(e.clientName, Number(e.totalExpenses));
  }

  if (entries.length === 0 && expenseRows.length === 0) throw new AppError(MSG.NO_DATA, 404);

  // Group by client
  const byClient = new Map<string, Array<{ projectName: string; hours: number; rate: number; value: number }>>();
  for (const e of entries) {
    const hours = Number(e.hours);
    const rate = Number(e.billingRate);
    const list = byClient.get(e.clientName) || [];
    list.push({ projectName: e.projectName, hours, rate, value: hours * rate });
    byClient.set(e.clientName, list);
  }

  // Ensure clients with only expenses appear
  for (const clientName of expenseByClient.keys()) {
    if (!byClient.has(clientName)) byClient.set(clientName, []);
  }

  const content: Content[] = [
    { text: 'CLOUPONE', style: 'brand' },
    { text: 'Relatorio de Faturamento', style: 'title' },
    { text: `Periodo: ${formatMonthYear(from, to)}`, style: 'subtitle' },
  ];

  let grandTotal = 0;
  let grandHours = 0;
  let grandExpenses = 0;

  for (const [clientName, projectList] of byClient) {
    const clientHoursTotal = projectList.reduce((s, p) => s + p.value, 0);
    const clientHours = projectList.reduce((s, p) => s + p.hours, 0);
    const clientExpenses = expenseByClient.get(clientName) || 0;
    const clientTotal = clientHoursTotal + clientExpenses;
    grandTotal += clientTotal;
    grandHours += clientHours;
    grandExpenses += clientExpenses;

    content.push(
      { text: clientName, style: 'sectionTitle' },
    );

    if (projectList.length > 0) {
      content.push({
        table: {
          headerRows: 1,
          widths: ['*', 50, 70, 70],
          body: [
            [
              { text: 'Projeto', style: 'tableHeader' },
              { text: 'Horas', style: 'tableHeader', alignment: 'right' },
              { text: 'Taxa/h', style: 'tableHeader', alignment: 'right' },
              { text: 'Valor', style: 'tableHeader', alignment: 'right' },
            ],
            ...projectList.map((p) => [
              p.projectName,
              { text: p.hours.toFixed(1), alignment: 'right' as const },
              { text: `R$ ${p.rate.toFixed(2)}`, alignment: 'right' as const },
              { text: `R$ ${p.value.toFixed(2)}`, alignment: 'right' as const },
            ]),
          ],
        },
        layout: 'lightHorizontalLines',
        margin: [0, 0, 0, 5] as [number, number, number, number],
      });
    }

    // Per-client subtotal with expenses
    const subtotalParts: string[] = [];
    if (clientHoursTotal > 0) subtotalParts.push(`Horas: R$ ${clientHoursTotal.toFixed(2)}`);
    if (clientExpenses > 0) subtotalParts.push(`Despesas: R$ ${clientExpenses.toFixed(2)}`);

    content.push({
      columns: [
        { text: `Subtotal - ${clientName}`, bold: true, width: '*' },
        { text: subtotalParts.join(' | '), fontSize: 8, color: '#444', width: 200, alignment: 'right' as const },
        { text: `R$ ${clientTotal.toFixed(2)}`, bold: true, width: 80, alignment: 'right' as const },
      ],
      margin: [0, 2, 0, 15] as [number, number, number, number],
    });
  }

  content.push(
    {
      canvas: [{ type: 'line', x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 2 }],
      margin: [0, 5, 0, 5] as [number, number, number, number],
    },
    {
      columns: [
        { text: 'TOTAL GERAL', bold: true, fontSize: 12, width: '*' },
        { text: `${grandHours.toFixed(1)}h`, bold: true, fontSize: 12, width: 60, alignment: 'right' },
        { text: `R$ ${grandTotal.toFixed(2)}`, bold: true, fontSize: 12, width: 80, alignment: 'right' },
      ],
    },
  );

  if (grandExpenses > 0) {
    content.push({
      text: `Horas: R$ ${(grandTotal - grandExpenses).toFixed(2)} | Despesas: R$ ${grandExpenses.toFixed(2)}`,
      fontSize: 8,
      color: '#444',
      margin: [0, 3, 0, 0] as [number, number, number, number],
    });
  }

  const docDefinition: TDocumentDefinitions = {
    defaultStyle: { font: 'Helvetica', fontSize: 9 },
    pageSize: 'A4',
    pageMargins: [40, 60, 40, 60],
    content,
    styles: {
      brand: { fontSize: 14, bold: true, color: '#10b981', margin: [0, 0, 0, 5] },
      title: { fontSize: 16, bold: true, margin: [0, 0, 0, 5] },
      subtitle: { fontSize: 10, color: '#666', margin: [0, 0, 0, 15] },
      sectionTitle: { fontSize: 11, bold: true, margin: [0, 10, 0, 5] },
      tableHeader: { bold: true, fontSize: 8, fillColor: '#f0f0f0' },
    },
  };

  return pdfToBuffer(docDefinition);
}

// --- Payroll Report ---

export async function generatePayrollPdf(from: string, to: string): Promise<Buffer> {
  if (!from || !to) throw new AppError(MSG.INVALID_DATES, 400);

  const entries = await db
    .select({
      consultantName: users.name,
      projectName: projects.name,
      hourlyRate: consultantProfiles.hourlyRate,
      contractType: consultantProfiles.contractType,
      hours: sum(timeEntries.hours),
    })
    .from(timeEntries)
    .innerJoin(users, eq(timeEntries.userId, users.id))
    .innerJoin(consultantProfiles, eq(timeEntries.userId, consultantProfiles.userId))
    .innerJoin(projects, eq(timeEntries.projectId, projects.id))
    .where(and(
      sql`EXISTS (SELECT 1 FROM monthly_timesheets mt WHERE mt.user_id = ${timeEntries.userId} AND mt.year = EXTRACT(YEAR FROM ${timeEntries.date})::integer AND mt.month = EXTRACT(MONTH FROM ${timeEntries.date})::integer AND mt.status = 'approved')`,
      between(timeEntries.date, from, to),
    ))
    .groupBy(users.name, projects.name, consultantProfiles.hourlyRate, consultantProfiles.contractType)
    .orderBy(users.name, projects.name);

  if (entries.length === 0) throw new AppError(MSG.NO_DATA, 404);

  // Group by consultant
  const byConsultant = new Map<string, { contractType: string; projects: Array<{ projectName: string; hours: number; rate: number; value: number }> }>();
  for (const e of entries) {
    const hours = Number(e.hours);
    const rate = Number(e.hourlyRate);
    const existing = byConsultant.get(e.consultantName) || { contractType: e.contractType, projects: [] };
    existing.projects.push({ projectName: e.projectName, hours, rate, value: hours * rate });
    byConsultant.set(e.consultantName, existing);
  }

  const content: Content[] = [
    { text: 'CLOUPONE', style: 'brand' },
    { text: 'Relatorio de Pagamento de Consultores', style: 'title' },
    { text: `Periodo: ${formatMonthYear(from, to)}`, style: 'subtitle' },
  ];

  let grandTotal = 0;
  let grandHours = 0;

  for (const [consultantName, data] of byConsultant) {
    const consultantTotal = data.projects.reduce((s, p) => s + p.value, 0);
    const consultantHours = data.projects.reduce((s, p) => s + p.hours, 0);
    grandTotal += consultantTotal;
    grandHours += consultantHours;

    const contractLabel = data.contractType.toUpperCase();

    content.push(
      { text: `${consultantName} (${contractLabel})`, style: 'sectionTitle' },
      {
        table: {
          headerRows: 1,
          widths: ['*', 50, 70, 70],
          body: [
            [
              { text: 'Projeto', style: 'tableHeader' },
              { text: 'Horas', style: 'tableHeader', alignment: 'right' },
              { text: 'Taxa/h', style: 'tableHeader', alignment: 'right' },
              { text: 'Valor', style: 'tableHeader', alignment: 'right' },
            ],
            ...data.projects.map((p) => [
              p.projectName,
              { text: p.hours.toFixed(1), alignment: 'right' as const },
              { text: `R$ ${p.rate.toFixed(2)}`, alignment: 'right' as const },
              { text: `R$ ${p.value.toFixed(2)}`, alignment: 'right' as const },
            ]),
            [
              { text: `Subtotal - ${consultantName}`, bold: true, colSpan: 2 },
              {},
              {},
              { text: `R$ ${consultantTotal.toFixed(2)}`, bold: true, alignment: 'right' as const },
            ],
          ],
        },
        layout: 'lightHorizontalLines',
        margin: [0, 0, 0, 15] as [number, number, number, number],
      },
    );
  }

  content.push(
    {
      canvas: [{ type: 'line', x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 2 }],
      margin: [0, 5, 0, 5] as [number, number, number, number],
    },
    {
      columns: [
        { text: 'TOTAL GERAL', bold: true, fontSize: 12, width: '*' },
        { text: `${grandHours.toFixed(1)}h`, bold: true, fontSize: 12, width: 60, alignment: 'right' },
        { text: `R$ ${grandTotal.toFixed(2)}`, bold: true, fontSize: 12, width: 80, alignment: 'right' },
      ],
    },
  );

  const docDefinition: TDocumentDefinitions = {
    defaultStyle: { font: 'Helvetica', fontSize: 9 },
    pageSize: 'A4',
    pageMargins: [40, 60, 40, 60],
    content,
    styles: {
      brand: { fontSize: 14, bold: true, color: '#10b981', margin: [0, 0, 0, 5] },
      title: { fontSize: 16, bold: true, margin: [0, 0, 0, 5] },
      subtitle: { fontSize: 10, color: '#666', margin: [0, 0, 0, 15] },
      sectionTitle: { fontSize: 11, bold: true, margin: [0, 10, 0, 5] },
      tableHeader: { bold: true, fontSize: 8, fillColor: '#f0f0f0' },
    },
  };

  return pdfToBuffer(docDefinition);
}

// --- Client Excel (CSV) ---

export async function generateClientCsv(clientId: string, from: string, to: string): Promise<string> {
  const data = await getClientReportData(clientId, from, to);
  const expenseEntries = await getClientReportExpenses(clientId, from, to);

  if (data.entries.length === 0 && expenseEntries.length === 0) throw new AppError(MSG.NO_DATA, 404);

  const lines: string[] = [];

  // Hours section
  lines.push('Horas');
  lines.push('Data;Consultor;Atividade;Descricao;Horas');
  for (const e of data.entries) {
    lines.push([
      formatDate(e.date),
      e.consultantName || '',
      e.activityName || '',
      `"${(e.description || '').replace(/"/g, '""')}"`,
      Number(e.hours).toFixed(1),
    ].join(';'));
  }
  lines.push(`Total Horas;${data.totalHours.toFixed(1)}`);
  lines.push(`Total Valor Horas;R$ ${data.totalValue.toFixed(2)}`);
  lines.push('');

  // Project summary
  lines.push('Resumo por Projeto');
  lines.push('Projeto;Horas;Taxa/h;Valor');
  for (const p of data.projectSummary) {
    lines.push([p.projectName, p.hours.toFixed(1), p.rate.toFixed(2), p.value.toFixed(2)].join(';'));
  }

  // Expenses section
  if (expenseEntries.length > 0) {
    const expenseTotal = expenseEntries.reduce((s, e) => s + Number(e.amount), 0);
    lines.push('');
    lines.push('Despesas');
    lines.push('Data;Consultor;Categoria;Descricao;Valor');
    for (const e of expenseEntries) {
      lines.push([
        formatDate(e.date),
        e.consultantName || '',
        e.categoryName || '',
        `"${e.description.replace(/"/g, '""')}"`,
        Number(e.amount).toFixed(2),
      ].join(';'));
    }
    lines.push(`Total Despesas;R$ ${expenseTotal.toFixed(2)}`);
    lines.push('');
    lines.push(`Total Geral (Horas + Despesas);R$ ${(data.totalValue + expenseTotal).toFixed(2)}`);
  }

  return lines.join('\n');
}

// --- Consultant Report ---

interface ConsultantReportEntry {
  date: string;
  projectName: string;
  billingRate: string;
  activityName: string | null;
  isBillable: boolean;
  ticketCode: string | null;
  ticketTitle: string | null;
  ticketType: string | null;
  hours: string;
  description: string | null;
}

interface ConsultantTicketSummary {
  ticketCode: string;
  ticketTitle: string;
  ticketType: string;
  estimatedHours: number | null;
  actualHours: number;
}

interface ConsultantProjectSummary {
  projectName: string;
  billingRate: number;
  totalHours: number;
  billableHours: number;
  nonBillableHours: number;
  totalValue: number;
  tickets: ConsultantTicketSummary[];
}

interface ConsultantReportData {
  consultant: {
    id: string;
    name: string;
    email: string;
    contractType: string;
    hourlyRate: string;
  };
  entries: ConsultantReportEntry[];
  projectSummary: ConsultantProjectSummary[];
  totalHours: number;
  totalBillableHours: number;
  totalNonBillableHours: number;
  totalValue: number;
}

export async function getConsultantReportData(
  consultantUserId: string, from: string, to: string
): Promise<ConsultantReportData> {
  if (!from || !to) throw new AppError(MSG.INVALID_DATES, 400);

  // Find consultant profile
  const [profile] = await db
    .select({
      id: consultantProfiles.id,
      userId: consultantProfiles.userId,
      hourlyRate: consultantProfiles.hourlyRate,
      contractType: consultantProfiles.contractType,
      name: users.name,
      email: users.email,
    })
    .from(consultantProfiles)
    .innerJoin(users, eq(consultantProfiles.userId, users.id))
    .where(eq(consultantProfiles.userId, consultantUserId))
    .limit(1);

  if (!profile) throw new AppError('Consultor nao encontrado.', 404);

  // Query time entries with project, activity, and ticket info
  const entries = await db
    .select({
      date: timeEntries.date,
      projectName: projects.name,
      billingRate: projects.billingRate,
      activityName: activityCategories.name,
      isBillable: activityCategories.isBillable,
      ticketCode: tickets.code,
      ticketTitle: tickets.title,
      ticketType: tickets.type,
      ticketEstimatedHours: tickets.estimatedHours,
      hours: timeEntries.hours,
      description: timeEntries.description,
      ticketId: timeEntries.ticketId,
    })
    .from(timeEntries)
    .innerJoin(projects, eq(timeEntries.projectId, projects.id))
    .leftJoin(activityCategories, eq(timeEntries.categoryId, activityCategories.id))
    .leftJoin(tickets, eq(timeEntries.ticketId, tickets.id))
    .where(and(
      eq(timeEntries.userId, consultantUserId),
      sql`EXISTS (SELECT 1 FROM monthly_timesheets mt WHERE mt.user_id = ${timeEntries.userId} AND mt.year = EXTRACT(YEAR FROM ${timeEntries.date})::integer AND mt.month = EXTRACT(MONTH FROM ${timeEntries.date})::integer AND mt.status = 'approved')`,
      between(timeEntries.date, from, to),
    ))
    .orderBy(projects.name, tickets.code, timeEntries.date);

  // Aggregate by project
  const projectMap = new Map<string, {
    billingRate: number;
    totalHours: number;
    billableHours: number;
    nonBillableHours: number;
    ticketMap: Map<string, ConsultantTicketSummary>;
  }>();

  for (const e of entries) {
    const hours = Number(e.hours);
    const billable = e.isBillable !== false; // default true if no category
    const existing = projectMap.get(e.projectName) || {
      billingRate: Number(e.billingRate),
      totalHours: 0,
      billableHours: 0,
      nonBillableHours: 0,
      ticketMap: new Map(),
    };

    existing.totalHours += hours;
    if (billable) existing.billableHours += hours;
    else existing.nonBillableHours += hours;

    // Track ticket hours
    if (e.ticketCode && e.ticketId) {
      const ticketKey = e.ticketCode;
      const ticketEntry = existing.ticketMap.get(ticketKey) || {
        ticketCode: e.ticketCode,
        ticketTitle: e.ticketTitle || '',
        ticketType: e.ticketType || '',
        estimatedHours: e.ticketEstimatedHours ? Number(e.ticketEstimatedHours) : null,
        actualHours: 0,
      };
      ticketEntry.actualHours += hours;
      existing.ticketMap.set(ticketKey, ticketEntry);
    }

    projectMap.set(e.projectName, existing);
  }

  let totalHours = 0;
  let totalBillableHours = 0;
  let totalNonBillableHours = 0;
  let totalValue = 0;

  const projectSummary: ConsultantProjectSummary[] = Array.from(projectMap.entries()).map(([name, data]) => {
    const value = data.billableHours * data.billingRate;
    totalHours += data.totalHours;
    totalBillableHours += data.billableHours;
    totalNonBillableHours += data.nonBillableHours;
    totalValue += value;
    return {
      projectName: name,
      billingRate: data.billingRate,
      totalHours: data.totalHours,
      billableHours: data.billableHours,
      nonBillableHours: data.nonBillableHours,
      totalValue: value,
      tickets: Array.from(data.ticketMap.values()),
    };
  });

  const mappedEntries: ConsultantReportEntry[] = entries.map((e) => ({
    date: e.date,
    projectName: e.projectName,
    billingRate: e.billingRate,
    activityName: e.activityName,
    isBillable: e.isBillable !== false,
    ticketCode: e.ticketCode,
    ticketTitle: e.ticketTitle,
    ticketType: e.ticketType,
    hours: e.hours,
    description: e.description,
  }));

  return {
    consultant: {
      id: profile.userId,
      name: profile.name,
      email: profile.email,
      contractType: profile.contractType,
      hourlyRate: profile.hourlyRate,
    },
    entries: mappedEntries,
    projectSummary,
    totalHours,
    totalBillableHours,
    totalNonBillableHours,
    totalValue,
  };
}

export async function generateConsultantPdf(
  consultantUserId: string, from: string, to: string
): Promise<Buffer> {
  const data = await getConsultantReportData(consultantUserId, from, to);

  const content: Content[] = [
    { text: 'CLOUPONE', style: 'brand' },
    { text: 'Relatorio do Consultor', style: 'title' },
    {
      text: `Nome: ${data.consultant.name} | Tipo: ${data.consultant.contractType.toUpperCase()} | Rate: R$ ${Number(data.consultant.hourlyRate).toFixed(2)}/h`,
      style: 'subtitle',
    },
    { text: `Periodo: ${formatMonthYear(from, to)}`, style: 'subtitle' },
  ];

  // Per-project sections
  for (const proj of data.projectSummary) {
    content.push(
      { text: `PROJETO: ${proj.projectName} (Billing: R$ ${proj.billingRate.toFixed(2)}/h)`, style: 'sectionTitle' },
    );

    // Ticket summary table (if tickets exist)
    if (proj.tickets.length > 0) {
      const ticketBody: TableCell[][] = [
        [
          { text: 'Ticket', style: 'tableHeader' },
          { text: 'Tipo', style: 'tableHeader' },
          { text: 'Est.', style: 'tableHeader', alignment: 'right' },
          { text: 'Real.', style: 'tableHeader', alignment: 'right' },
          { text: 'Desvio', style: 'tableHeader', alignment: 'right' },
        ],
        ...proj.tickets.map((t: ConsultantTicketSummary) => {
          const est = t.estimatedHours;
          const desvio = est != null ? (t.actualHours - est) : null;
          return [
            t.ticketCode,
            t.ticketType,
            { text: est != null ? est.toFixed(1) : '-', alignment: 'right' as const },
            { text: t.actualHours.toFixed(1), alignment: 'right' as const },
            { text: desvio != null ? (desvio > 0 ? `+${desvio.toFixed(1)}` : desvio.toFixed(1)) : '-', alignment: 'right' as const },
          ];
        }),
      ];

      content.push({
        table: { headerRows: 1, widths: ['*', 60, 40, 40, 45], body: ticketBody },
        layout: 'lightHorizontalLines',
        margin: [0, 0, 0, 5] as [number, number, number, number],
      });
    }

    // Entries detail table for this project
    const projEntries = data.entries.filter((e) => e.projectName === proj.projectName);
    if (projEntries.length > 0) {
      const entryBody: TableCell[][] = [
        [
          { text: 'Data', style: 'tableHeader' },
          { text: 'Ticket', style: 'tableHeader' },
          { text: 'Atividade', style: 'tableHeader' },
          { text: 'Descricao', style: 'tableHeader' },
          { text: 'Horas', style: 'tableHeader', alignment: 'right' },
        ],
        ...projEntries.map((e) => [
          formatDate(e.date),
          e.ticketCode || '(sem ticket)',
          e.activityName || '-',
          e.description || '-',
          { text: Number(e.hours).toFixed(1), alignment: 'right' as const },
        ]),
      ];

      content.push({
        table: { headerRows: 1, widths: [55, 60, 65, '*', 35], body: entryBody },
        layout: 'lightHorizontalLines',
        margin: [0, 0, 0, 5] as [number, number, number, number],
      });
    }

    // Project breakdown
    content.push({
      text: `Billable: ${proj.billableHours.toFixed(1)}h | Nao-billable: ${proj.nonBillableHours.toFixed(1)}h | Total: ${proj.totalHours.toFixed(1)}h | Valor: R$ ${proj.totalValue.toFixed(2)}`,
      fontSize: 8,
      color: '#444',
      margin: [0, 2, 0, 12] as [number, number, number, number],
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
        { text: 'TOTAL', bold: true, fontSize: 11, width: '*' },
        { text: `${data.totalHours.toFixed(1)}h (Bill: ${data.totalBillableHours.toFixed(1)}h)`, bold: true, fontSize: 10, width: 140, alignment: 'right' },
        { text: `R$ ${data.totalValue.toFixed(2)}`, bold: true, fontSize: 11, width: 90, alignment: 'right' },
      ],
    },
  );

  const docDefinition: TDocumentDefinitions = {
    defaultStyle: { font: 'Helvetica', fontSize: 9 },
    pageSize: 'A4',
    pageMargins: [40, 60, 40, 60],
    content,
    styles: {
      brand: { fontSize: 14, bold: true, color: '#10b981', margin: [0, 0, 0, 5] },
      title: { fontSize: 16, bold: true, margin: [0, 0, 0, 5] },
      subtitle: { fontSize: 10, color: '#666', margin: [0, 0, 0, 3] },
      sectionTitle: { fontSize: 11, bold: true, margin: [0, 10, 0, 5] },
      tableHeader: { bold: true, fontSize: 8, fillColor: '#f0f0f0' },
    },
  };

  return pdfToBuffer(docDefinition);
}

export async function generateConsultantCsv(
  consultantUserId: string, from: string, to: string
): Promise<string> {
  const data = await getConsultantReportData(consultantUserId, from, to);

  const lines: string[] = [];

  // Header info
  lines.push(`Consultor;${data.consultant.name};Periodo;${formatMonthYear(from, to)}`);
  lines.push('');

  // Section 1 - Project summary
  lines.push('Resumo por Projeto');
  lines.push('Projeto;Horas;Billable;Nao-Billable;Rate;Valor');
  for (const p of data.projectSummary) {
    lines.push([
      p.projectName,
      p.totalHours.toFixed(1),
      p.billableHours.toFixed(1),
      p.nonBillableHours.toFixed(1),
      p.billingRate.toFixed(2),
      p.totalValue.toFixed(2),
    ].join(';'));
  }
  lines.push([
    'TOTAL',
    data.totalHours.toFixed(1),
    data.totalBillableHours.toFixed(1),
    data.totalNonBillableHours.toFixed(1),
    '',
    data.totalValue.toFixed(2),
  ].join(';'));
  lines.push('');

  // Section 2 - Detail
  lines.push('Detalhamento');
  lines.push('Data;Projeto;Ticket;Atividade;Billable;Descricao;Horas');
  for (const e of data.entries) {
    lines.push([
      formatDate(e.date),
      e.projectName,
      e.ticketCode || '(sem ticket)',
      e.activityName || '',
      e.isBillable ? 'Sim' : 'Nao',
      `"${(e.description || '').replace(/"/g, '""')}"`,
      Number(e.hours).toFixed(1),
    ].join(';'));
  }

  return lines.join('\n');
}

// --- Enhanced Client Report ---

interface EnhancedClientTicket {
  code: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  estimatedHours: number | null;
  actualHours: number;
}

interface EnhancedClientProjectSummary {
  projectName: string;
  billingRate: number;
  budgetHours: number | null;
  totalHours: number;
  totalValue: number;
  tickets: EnhancedClientTicket[];
}

interface EnhancedClientEntry {
  date: string;
  consultantName: string | null;
  ticketCode: string | null;
  activityName: string | null;
  description: string | null;
  hours: string;
  projectName: string;
  billingRate: string;
}

interface TicketStatusSummary {
  open: number;
  in_analysis: number;
  in_progress: number;
  in_review: number;
  resolved: number;
  closed: number;
  reopened: number;
  cancelled: number;
}

interface TicketTypeSummary {
  bug: number;
  improvement: number;
  initiative: number;
}

interface EnhancedClientReportData {
  client: { id: string; companyName: string; cnpj: string | null };
  entries: EnhancedClientEntry[];
  projectSummary: EnhancedClientProjectSummary[];
  ticketStatusSummary: TicketStatusSummary;
  ticketTypeSummary: TicketTypeSummary;
  totalTickets: number;
  totalHours: number;
  totalValue: number;
}

export async function getEnhancedClientReportData(
  clientId: string, from: string, to: string
): Promise<EnhancedClientReportData> {
  if (!from || !to) throw new AppError(MSG.INVALID_DATES, 400);

  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new AppError(MSG.CLIENT_NOT_FOUND, 404);

  // Query 1 - Tickets by project (visible to client only)
  const ticketRows = await db
    .select({
      code: tickets.code,
      title: tickets.title,
      type: tickets.type,
      status: tickets.status,
      priority: tickets.priority,
      estimatedHours: tickets.estimatedHours,
      projectName: projects.name,
      billingRate: projects.billingRate,
      budgetHours: projects.budgetHours,
      actualHours: sum(timeEntries.hours),
    })
    .from(tickets)
    .innerJoin(projects, eq(tickets.projectId, projects.id))
    .leftJoin(timeEntries, and(
      eq(timeEntries.ticketId, tickets.id),
      sql`EXISTS (SELECT 1 FROM monthly_timesheets mt WHERE mt.user_id = ${timeEntries.userId} AND mt.year = EXTRACT(YEAR FROM ${timeEntries.date})::integer AND mt.month = EXTRACT(MONTH FROM ${timeEntries.date})::integer AND mt.status = 'approved')`,
      between(timeEntries.date, from, to),
    ))
    .where(and(
      eq(projects.clientId, clientId),
      eq(tickets.isVisibleToClient, true),
    ))
    .groupBy(tickets.id, tickets.code, tickets.title, tickets.type, tickets.status, tickets.priority, tickets.estimatedHours, projects.name, projects.billingRate, projects.budgetHours)
    .orderBy(projects.name, tickets.code);

  // Query 2 - Detailed hours (same pattern as client report + ticketCode)
  const entries = await db
    .select({
      date: timeEntries.date,
      consultantName: users.name,
      ticketCode: tickets.code,
      activityName: activityCategories.name,
      description: timeEntries.description,
      hours: timeEntries.hours,
      projectName: projects.name,
      billingRate: projects.billingRate,
    })
    .from(timeEntries)
    .innerJoin(projects, eq(timeEntries.projectId, projects.id))
    .innerJoin(users, eq(timeEntries.userId, users.id))
    .leftJoin(activityCategories, eq(timeEntries.categoryId, activityCategories.id))
    .leftJoin(tickets, eq(timeEntries.ticketId, tickets.id))
    .where(and(
      eq(projects.clientId, clientId),
      sql`EXISTS (SELECT 1 FROM monthly_timesheets mt WHERE mt.user_id = ${timeEntries.userId} AND mt.year = EXTRACT(YEAR FROM ${timeEntries.date})::integer AND mt.month = EXTRACT(MONTH FROM ${timeEntries.date})::integer AND mt.status = 'approved')`,
      between(timeEntries.date, from, to),
    ))
    .orderBy(timeEntries.date, users.name);

  // Aggregate project summary with tickets and budget
  const projectMap = new Map<string, {
    billingRate: number;
    budgetHours: number | null;
    totalHours: number;
    tickets: EnhancedClientTicket[];
  }>();

  for (const t of ticketRows) {
    const projData = projectMap.get(t.projectName) || {
      billingRate: Number(t.billingRate),
      budgetHours: t.budgetHours,
      totalHours: 0,
      tickets: [],
    };
    const actual = Number(t.actualHours || 0);
    projData.tickets.push({
      code: t.code,
      title: t.title,
      type: t.type,
      status: t.status,
      priority: t.priority,
      estimatedHours: t.estimatedHours ? Number(t.estimatedHours) : null,
      actualHours: actual,
    });
    projectMap.set(t.projectName, projData);
  }

  // Calculate project hours from entries (not just ticket hours)
  const projectHoursMap = new Map<string, number>();
  for (const e of entries) {
    const hours = Number(e.hours);
    projectHoursMap.set(e.projectName, (projectHoursMap.get(e.projectName) || 0) + hours);
  }

  // Ensure all projects from entries are in projectMap
  for (const e of entries) {
    if (!projectMap.has(e.projectName)) {
      projectMap.set(e.projectName, {
        billingRate: Number(e.billingRate),
        budgetHours: null,
        totalHours: 0,
        tickets: [],
      });
    }
  }

  let totalHours = 0;
  let totalValue = 0;

  const projectSummary: EnhancedClientProjectSummary[] = Array.from(projectMap.entries()).map(([name, data]) => {
    const projHours = projectHoursMap.get(name) || 0;
    const value = projHours * data.billingRate;
    totalHours += projHours;
    totalValue += value;
    return {
      projectName: name,
      billingRate: data.billingRate,
      budgetHours: data.budgetHours,
      totalHours: projHours,
      totalValue: value,
      tickets: data.tickets,
    };
  });

  // Ticket status and type summaries
  const ticketStatusSummary: TicketStatusSummary = {
    open: 0, in_analysis: 0, in_progress: 0, in_review: 0,
    resolved: 0, closed: 0, reopened: 0, cancelled: 0,
  };
  const ticketTypeSummary: TicketTypeSummary = { bug: 0, improvement: 0, initiative: 0 };
  let totalTickets = 0;

  for (const t of ticketRows) {
    totalTickets++;
    ticketStatusSummary[t.status as keyof TicketStatusSummary]++;
    ticketTypeSummary[t.type as keyof TicketTypeSummary]++;
  }

  return {
    client: { id: client.id, companyName: client.companyName, cnpj: client.cnpj },
    entries,
    projectSummary,
    ticketStatusSummary,
    ticketTypeSummary,
    totalTickets,
    totalHours,
    totalValue,
  };
}

export async function generateEnhancedClientPdf(
  clientId: string, from: string, to: string
): Promise<Buffer> {
  const data = await getEnhancedClientReportData(clientId, from, to);

  const content: Content[] = [
    { text: 'CLOUPONE', style: 'brand' },
    { text: 'Relatorio do Cliente (Detalhado)', style: 'title' },
    { text: `Cliente: ${data.client.companyName}${data.client.cnpj ? ` | CNPJ: ${data.client.cnpj}` : ''}`, style: 'subtitle' },
    { text: `Periodo: ${formatMonthYear(from, to)}`, style: 'subtitle' },
  ];

  // Per-project sections
  for (const proj of data.projectSummary) {
    content.push(
      { text: `PROJETO: ${proj.projectName}`, style: 'sectionTitle' },
    );

    // Budget info
    if (proj.budgetHours) {
      const pct = ((proj.totalHours / proj.budgetHours) * 100).toFixed(0);
      content.push({
        text: `Budget: ${proj.budgetHours}h | Utilizado: ${proj.totalHours.toFixed(1)}h (${pct}%)`,
        fontSize: 9,
        color: '#444',
        margin: [0, 0, 0, 5] as [number, number, number, number],
      });
    }

    // Tickets table
    if (proj.tickets.length > 0) {
      const ticketBody: TableCell[][] = [
        [
          { text: 'Codigo', style: 'tableHeader' },
          { text: 'Titulo', style: 'tableHeader' },
          { text: 'Tipo', style: 'tableHeader' },
          { text: 'Status', style: 'tableHeader' },
          { text: 'Est.', style: 'tableHeader', alignment: 'right' },
          { text: 'Real.', style: 'tableHeader', alignment: 'right' },
        ],
        ...proj.tickets.map((t) => [
          t.code,
          { text: t.title, noWrap: false },
          t.type,
          t.status.replace(/_/g, ' '),
          { text: t.estimatedHours != null ? t.estimatedHours.toFixed(1) : '-', alignment: 'right' as const },
          { text: t.actualHours.toFixed(1), alignment: 'right' as const },
        ]),
      ];

      content.push(
        { text: 'Tickets', fontSize: 10, bold: true, margin: [0, 5, 0, 3] as [number, number, number, number] },
        {
          table: { headerRows: 1, widths: [55, '*', 55, 60, 35, 35], body: ticketBody },
          layout: 'lightHorizontalLines',
          margin: [0, 0, 0, 5] as [number, number, number, number],
        },
      );
    }

    // Hours detail for this project
    const projEntries = data.entries.filter((e) => e.projectName === proj.projectName);
    if (projEntries.length > 0) {
      const entryBody: TableCell[][] = [
        [
          { text: 'Data', style: 'tableHeader' },
          { text: 'Consultor', style: 'tableHeader' },
          { text: 'Ticket', style: 'tableHeader' },
          { text: 'Atividade', style: 'tableHeader' },
          { text: 'Horas', style: 'tableHeader', alignment: 'right' },
        ],
        ...projEntries.map((e) => [
          formatDate(e.date),
          e.consultantName || '-',
          e.ticketCode || '(sem ticket)',
          e.activityName || '-',
          { text: Number(e.hours).toFixed(1), alignment: 'right' as const },
        ]),
      ];

      content.push(
        { text: 'Horas Detalhadas', fontSize: 10, bold: true, margin: [0, 5, 0, 3] as [number, number, number, number] },
        {
          table: { headerRows: 1, widths: [55, 80, 55, '*', 35], body: entryBody },
          layout: 'lightHorizontalLines',
          margin: [0, 0, 0, 5] as [number, number, number, number],
        },
      );
    }

    // Subtotal
    content.push({
      text: `Subtotal: ${proj.totalHours.toFixed(1)}h | R$ ${proj.billingRate.toFixed(2)}/h | R$ ${proj.totalValue.toFixed(2)}`,
      fontSize: 8,
      color: '#444',
      margin: [0, 2, 0, 12] as [number, number, number, number],
    });
  }

  // Financial summary
  content.push(
    { text: 'Resumo Financeiro', style: 'sectionTitle' },
  );

  const summaryBody: TableCell[][] = [
    [
      { text: 'Projeto', style: 'tableHeader' },
      { text: 'Horas', style: 'tableHeader', alignment: 'right' },
      { text: 'Rate', style: 'tableHeader', alignment: 'right' },
      { text: 'Valor', style: 'tableHeader', alignment: 'right' },
    ],
    ...data.projectSummary.map((p) => [
      p.projectName,
      { text: p.totalHours.toFixed(1), alignment: 'right' as const },
      { text: `R$ ${p.billingRate.toFixed(2)}`, alignment: 'right' as const },
      { text: `R$ ${p.totalValue.toFixed(2)}`, alignment: 'right' as const },
    ]),
    [
      { text: 'TOTAL', bold: true },
      { text: data.totalHours.toFixed(1), bold: true, alignment: 'right' as const },
      { text: '', bold: true },
      { text: `R$ ${data.totalValue.toFixed(2)}`, bold: true, alignment: 'right' as const },
    ],
  ];

  content.push({
    table: { headerRows: 1, widths: ['*', 50, 70, 70], body: summaryBody },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 10] as [number, number, number, number],
  });

  // Ticket summary
  const ts = data.ticketStatusSummary;
  const tt = data.ticketTypeSummary;
  content.push(
    { text: 'Resumo de Tickets', style: 'sectionTitle' },
    {
      text: `Total: ${data.totalTickets} | Abertos: ${ts.open} | Em analise: ${ts.in_analysis} | Em andamento: ${ts.in_progress} | Em revisao: ${ts.in_review} | Resolvidos: ${ts.resolved} | Fechados: ${ts.closed} | Reabertos: ${ts.reopened} | Cancelados: ${ts.cancelled}`,
      fontSize: 8,
      margin: [0, 0, 0, 3] as [number, number, number, number],
    },
    {
      text: `Bugs: ${tt.bug} | Melhorias: ${tt.improvement} | Iniciativas: ${tt.initiative}`,
      fontSize: 8,
      margin: [0, 0, 0, 5] as [number, number, number, number],
    },
  );

  const docDefinition: TDocumentDefinitions = {
    defaultStyle: { font: 'Helvetica', fontSize: 9 },
    pageSize: 'A4',
    pageMargins: [40, 60, 40, 60],
    content,
    styles: {
      brand: { fontSize: 14, bold: true, color: '#10b981', margin: [0, 0, 0, 5] },
      title: { fontSize: 16, bold: true, margin: [0, 0, 0, 5] },
      subtitle: { fontSize: 10, color: '#666', margin: [0, 0, 0, 3] },
      sectionTitle: { fontSize: 11, bold: true, margin: [0, 10, 0, 5] },
      tableHeader: { bold: true, fontSize: 8, fillColor: '#f0f0f0' },
    },
  };

  return pdfToBuffer(docDefinition);
}

export async function generateEnhancedClientCsv(
  clientId: string, from: string, to: string
): Promise<string> {
  const data = await getEnhancedClientReportData(clientId, from, to);

  const lines: string[] = [];

  // Header
  lines.push(`Cliente;${data.client.companyName};CNPJ;${data.client.cnpj || ''};Periodo;${formatMonthYear(from, to)}`);
  lines.push('');

  // Section 1 - Project summary
  lines.push('Resumo por Projeto');
  lines.push('Projeto;Budget(h);Utilizado(h);Rate;Valor');
  for (const p of data.projectSummary) {
    lines.push([
      p.projectName,
      p.budgetHours != null ? String(p.budgetHours) : '-',
      p.totalHours.toFixed(1),
      p.billingRate.toFixed(2),
      p.totalValue.toFixed(2),
    ].join(';'));
  }
  lines.push(['TOTAL', '', data.totalHours.toFixed(1), '', data.totalValue.toFixed(2)].join(';'));
  lines.push('');

  // Section 2 - Tickets
  lines.push('Tickets');
  lines.push('Projeto;Codigo;Titulo;Tipo;Status;Estimado(h);Realizado(h)');
  for (const p of data.projectSummary) {
    for (const t of p.tickets) {
      lines.push([
        p.projectName,
        t.code,
        `"${t.title.replace(/"/g, '""')}"`,
        t.type,
        t.status,
        t.estimatedHours != null ? t.estimatedHours.toFixed(1) : '-',
        t.actualHours.toFixed(1),
      ].join(';'));
    }
  }
  lines.push('');

  // Section 3 - Detailed hours
  lines.push('Horas Detalhadas');
  lines.push('Data;Consultor;Projeto;Ticket;Atividade;Descricao;Horas');
  for (const e of data.entries) {
    lines.push([
      formatDate(e.date),
      e.consultantName || '',
      e.projectName,
      e.ticketCode || '(sem ticket)',
      e.activityName || '',
      `"${(e.description || '').replace(/"/g, '""')}"`,
      Number(e.hours).toFixed(1),
    ].join(';'));
  }

  return lines.join('\n');
}

// --- Expense Report (standalone) ---

interface ExpenseReportEntry {
  date: string;
  consultantName: string | null;
  projectName: string;
  clientName: string;
  categoryName: string | null;
  description: string;
  amount: string;
  requiresReimbursement: boolean;
  reimbursedAt: Date | null;
}

interface ExpenseReportCategorySummary {
  categoryName: string;
  count: number;
  totalAmount: number;
}

interface ExpenseReportData {
  entries: ExpenseReportEntry[];
  categorySummary: ExpenseReportCategorySummary[];
  totalAmount: number;
  totalCount: number;
  totalReimbursable: number;
  totalReimbursed: number;
}

export async function getExpenseReportData(
  from: string, to: string,
  filters?: { projectId?: string; consultantId?: string; categoryId?: string; reimbursementStatus?: 'pending' | 'paid' | 'all' },
): Promise<ExpenseReportData> {
  if (!from || !to) throw new AppError(MSG.INVALID_DATES, 400);

  const conditions = [
    eq(expenses.status, 'approved'),
    between(expenses.date, from, to),
  ];

  if (filters?.projectId) conditions.push(eq(expenses.projectId, filters.projectId));
  if (filters?.consultantId) conditions.push(eq(expenses.createdByUserId, filters.consultantId));
  if (filters?.categoryId) conditions.push(eq(expenses.expenseCategoryId, filters.categoryId));
  if (filters?.reimbursementStatus === 'pending') conditions.push(sql`${expenses.reimbursedAt} IS NULL`);
  else if (filters?.reimbursementStatus === 'paid') conditions.push(sql`${expenses.reimbursedAt} IS NOT NULL`);

  const entries = await db
    .select({
      date: expenses.date,
      consultantName: users.name,
      projectName: projects.name,
      clientName: clients.companyName,
      categoryName: expenseCategories.name,
      description: expenses.description,
      amount: expenses.amount,
      requiresReimbursement: expenses.requiresReimbursement,
      reimbursedAt: expenses.reimbursedAt,
    })
    .from(expenses)
    .innerJoin(projects, eq(expenses.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .leftJoin(users, eq(expenses.createdByUserId, users.id))
    .leftJoin(expenseCategories, eq(expenses.expenseCategoryId, expenseCategories.id))
    .where(and(...conditions))
    .orderBy(expenses.date, users.name);

  if (entries.length === 0) throw new AppError(MSG.NO_DATA, 404);

  // Aggregate by category
  const categoryMap = new Map<string, { count: number; totalAmount: number }>();
  let totalAmount = 0;
  let totalReimbursable = 0;
  let totalReimbursed = 0;

  for (const e of entries) {
    const amt = Number(e.amount);
    totalAmount += amt;
    if (e.requiresReimbursement) totalReimbursable += amt;
    if (e.reimbursedAt) totalReimbursed += amt;

    const catName = e.categoryName || 'Sem categoria';
    const existing = categoryMap.get(catName) || { count: 0, totalAmount: 0 };
    existing.count++;
    existing.totalAmount += amt;
    categoryMap.set(catName, existing);
  }

  const categorySummary = Array.from(categoryMap.entries())
    .map(([categoryName, data]) => ({ categoryName, ...data }))
    .sort((a, b) => b.totalAmount - a.totalAmount);

  return {
    entries,
    categorySummary,
    totalAmount,
    totalCount: entries.length,
    totalReimbursable,
    totalReimbursed,
  };
}

export async function generateExpensePdf(
  from: string, to: string,
  filters?: { projectId?: string; consultantId?: string; categoryId?: string; reimbursementStatus?: 'pending' | 'paid' | 'all' },
): Promise<Buffer> {
  const data = await getExpenseReportData(from, to, filters);

  const content: Content[] = [
    { text: 'CLOUPONE', style: 'brand' },
    { text: 'Relatorio de Despesas', style: 'title' },
    { text: `Periodo: ${formatMonthYear(from, to)}`, style: 'subtitle' },
  ];

  // Category summary table
  content.push(
    { text: 'Resumo por Categoria', style: 'sectionTitle' },
    {
      table: {
        headerRows: 1,
        widths: ['*', 50, 80],
        body: [
          [
            { text: 'Categoria', style: 'tableHeader' },
            { text: 'Qtde', style: 'tableHeader', alignment: 'right' },
            { text: 'Valor', style: 'tableHeader', alignment: 'right' },
          ],
          ...data.categorySummary.map((c) => [
            c.categoryName,
            { text: String(c.count), alignment: 'right' as const },
            { text: `R$ ${c.totalAmount.toFixed(2)}`, alignment: 'right' as const },
          ]),
          [
            { text: 'TOTAL', bold: true },
            { text: String(data.totalCount), bold: true, alignment: 'right' as const },
            { text: `R$ ${data.totalAmount.toFixed(2)}`, bold: true, alignment: 'right' as const },
          ],
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 0, 0, 15] as [number, number, number, number],
    },
  );

  // Detail table
  content.push(
    { text: 'Detalhamento', style: 'sectionTitle' },
    {
      table: {
        headerRows: 1,
        widths: [55, 70, 70, 60, '*', 60],
        body: [
          [
            { text: 'Data', style: 'tableHeader' },
            { text: 'Consultor', style: 'tableHeader' },
            { text: 'Projeto', style: 'tableHeader' },
            { text: 'Categoria', style: 'tableHeader' },
            { text: 'Descricao', style: 'tableHeader' },
            { text: 'Valor', style: 'tableHeader', alignment: 'right' },
          ],
          ...data.entries.map((e) => [
            formatDate(e.date),
            e.consultantName || '-',
            e.projectName,
            e.categoryName || '-',
            e.description,
            { text: `R$ ${Number(e.amount).toFixed(2)}`, alignment: 'right' as const },
          ]),
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 0, 0, 15] as [number, number, number, number],
    },
  );

  // Totals
  content.push(
    {
      canvas: [{ type: 'line', x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 2 }],
      margin: [0, 5, 0, 5] as [number, number, number, number],
    },
    {
      columns: [
        { text: 'TOTAL GERAL', bold: true, fontSize: 12, width: '*' },
        { text: `${data.totalCount} despesas`, bold: true, fontSize: 10, width: 100, alignment: 'right' },
        { text: `R$ ${data.totalAmount.toFixed(2)}`, bold: true, fontSize: 12, width: 100, alignment: 'right' },
      ],
    },
  );

  if (data.totalReimbursable > 0) {
    content.push({
      text: `Reembolsavel: R$ ${data.totalReimbursable.toFixed(2)} | Reembolsado: R$ ${data.totalReimbursed.toFixed(2)} | Pendente: R$ ${(data.totalReimbursable - data.totalReimbursed).toFixed(2)}`,
      fontSize: 8,
      color: '#444',
      margin: [0, 5, 0, 0] as [number, number, number, number],
    });
  }

  const docDefinition: TDocumentDefinitions = {
    defaultStyle: { font: 'Helvetica', fontSize: 9 },
    pageSize: 'A4',
    pageMargins: [40, 60, 40, 60],
    content,
    styles: {
      brand: { fontSize: 14, bold: true, color: '#10b981', margin: [0, 0, 0, 5] },
      title: { fontSize: 16, bold: true, margin: [0, 0, 0, 5] },
      subtitle: { fontSize: 10, color: '#666', margin: [0, 0, 0, 15] },
      sectionTitle: { fontSize: 11, bold: true, margin: [0, 10, 0, 5] },
      tableHeader: { bold: true, fontSize: 8, fillColor: '#f0f0f0' },
    },
  };

  return pdfToBuffer(docDefinition);
}

export async function generateExpenseCsv(
  from: string, to: string,
  filters?: { projectId?: string; consultantId?: string; categoryId?: string; reimbursementStatus?: 'pending' | 'paid' | 'all' },
): Promise<string> {
  const data = await getExpenseReportData(from, to, filters);

  const lines: string[] = [];

  lines.push(`Relatorio de Despesas;Periodo;${formatMonthYear(from, to)}`);
  lines.push('');

  // Category summary
  lines.push('Resumo por Categoria');
  lines.push('Categoria;Quantidade;Valor');
  for (const c of data.categorySummary) {
    lines.push([c.categoryName, String(c.count), c.totalAmount.toFixed(2)].join(';'));
  }
  lines.push(['TOTAL', String(data.totalCount), data.totalAmount.toFixed(2)].join(';'));
  lines.push('');

  // Detail
  lines.push('Detalhamento');
  lines.push('Data;Consultor;Projeto;Cliente;Categoria;Descricao;Valor;Reembolso;Reembolsado');
  for (const e of data.entries) {
    lines.push([
      formatDate(e.date),
      e.consultantName || '',
      e.projectName,
      e.clientName,
      e.categoryName || '',
      `"${e.description.replace(/"/g, '""')}"`,
      Number(e.amount).toFixed(2),
      e.requiresReimbursement ? 'Sim' : 'Nao',
      e.reimbursedAt ? 'Sim' : 'Nao',
    ].join(';'));
  }

  return lines.join('\n');
}

// --- Extend Client Report with Expenses ---

export async function getClientReportExpenses(clientId: string, from: string, to: string) {
  return db
    .select({
      date: expenses.date,
      consultantName: users.name,
      categoryName: expenseCategories.name,
      description: expenses.description,
      amount: expenses.amount,
    })
    .from(expenses)
    .innerJoin(projects, eq(expenses.projectId, projects.id))
    .leftJoin(users, eq(expenses.createdByUserId, users.id))
    .leftJoin(expenseCategories, eq(expenses.expenseCategoryId, expenseCategories.id))
    .where(and(
      eq(projects.clientId, clientId),
      eq(expenses.status, 'approved'),
      between(expenses.date, from, to),
    ))
    .orderBy(expenses.date, users.name);
}

// --- Helper: pdfmake to Buffer ---

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
