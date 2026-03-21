import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';

interface DailyReminderEmailParams {
  userName: string;
  date: string;
  appName: string;
  timesheetUrl: string;
}

export function buildDailyReminderEmail({ userName, date, appName, timesheetUrl }: DailyReminderEmailParams): { subject: string; html: string; text: string } {
  return {
    subject: `Lembrete: Apontar horas de ${date}`,
    text: [
      `Olá, ${userName}!`,
      '',
      `Você ainda não apontou horas para o dia ${date}.`,
      '',
      `Acesse o sistema para registrar suas horas: ${timesheetUrl}`,
      '',
      'Manter seus apontamentos em dia facilita o processo de aprovação e faturamento.',
    ].join('\n'),
    html: buildEmailLayout({
      title: `Lembrete de Apontamento - ${appName}`,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827;">
          Lembrete de Apontamento
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
          Olá, <strong>${escapeHtml(userName)}</strong>! Você ainda não registrou horas para o dia <strong>${escapeHtml(date)}</strong>.
        </p>
        <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">
          Manter seus apontamentos em dia facilita o processo de aprovação e faturamento.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${timesheetUrl}" style="display:inline-block;padding:14px 32px;background-color:#10b981;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                Apontar Horas
              </a>
            </td>
          </tr>
        </table>`,
    }),
  };
}
