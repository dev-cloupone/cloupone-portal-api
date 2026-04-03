import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';

interface MonthEscalationEmailParams {
  gestorName: string;
  consultantName: string;
  monthYear: string;
  appName: string;
  timesheetUrl: string;
}

export function buildMonthEscalationEmail({ gestorName, consultantName, monthYear, appName, timesheetUrl }: MonthEscalationEmailParams): { subject: string; html: string; text: string } {
  return {
    subject: `Escalonamento: ${consultantName} não aprovou ${monthYear}`,
    text: [
      `Olá, ${gestorName}!`,
      '',
      `O consultor ${consultantName} ainda não aprovou os apontamentos de ${monthYear}.`,
      `Já se passaram mais de 3 dias úteis desde o início do mês seguinte.`,
      '',
      `Acesse o sistema para revisar: ${timesheetUrl}`,
    ].join('\n'),
    html: buildEmailLayout({
      title: `Escalonamento de Aprovação - ${appName}`,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827;">
          Escalonamento de Aprovação
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
          Olá, <strong>${escapeHtml(gestorName)}</strong>! Um consultor ainda não aprovou seus apontamentos no prazo.
        </p>
        <div style="background-color:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 8px;font-size:14px;color:#374151;font-weight:600;">Detalhes:</p>
          <p style="margin:0 0 4px;font-size:14px;color:#374151;">Consultor: <strong>${escapeHtml(consultantName)}</strong></p>
          <p style="margin:0;font-size:14px;color:#374151;">Período pendente: <strong>${escapeHtml(monthYear)}</strong></p>
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${timesheetUrl}" style="display:inline-block;padding:14px 32px;background-color:#10b981;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                Revisar Aprovações
              </a>
            </td>
          </tr>
        </table>`,
    }),
  };
}
