import path from 'path';
import fs from 'fs';
import { eq, and } from 'drizzle-orm';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require('pdfmake/js/Printer').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const UrlResolver = require('pdfmake/js/URLResolver').default;
import type { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces';
import { db } from '../db';
import { invoices, invoiceLines, expenseInvoices, expenseInvoiceItems, projects, companyInfo, bankAccounts, expenses, projectExpenseCategories, users } from '../db/schema';
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

import { formatBRL } from '../utils/format-currency';

function formatCurrency(value: number): string {
  return `R$ ${formatBRL(value)}`;
}

function formatPeriod(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  return `${s.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} a ${e.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
}

const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

async function getCompanyAndBank() {
  const company = await db.query.companyInfo.findFirst();
  if (!company) {
    throw new AppError('Dados da empresa não configurados. Acesse Configurações > Dados da Empresa.', 400);
  }

  const bankAccount = await db.query.bankAccounts.findFirst({
    where: eq(bankAccounts.isActive, true),
  });

  return { company, bankAccount };
}

function buildHeader(company: typeof companyInfo.$inferSelect, logoSvg: string): Content {
  return {
    table: {
      widths: ['*'],
      body: [[
        {
          columns: [
            { svg: logoSvg, width: 120 } as unknown as Content,
            {
              stack: [
                { text: company.companyName, bold: true, fontSize: 10, margin: [0, 0, 0, 2] as [number, number, number, number] },
                { text: company.address, fontSize: 8, color: '#555', margin: [0, 0, 0, 2] as [number, number, number, number] },
                { text: `CEP: ${company.zipCode} - ${company.cityState}`, fontSize: 8, color: '#555', margin: [0, 0, 0, 2] as [number, number, number, number] },
                { text: `Tel: ${company.phone ?? ''} | ${company.email ?? ''}`, fontSize: 8, color: '#555', margin: [0, 0, 0, 2] as [number, number, number, number] },
                { text: `CNPJ: ${company.cnpj}`, fontSize: 8, color: '#555' },
              ],
              width: '*',
              alignment: 'right' as const,
            },
          ],
          margin: [5, 5, 5, 5] as [number, number, number, number],
        },
      ]],
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#000',
      vLineColor: () => '#000',
    },
    margin: [0, 0, 0, 15] as [number, number, number, number],
  };
}

function buildBankInfo(bankAccount: typeof bankAccounts.$inferSelect | undefined): Content[] {
  if (!bankAccount) return [];
  return [
    {
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#ccc' }],
      margin: [0, 5, 0, 8] as [number, number, number, number],
    },
    {
      stack: [
        { text: 'Conta para pagamento:', bold: true, fontSize: 9, margin: [0, 0, 0, 3] as [number, number, number, number] },
        { text: bankAccount.holderName, fontSize: 8, margin: [0, 0, 0, 2] as [number, number, number, number] },
        { text: `Banco: ${bankAccount.bankName}`, fontSize: 8, margin: [0, 0, 0, 2] as [number, number, number, number] },
        { text: `Agência: ${bankAccount.agency}`, fontSize: 8, margin: [0, 0, 0, 2] as [number, number, number, number] },
        { text: `Conta: ${bankAccount.accountNumber}`, fontSize: 8 },
      ],
    },
  ];
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

export async function generateInvoicePdf(invoiceId: string, bankAccountId: string): Promise<Buffer> {
  // Fetch invoice with lines
  const [invoice] = await db.select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);

  if (!invoice) throw new AppError('Fatura não encontrada.', 404);

  const lines = await db.select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId));

  const [project] = await db.select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, invoice.projectId))
    .limit(1);

  // Fetch company info
  const company = await db.query.companyInfo.findFirst();
  if (!company) {
    throw new AppError('Dados da empresa não configurados. Acesse Configurações > Dados da Empresa.', 400);
  }

  // Fetch specific bank account
  const bankAccount = await db.query.bankAccounts.findFirst({
    where: and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.isActive, true)),
  });
  if (!bankAccount) {
    throw new AppError('Conta bancária não encontrada ou inativa.', 400);
  }

  const logoSvgPath = path.resolve(__dirname, '../assets/cloup-one-brand.svg');
  const logoSvg = fs.readFileSync(logoSvgPath, 'utf-8');

  const now = new Date();
  const generatedAt = `Gerado em ${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

  // Format issuedAt date
  const issuedAtFormatted = invoice.issuedAt
    ? new Date(invoice.issuedAt).toLocaleDateString('pt-BR')
    : now.toLocaleDateString('pt-BR');

  // Separate lines by type
  const hoursLines = lines.filter(l => l.lineType === 'hours');
  const installmentLines = lines.filter(l => l.lineType === 'installment');
  const customLines = lines.filter(l => l.lineType === 'custom');

  const content: Content[] = [
    buildHeader(company, logoSvg),
    {
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#10b981' }],
      margin: [0, 0, 0, 10] as [number, number, number, number],
    },
    {
      text: `FATURA Nº ${invoice.invoiceNumber}`,
      bold: true,
      fontSize: 14,
      alignment: 'center',
      margin: [0, 0, 0, 10] as [number, number, number, number],
    },
    // Client info (2 columns: left = client data, right = emissao + valor)
    {
      table: {
        widths: ['*'],
        body: [[
          {
            columns: [
              {
                stack: [
                  { text: 'CLIENTE', bold: true, fontSize: 9, color: '#333', margin: [0, 0, 0, 4] as [number, number, number, number] },
                  { text: invoice.clientName, bold: true, fontSize: 10, margin: [0, 0, 0, 2] as [number, number, number, number] },
                  ...(invoice.clientCnpj ? [{ text: `CNPJ: ${invoice.clientCnpj}`, fontSize: 8, color: '#555', margin: [0, 0, 0, 2] as [number, number, number, number] }] : []),
                  { text: `Projeto: ${project?.name ?? '-'}`, fontSize: 9, margin: [0, 0, 0, 2] as [number, number, number, number] },
                  { text: `Período: ${MONTH_NAMES[invoice.month - 1]}/${invoice.year}`, fontSize: 9 },
                ],
                width: '*',
              },
              {
                table: {
                  widths: [70, 80],
                  body: [
                    [
                      { text: 'EMISSÃO', bold: true, fontSize: 8, fillColor: '#f0f0f0', alignment: 'center' },
                      { text: 'VALOR', bold: true, fontSize: 8, fillColor: '#f0f0f0', alignment: 'center' },
                    ],
                    [
                      { text: issuedAtFormatted, fontSize: 9, alignment: 'center' },
                      { text: formatCurrency(Number(invoice.totalAmount)), fontSize: 9, bold: true, alignment: 'center' },
                    ],
                  ],
                },
                layout: {
                  hLineWidth: () => 0.5,
                  vLineWidth: () => 0.5,
                  hLineColor: () => '#000',
                  vLineColor: () => '#000',
                },
                width: 'auto' as const,
              },
            ],
            margin: [5, 5, 5, 5] as [number, number, number, number],
          },
        ]],
      },
      layout: {
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
        hLineColor: () => '#000',
        vLineColor: () => '#000',
      },
      margin: [0, 0, 0, 15] as [number, number, number, number],
    },
  ];

  // Services table (hours lines)
  if (hoursLines.length > 0) {
    content.push({ text: 'SERVIÇOS', bold: true, fontSize: 11, margin: [0, 0, 0, 8] as [number, number, number, number], color: '#333' });

    const tableBody: TableCell[][] = [
      [
        { text: 'Consultor', style: 'tableHeader' },
        { text: 'Qt. Horas', style: 'tableHeader', alignment: 'right' },
        { text: 'Preço Unit.', style: 'tableHeader', alignment: 'right' },
        { text: 'Total', style: 'tableHeader', alignment: 'right' },
      ],
      ...hoursLines.map(l => [
        l.consultantName ?? '-',
        { text: Number(l.appliedHours).toFixed(2), alignment: 'right' as const },
        { text: formatCurrency(Number(l.appliedRate)), alignment: 'right' as const },
        { text: formatCurrency(Number(l.subtotal)), alignment: 'right' as const },
      ]),
    ];

    content.push({
      table: {
        headerRows: 1,
        widths: ['*', 60, 80, 90],
        body: tableBody,
      },
      layout: {
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
        hLineColor: () => '#000',
        vLineColor: () => '#000',
      },
      margin: [0, 0, 0, 10] as [number, number, number, number],
    });
  }

  // Installment lines (fixed_price invoices)
  if (installmentLines.length > 0) {
    content.push({ text: 'PARCELAS', bold: true, fontSize: 11, margin: [0, 0, 0, 8] as [number, number, number, number], color: '#333' });

    const installmentTableBody: TableCell[][] = [
      [
        { text: 'Descrição', style: 'tableHeader' },
        { text: 'Valor', style: 'tableHeader', alignment: 'right' },
      ],
      ...installmentLines.map(l => [
        l.description ?? '-',
        { text: formatCurrency(Number(l.subtotal)), alignment: 'right' as const },
      ]),
    ];

    content.push({
      table: {
        headerRows: 1,
        widths: ['*', 120],
        body: installmentTableBody,
      },
      layout: {
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
        hLineColor: () => '#000',
        vLineColor: () => '#000',
      },
      margin: [0, 0, 0, 10] as [number, number, number, number],
    });
  }

  // Custom lines (additional items)
  if (customLines.length > 0) {
    content.push({ text: 'ITENS ADICIONAIS', bold: true, fontSize: 11, margin: [0, 5, 0, 8] as [number, number, number, number], color: '#333' });

    const customTableBody: TableCell[][] = [
      [
        { text: 'Descrição', style: 'tableHeader' },
        { text: 'Qtd', style: 'tableHeader', alignment: 'right' },
        { text: 'Preço Unit.', style: 'tableHeader', alignment: 'right' },
        { text: 'Total', style: 'tableHeader', alignment: 'right' },
      ],
      ...customLines.map(l => [
        l.description ?? '-',
        { text: Number(l.appliedHours).toFixed(2), alignment: 'right' as const },
        { text: formatCurrency(Number(l.appliedRate)), alignment: 'right' as const },
        { text: formatCurrency(Number(l.subtotal)), alignment: 'right' as const },
      ]),
    ];

    content.push({
      table: {
        headerRows: 1,
        widths: ['*', 50, 80, 90],
        body: customTableBody,
      },
      layout: {
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
        hLineColor: () => '#000',
        vLineColor: () => '#000',
      },
      margin: [0, 0, 0, 10] as [number, number, number, number],
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
        { text: 'TOTAL', bold: true, fontSize: 12, width: '*' },
        { text: formatCurrency(Number(invoice.totalAmount)), bold: true, fontSize: 12, width: 120, alignment: 'right' },
      ],
      margin: [0, 0, 0, 15] as [number, number, number, number],
    },
  );

  // Notes
  if (invoice.notes?.trim()) {
    content.push(
      {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#ccc' }],
        margin: [0, 5, 0, 8] as [number, number, number, number],
      },
      { text: 'Observações:', bold: true, fontSize: 9, margin: [0, 0, 0, 3] as [number, number, number, number] },
      { text: invoice.notes, fontSize: 8, color: '#555', margin: [0, 0, 0, 10] as [number, number, number, number] },
    );
  }

  // Bank info
  content.push(...buildBankInfo(bankAccount));

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
      tableHeader: { bold: true, fontSize: 8, fillColor: '#f0f0f0' },
    },
  };

  return pdfToBuffer(docDefinition);
}

