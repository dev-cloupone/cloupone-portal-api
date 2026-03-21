import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';

interface OverdueWeekEmailParams {
  userName: string;
  weekStart: string;
  weekEnd: string;
  totalHours: number;
  appName: string;
  timesheetUrl: string;
}

export function buildOverdueWeekEmail({ userName, weekStart, weekEnd, totalHours, appName, timesheetUrl }: OverdueWeekEmailParams): { subject: string; html: string; text: string } {
  return {
    subject: `Atenção: Semana ${weekStart} - ${weekEnd} pendente de submissão`,
    text: [
      `Olá, ${userName}!`,
      '',
      `Sua semana de ${weekStart} a ${weekEnd} está pendente de submissão.`,
      `Horas apontadas até agora: ${totalHours}h.`,
      '',
      `Acesse o sistema para completar e submeter seus apontamentos: ${timesheetUrl}`,
      '',
      'Submeter seus apontamentos em dia é importante para o processo de faturamento.',
    ].join('\n'),
    html: buildEmailLayout({
      title: `Semana Pendente - ${appName}`,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827;">
          Semana Pendente de Submissão
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
          Olá, <strong>${escapeHtml(userName)}</strong>! Sua semana anterior ainda não foi submetida para aprovação.
        </p>
        <div style="background-color:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 4px;font-size:14px;color:#374151;">
            Período: <strong>${escapeHtml(weekStart)}</strong> a <strong>${escapeHtml(weekEnd)}</strong>
          </p>
          <p style="margin:0;font-size:14px;color:#374151;">
            Horas apontadas: <strong>${totalHours}h</strong>
          </p>
        </div>
        <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">
          Submeter seus apontamentos em dia é importante para o processo de faturamento.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${timesheetUrl}" style="display:inline-block;padding:14px 32px;background-color:#f59e0b;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                Completar e Submeter
              </a>
            </td>
          </tr>
        </table>`,
    }),
  };
}
