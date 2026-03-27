import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';

interface ReimbursementExpenseItem {
  date: string;
  categoryName: string;
  amount: string;
}

interface ReimbursementPaidEmailParams {
  consultantName: string;
  expenses: ReimbursementExpenseItem[];
  totalAmount: string;
  paidByName: string;
  appName: string;
}

export function buildReimbursementPaidEmail({
  consultantName,
  expenses,
  totalAmount,
  paidByName,
  appName,
}: ReimbursementPaidEmailParams): { subject: string; html: string; text: string } {
  const expenseListText = expenses
    .map((e) => `  - ${e.date}: ${e.categoryName} (${e.amount})`)
    .join('\n');

  const expenseRowsHtml = expenses
    .map(
      (e) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;">${escapeHtml(e.date)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;">${escapeHtml(e.categoryName)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;text-align:right;font-family:monospace;">${escapeHtml(e.amount)}</td>
        </tr>`,
    )
    .join('');

  return {
    subject: `Reembolso efetuado - ${totalAmount}`,
    text: [
      `Olá, ${consultantName}!`,
      '',
      `Seu reembolso de ${totalAmount} foi efetuado por ${paidByName}.`,
      '',
      'Despesas reembolsadas:',
      expenseListText,
      '',
      `Total: ${totalAmount}`,
    ].join('\n'),
    html: buildEmailLayout({
      title: `Reembolso Efetuado - ${appName}`,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827;">
          Reembolso Efetuado
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
          Olá, <strong>${escapeHtml(consultantName)}</strong>! Seu reembolso foi processado por <strong>${escapeHtml(paidByName)}</strong>.
        </p>
        <div style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 12px;font-size:14px;color:#374151;font-weight:600;">Despesas reembolsadas:</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <th style="padding:8px 12px;border-bottom:2px solid #bbf7d0;font-size:13px;color:#6b7280;text-align:left;">Data</th>
              <th style="padding:8px 12px;border-bottom:2px solid #bbf7d0;font-size:13px;color:#6b7280;text-align:left;">Categoria</th>
              <th style="padding:8px 12px;border-bottom:2px solid #bbf7d0;font-size:13px;color:#6b7280;text-align:right;">Valor</th>
            </tr>
            ${expenseRowsHtml}
            <tr>
              <td colspan="2" style="padding:10px 12px;font-size:14px;color:#374151;font-weight:700;">Total</td>
              <td style="padding:10px 12px;font-size:14px;color:#374151;font-weight:700;text-align:right;font-family:monospace;">${escapeHtml(totalAmount)}</td>
            </tr>
          </table>
        </div>
        <p style="margin:0;font-size:14px;color:#6b7280;line-height:1.6;">
          Nenhuma ação necessária. Este é apenas um aviso de confirmação.
        </p>`,
    }),
  };
}
