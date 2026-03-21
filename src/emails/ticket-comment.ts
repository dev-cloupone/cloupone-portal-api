import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';

interface TicketCommentEmailParams {
  recipientName: string;
  ticketCode: string;
  ticketTitle: string;
  commentAuthorName: string;
  commentPreview: string;
  ticketUrl: string;
}

export function buildTicketCommentEmail({ recipientName, ticketCode, ticketTitle, commentAuthorName, commentPreview, ticketUrl }: TicketCommentEmailParams): { subject: string; html: string; text: string } {
  return {
    subject: `[${ticketCode}] Novo comentário: ${ticketTitle}`,
    text: [
      `Olá, ${recipientName}!`,
      '',
      `${commentAuthorName} comentou no ticket ${ticketCode} "${ticketTitle}":`,
      '',
      `"${commentPreview}"`,
      '',
      `Acesse o ticket: ${ticketUrl}`,
    ].join('\n'),
    html: buildEmailLayout({
      title: `Novo Comentário - ${ticketCode}`,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827;">
          Novo Comentário
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
          Olá, <strong>${escapeHtml(recipientName)}</strong>! <strong>${escapeHtml(commentAuthorName)}</strong> comentou no ticket.
        </p>
        <div style="background-color:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 4px;font-size:14px;color:#374151;">Ticket: <strong>${escapeHtml(ticketCode)} — ${escapeHtml(ticketTitle)}</strong></p>
          <div style="border-top:1px solid #e5e7eb;margin-top:12px;padding-top:12px;">
            <p style="margin:0;font-size:14px;color:#374151;font-style:italic;line-height:1.5;">"${escapeHtml(commentPreview)}"</p>
          </div>
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${ticketUrl}" style="display:inline-block;padding:14px 32px;background-color:#10b981;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                Ver Comentário
              </a>
            </td>
          </tr>
        </table>`,
    }),
  };
}