export async function generateInvoiceExpensesPdf(invoiceId: string, bankAccountId: string): Promise<Buffer> {
  // Fetch expense invoice with items (JOIN with expenses for date)
  const [invoice] = await db.select()
    .from(expenseInvoices)
    .where(eq(expenseInvoices.id, invoiceId))
    .limit(1);

  if (!invoice) throw new AppError('Fatura de despesas não encontrada.', 404);

  const items = await db.select({
    description: expenseInvoiceItems.description,
    appliedAmount: expenseInvoiceItems.appliedAmount,
    expenseDate: expenses.date,
    expenseDescription: expenses.description,
  })
    .from(expenseInvoiceItems)
    .innerJoin(expenses, eq(expenseInvoiceItems.expenseId, expenses.id))
    .leftJoin(users, eq(expenses.consultantUserId, users.id))
    .where(eq(expenseInvoiceItems.expenseInvoiceId, invoiceId))
    .orderBy(expenses.date);

  const [project] = await db.select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, invoice.projectId))
    .limit(1);

  // Fetch company info
  const company = await db.query.companyInfo.findFirst();
  if (!company) {
    throw new AppError('Dados da empresa não configurados. Acesse Configurações > Dados da Empresa.', 400);
  }

  // Fetch specific bank account
  const bankAccount = await db.query.bankAccounts.findFirst({
    where: and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.isActive, true)),
  });
  if (!bankAccount) {
    throw new AppError('Conta bancária não encontrada ou inativa.', 400);
  }

  // Load SVG logo (same as expense report)
  const logoSvgPath = path.resolve(__dirname, '../assets/cloup-one-brand.svg');
  const logoSvg = fs.readFileSync(logoSvgPath, 'utf-8');

  const now = new Date();
  const generatedAt = `Gerado em ${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

  // Format issuedAt date
  const issuedAtFormatted = invoice.issuedAt
    ? new Date(invoice.issuedAt).toLocaleDateString('pt-BR')
    : now.toLocaleDateString('pt-BR');

  // Build header with SVG logo
  const header: Content = {
    table: {
      widths: ['*'],
      body: [[
        {
          columns: [
            { svg: logoSvg, width: 120 } as unknown as Content,
            {
              stack: [
                { text: company.companyName, bold: true, fontSize: 10, margin: [0, 0, 0, 2] as [number, number, number, number] },
                { text: company.address, fontSize: 8, color: '#555', margin: [0, 0, 0, 2] as [number, number, number, number] },
                { text: `CEP: ${company.zipCode} - ${company.cityState}`, fontSize: 8, color: '#555', margin: [0, 0, 0, 2] as [number, number, number, number] },
                { text: `Tel: ${company.phone ?? ''} | ${company.email ?? ''}`, fontSize: 8, color: '#555', margin: [0, 0, 0, 2] as [number, number, number, number] },
                { text: `CNPJ: ${company.cnpj}`, fontSize: 8, color: '#555' },
              ],
              width: '*',
              alignment: 'right' as const,
            },
          ],
          margin: [5, 5, 5, 5] as [number, number, number, number],
        },
      ]],
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#000',
      vLineColor: () => '#000',
    },
    margin: [0, 0, 0, 15] as [number, number, number, number],
  };

  const content: Content[] = [
    header,
    {
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#10b981' }],
      margin: [0, 0, 0, 10] as [number, number, number, number],
    },
    {
      text: 'FATURA DE DESPESAS',
      bold: true,
      fontSize: 14,
      alignment: 'center',
      margin: [0, 0, 0, 10] as [number, number, number, number],
    },
    // Client info (2 columns: left = client data, right = emissao + valor)
    {
      table: {
        widths: ['*'],
        body: [[
          {
            columns: [
              {
                stack: [
                  { text: 'CLIENTE', bold: true, fontSize: 9, color: '#333', margin: [0, 0, 0, 4] as [number, number, number, number] },
                  { text: invoice.clientName, bold: true, fontSize: 10, margin: [0, 0, 0, 2] as [number, number, number, number] },
                  ...(invoice.clientCnpj ? [{ text: `CNPJ: ${invoice.clientCnpj}`, fontSize: 8, color: '#555', margin: [0, 0, 0, 2] as [number, number, number, number] }] : []),
                  { text: `Projeto: ${project?.name ?? '-'}`, fontSize: 9, margin: [0, 0, 0, 2] as [number, number, number, number] },
                  { text: `Período: ${formatPeriod(invoice.periodStart, invoice.periodEnd)}`, fontSize: 9 },
                ],
                width: '*',
              },
              {
                table: {
                  widths: [70, 80],
                  body: [
                    [
                      { text: 'EMISSÃO', bold: true, fontSize: 8, fillColor: '#f0f0f0', alignment: 'center' },
                      { text: 'VALOR', bold: true, fontSize: 8, fillColor: '#f0f0f0', alignment: 'center' },
                    ],
                    [
                      { text: issuedAtFormatted, fontSize: 9, alignment: 'center' },
                      { text: formatCurrency(Number(invoice.totalAmount)), fontSize: 9, bold: true, alignment: 'center' },
                    ],
                  ],
                },
                layout: {
                  hLineWidth: () => 0.5,
                  vLineWidth: () => 0.5,
                  hLineColor: () => '#000',
                  vLineColor: () => '#000',
                },
                width: 'auto' as const,
              },
            ],
            margin: [5, 5, 5, 5] as [number, number, number, number],
          },
        ]],
      },
      layout: {
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
        hLineColor: () => '#000',
        vLineColor: () => '#000',
      },
      margin: [0, 0, 0, 15] as [number, number, number, number],
    },
  ];

  // Expenses table with date column
  content.push({ text: 'DESPESAS', bold: true, fontSize: 11, margin: [0, 0, 0, 8] as [number, number, number, number], color: '#333' });

  const formatDateShort = (d: string) => {
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const tableBody: TableCell[][] = [
    [
      { text: 'Item', style: 'tableHeader' },
      { text: 'Data', style: 'tableHeader' },
      { text: 'Descrição', style: 'tableHeader' },
      { text: 'Valor', style: 'tableHeader', alignment: 'right' },
    ],
    ...items.map((item, i) => {
      let descText = item.description ?? '-';
      if (item.expenseDescription?.trim()) {
        descText += ` - ${item.expenseDescription.trim()}`;
      }
      return [
        { text: String(i + 1).padStart(3, '0'), fontSize: 8 },
        { text: formatDateShort(item.expenseDate), fontSize: 8 },
        { text: descText, fontSize: 8, lineHeight: 1.3 },
        { text: formatCurrency(Number(item.appliedAmount)), alignment: 'right' as const },
      ];
    }),
  ];

  content.push({
    table: {
      headerRows: 1,
      widths: [22, 42, '*', 55],
      body: tableBody,
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#000',
      vLineColor: () => '#000',
    },
    margin: [0, 0, 0, 10] as [number, number, number, number],
  });

  // Grand total
  content.push(
    {
      canvas: [{ type: 'line', x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 2 }],
      margin: [0, 5, 0, 5] as [number, number, number, number],
    },
    {
      columns: [
        { text: 'TOTAL', bold: true, fontSize: 12, width: '*' },
        { text: formatCurrency(Number(invoice.totalAmount)), bold: true, fontSize: 12, width: 120, alignment: 'right' },
      ],
      margin: [0, 0, 0, 15] as [number, number, number, number],
    },
  );

  // Notes
  if (invoice.notes?.trim()) {
    content.push(
      {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#ccc' }],
        margin: [0, 5, 0, 8] as [number, number, number, number],
      },
      { text: 'Observações:', bold: true, fontSize: 9, margin: [0, 0, 0, 3] as [number, number, number, number] },
      { text: invoice.notes, fontSize: 8, color: '#555', margin: [0, 0, 0, 10] as [number, number, number, number] },
    );
  }

  // Km legend (conditional)
  const hasKmExpenses = await db.select({ id: expenses.id })
    .from(expenseInvoiceItems)
    .innerJoin(expenses, eq(expenseInvoiceItems.expenseId, expenses.id))
    .innerJoin(projectExpenseCategories, eq(expenses.expenseCategoryId, projectExpenseCategories.id))
    .where(and(
      eq(expenseInvoiceItems.expenseInvoiceId, invoiceId),
      eq(projectExpenseCategories.isKmCategory, true),
    ))
    .limit(1);

  if (hasKmExpenses.length > 0) {
    const [kmCat] = await db.select({ kmRate: projectExpenseCategories.kmRate })
      .from(projectExpenseCategories)
      .where(and(
        eq(projectExpenseCategories.projectId, invoice.projectId),
        eq(projectExpenseCategories.isKmCategory, true),
        eq(projectExpenseCategories.isActive, true),
      ))
      .limit(1);

    if (kmCat?.kmRate) {
      const kmRateLegend = Number(kmCat.kmRate).toLocaleString('pt-BR', {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      });
      content.push({
        text: `* Valor do kilometro rodado = R$ ${kmRateLegend}/KM`,
        fontSize: 8, italics: true, color: '#666',
        margin: [0, 0, 0, 10] as [number, number, number, number],
      });
    }
  }

  // Bank info
  content.push(...buildBankInfo(bankAccount));

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
      tableHeader: { bold: true, fontSize: 8, fillColor: '#f0f0f0' },
    },
  };

  return pdfToBuffer(docDefinition);
}
