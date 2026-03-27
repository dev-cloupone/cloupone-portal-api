import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';

interface ExpenseRejectedEmailParams {
  consultantName: string;
  date: string;
  categoryName: string;
  amount: string;
  description: string;
  comment: string;
  reviewerName: string;
  appName: string;
  expensesUrl: string;
}

export function buildExpenseRejectedEmail({
  consultantName,
  date,
  categoryName,
  amount,
  description,
  comment,
  reviewerName,
  appName,
  expensesUrl,
}: ExpenseRejectedEmailParams): { subject: string; html: string; text: string } {
  return {
    subject: `Despesa rejeitada: ${categoryName} ${amount}`,
    text: [
      `Olá, ${consultantName}!`,
      '',
      `Sua despesa do dia ${date} (${categoryName}, ${amount}) foi rejeitada por ${reviewerName}.`,
      '',
      `Descrição: ${description}`,
      `Motivo: ${comment}`,
      '',
      `Acesse o sistema para corrigir e resubmeter: ${expensesUrl}`,
    ].join('\n'),
    html: buildEmailLayout({
      title: `Despesa Rejeitada - ${appName}`,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827;">
          Despesa Rejeitada
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
          Olá, <strong>${escapeHtml(consultantName)}</strong>! O gestor solicitou uma correção na sua despesa.
        </p>
        <div style="background-color:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 8px;font-size:14px;color:#374151;font-weight:600;">Detalhes:</p>
          <p style="margin:0 0 4px;font-size:14px;color:#374151;">Data: <strong>${escapeHtml(date)}</strong></p>
          <p style="margin:0 0 4px;font-size:14px;color:#374151;">Categoria: <strong>${escapeHtml(categoryName)}</strong></p>
          <p style="margin:0 0 4px;font-size:14px;color:#374151;">Valor: <strong>${escapeHtml(amount)}</strong></p>
          <p style="margin:0 0 12px;font-size:14px;color:#374151;">Descrição: ${escapeHtml(description)}</p>
          <div style="border-top:1px solid #fecaca;padding-top:12px;">
            <p style="margin:0 0 4px;font-size:13px;color:#6b7280;font-weight:600;">Motivo da rejeição (${escapeHtml(reviewerName)}):</p>
            <p style="margin:0;font-size:14px;color:#991b1b;font-style:italic;">"${escapeHtml(comment)}"</p>
          </div>
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${expensesUrl}" style="display:inline-block;padding:14px 32px;background-color:#10b981;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                Corrigir Despesa
              </a>
            </td>
          </tr>
        </table>`,
    }),
  };
}
