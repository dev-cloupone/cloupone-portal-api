import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';

interface TicketStatusChangedEmailParams {
  recipientName: string;
  ticketCode: string;
  ticketTitle: string;
  oldStatus: string;
  newStatus: string;
  changedByName: string;
  ticketUrl: string;
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Aberto',
  in_analysis: 'Em Análise',
  awaiting_customer: 'Aguardando Retorno do Cliente',
  awaiting_third_party: 'Aguardando Terceiro',
  finished: 'Finalizado',
};

export function buildTicketStatusChangedEmail({ recipientName, ticketCode, ticketTitle, oldStatus, newStatus, changedByName, ticketUrl }: TicketStatusChangedEmailParams): { subject: string; html: string; text: string } {
  const oldLabel = STATUS_LABELS[oldStatus] || oldStatus;
  const newLabel = STATUS_LABELS[newStatus] || newStatus;

  return {
    subject: `[${ticketCode}] Status alterado: ${oldLabel} → ${newLabel}`,
    text: [
      `Olá, ${recipientName}!`,
      '',
      `O status do ticket ${ticketCode} "${ticketTitle}" foi alterado.`,
      `De: ${oldLabel}`,
      `Para: ${newLabel}`,
      `Por: ${changedByName}`,
      '',
      `Acesse o ticket: ${ticketUrl}`,
    ].join('\n'),
    html: buildEmailLayout({
      title: `Status Alterado - ${ticketCode}`,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827;">
          Status do Ticket Alterado
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
          Olá, <strong>${escapeHtml(recipientName)}</strong>! O status do ticket foi atualizado.
        </p>
        <div style="background-color:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 4px;font-size:14px;color:#374151;">Código: <strong>${escapeHtml(ticketCode)}</strong></p>
          <p style="margin:0 0 12px;font-size:14px;color:#374151;">Título: <strong>${escapeHtml(ticketTitle)}</strong></p>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="display:inline-block;padding:6px 12px;background-color:#fef2f2;border:1px solid #fecaca;border-radius:6px;font-size:13px;color:#991b1b;font-weight:600;">${escapeHtml(oldLabel)}</span>
            <span style="font-size:16px;color:#6b7280;">→</span>
            <span style="display:inline-block;padding:6px 12px;background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;font-size:13px;color:#166534;font-weight:600;">${escapeHtml(newLabel)}</span>
          </div>
          <p style="margin:12px 0 0;font-size:13px;color:#6b7280;">Alterado por: ${escapeHtml(changedByName)}</p>
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${ticketUrl}" style="display:inline-block;padding:14px 32px;background-color:#10b981;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                Ver Ticket
              </a>
            </td>
          </tr>
        </table>`,
    }),
  };
}
