import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';

interface WeeklyReminderEmailParams {
  userName: string;
  weekStart: string;
  weekEnd: string;
  totalHours: number;
  targetHours: number;
  appName: string;
  timesheetUrl: string;
}

export function buildWeeklyReminderEmail({ userName, weekStart, weekEnd, totalHours, targetHours, appName, timesheetUrl }: WeeklyReminderEmailParams): { subject: string; html: string; text: string } {
  return {
    subject: `Lembrete: Revise e submeta sua semana (${weekStart} - ${weekEnd})`,
    text: [
      `Olá, ${userName}!`,
      '',
      `Sua semana de ${weekStart} a ${weekEnd} ainda não foi submetida para aprovação.`,
      `Horas apontadas: ${totalHours}h / Meta: ${targetHours}h`,
      '',
      `Acesse o sistema para revisar e submeter: ${timesheetUrl}`,
    ].join('\n'),
    html: buildEmailLayout({
      title: `Lembrete Semanal - ${appName}`,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827;">
          Revise e Submeta sua Semana
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
          Olá, <strong>${escapeHtml(userName)}</strong>! Sua semana de <strong>${escapeHtml(weekStart)}</strong> a <strong>${escapeHtml(weekEnd)}</strong> ainda não foi submetida para aprovação.
        </p>
        <div style="background-color:#f3f4f6;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 4px;font-size:14px;color:#374151;">
            Horas apontadas: <strong>${totalHours}h</strong> / Meta: <strong>${targetHours}h</strong>
          </p>
          <div style="background-color:#e5e7eb;border-radius:4px;height:8px;margin-top:12px;">
            <div style="background-color:${totalHours >= targetHours ? '#10b981' : '#f59e0b'};border-radius:4px;height:8px;width:${Math.min(100, Math.round((totalHours / targetHours) * 100))}%;"></div>
          </div>
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${timesheetUrl}" style="display:inline-block;padding:14px 32px;background-color:#10b981;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                Revisar e Submeter
              </a>
            </td>
          </tr>
        </table>`,
    }),
  };
}
