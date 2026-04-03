import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';

interface MonthReopenedEmailParams {
  userName: string;
  monthYear: string;
  reason: string;
  appName: string;
  timesheetUrl: string;
}

export function buildMonthReopenedEmail({ userName, monthYear, reason, appName, timesheetUrl }: MonthReopenedEmailParams): { subject: string; html: string; text: string } {
  return {
    subject: `Mês reaberto: ${monthYear}`,
    text: [
      `Olá, ${userName}!`,
      '',
      `Seus apontamentos de ${monthYear} foram reabertos para correção.`,
      '',
      `Motivo: ${reason}`,
      '',
      `Acesse o sistema para revisar e re-aprovar: ${timesheetUrl}`,
    ].join('\n'),
    html: buildEmailLayout({
      title: `Mês Reaberto - ${appName}`,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827;">
          Mês Reaberto
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
          Olá, <strong>${escapeHtml(userName)}</strong>! O gestor reabriu seus apontamentos para correção.
        </p>
        <div style="background-color:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 8px;font-size:14px;color:#374151;font-weight:600;">Detalhes:</p>
          <p style="margin:0 0 12px;font-size:14px;color:#374151;">Período: <strong>${escapeHtml(monthYear)}</strong></p>
          <div style="border-top:1px solid #fde68a;padding-top:12px;">
            <p style="margin:0 0 4px;font-size:13px;color:#6b7280;font-weight:600;">Motivo da reabertura:</p>
            <p style="margin:0;font-size:14px;color:#92400e;font-style:italic;">"${escapeHtml(reason)}"</p>
          </div>
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${timesheetUrl}" style="display:inline-block;padding:14px 32px;background-color:#10b981;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                Revisar Apontamentos
              </a>
            </td>
          </tr>
        </table>`,
    }),
  };
}
