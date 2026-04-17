import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';

interface TicketAttachmentEmailParams {
  recipientName: string;
  ticketCode: string;
  ticketTitle: string;
  uploaderName: string;
  fileName: string;
  ticketUrl: string;
}

export function buildTicketAttachmentEmail({ recipientName, ticketCode, ticketTitle, uploaderName, fileName, ticketUrl }: TicketAttachmentEmailParams): { subject: string; html: string; text: string } {
  return {
    subject: `Cloup One | [${ticketCode}] Novo anexo: ${ticketTitle}`,
    text: [
      `Olá, ${recipientName}!`,
      '',
      `${uploaderName} anexou um arquivo no ticket ${ticketCode} "${ticketTitle}":`,
      '',
      `Arquivo: ${fileName}`,
      '',
      `Acesse o ticket: ${ticketUrl}`,
    ].join('\n'),
    html: buildEmailLayout({
      title: `Novo Anexo - ${ticketCode}`,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0F172A;">
          Novo Anexo
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.6;">
          Olá, <strong>${escapeHtml(recipientName)}</strong>! <strong>${escapeHtml(uploaderName)}</strong> anexou um arquivo no ticket.
        </p>
        <div style="background-color:#f5f7ff;border:1px solid #e0e3f0;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 4px;font-size:14px;color:#334155;">Ticket: <strong>${escapeHtml(ticketCode)} — ${escapeHtml(ticketTitle)}</strong></p>
          <div style="border-top:1px solid #e0e3f0;margin-top:12px;padding-top:12px;">
            <p style="margin:0;font-size:14px;color:#334155;line-height:1.5;">📎 ${escapeHtml(fileName)}</p>
          </div>
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${ticketUrl}" style="display:inline-block;padding:14px 32px;background-color:#3B82F6;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                Ver Anexo
              </a>
            </td>
          </tr>
        </table>`,
    }),
  };
}
