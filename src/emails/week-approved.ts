import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';

interface WeekApprovedEmailParams {
  userName: string;
  weekStart: string;
  weekEnd: string;
  totalHours: number;
  approvedCount: number;
  appName: string;
}

export function buildWeekApprovedEmail({ userName, weekStart, weekEnd, totalHours, approvedCount, appName }: WeekApprovedEmailParams): { subject: string; html: string; text: string } {
  return {
    subject: `Apontamentos aprovados: ${weekStart} - ${weekEnd}`,
    text: [
      `Olá, ${userName}!`,
      '',
      `Seus apontamentos da semana de ${weekStart} a ${weekEnd} foram aprovados.`,
      `Total: ${approvedCount} apontamento(s), ${totalHours}h.`,
      '',
      'Nenhuma ação necessária.',
    ].join('\n'),
    html: buildEmailLayout({
      title: `Apontamentos Aprovados - ${appName}`,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827;">
          Apontamentos Aprovados
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
          Olá, <strong>${escapeHtml(userName)}</strong>! Seus apontamentos foram aprovados com sucesso.
        </p>
        <div style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 8px;font-size:14px;color:#374151;font-weight:600;">Resumo:</p>
          <p style="margin:0 0 4px;font-size:14px;color:#374151;">Período: <strong>${escapeHtml(weekStart)}</strong> a <strong>${escapeHtml(weekEnd)}</strong></p>
          <p style="margin:0 0 4px;font-size:14px;color:#374151;">Apontamentos aprovados: <strong>${approvedCount}</strong></p>
          <p style="margin:0;font-size:14px;color:#374151;">Total de horas: <strong>${totalHours}h</strong></p>
        </div>
        <p style="margin:0;font-size:14px;color:#6b7280;line-height:1.6;">
          Nenhuma ação necessária. Este é apenas um aviso de confirmação.
        </p>`,
    }),
  };
}
