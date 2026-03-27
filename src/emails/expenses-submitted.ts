import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';

interface ExpensesSubmittedEmailParams {
  managerName: string;
  consultantName: string;
  weekStart: string;
  weekEnd: string;
  expenseCount: number;
  totalAmount: string;
  approvalUrl: string;
  appName: string;
}

export function buildExpensesSubmittedEmail({
  managerName,
  consultantName,
  weekStart,
  weekEnd,
  expenseCount,
  totalAmount,
  approvalUrl,
  appName,
}: ExpensesSubmittedEmailParams): { subject: string; html: string; text: string } {
  return {
    subject: `${expenseCount} despesa(s) aguardam aprovação - ${consultantName}`,
    text: [
      `Olá, ${managerName}!`,
      '',
      `${consultantName} submeteu ${expenseCount} despesa(s) no valor total de ${totalAmount} para o período de ${weekStart} a ${weekEnd}.`,
      '',
      `Acesse o sistema para revisar e aprovar: ${approvalUrl}`,
    ].join('\n'),
    html: buildEmailLayout({
      title: `Despesas para Aprovação - ${appName}`,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827;">
          Despesas Aguardando Aprovação
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
          Olá, <strong>${escapeHtml(managerName)}</strong>! Novas despesas foram submetidas para sua análise.
        </p>
        <div style="background-color:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 8px;font-size:14px;color:#374151;font-weight:600;">Resumo:</p>
          <p style="margin:0 0 4px;font-size:14px;color:#374151;">Consultor: <strong>${escapeHtml(consultantName)}</strong></p>
          <p style="margin:0 0 4px;font-size:14px;color:#374151;">Período: <strong>${escapeHtml(weekStart)}</strong> a <strong>${escapeHtml(weekEnd)}</strong></p>
          <p style="margin:0 0 4px;font-size:14px;color:#374151;">Quantidade: <strong>${expenseCount} despesa(s)</strong></p>
          <p style="margin:0;font-size:14px;color:#374151;">Total: <strong>${escapeHtml(totalAmount)}</strong></p>
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${approvalUrl}" style="display:inline-block;padding:14px 32px;background-color:#10b981;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                Revisar Despesas
              </a>
            </td>
          </tr>
        </table>`,
    }),
  };
}
