import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';

interface TicketCreatedEmailParams {
  projectName: string;
  ticketCode: string;
  ticketTitle: string;
  ticketType: string;
  createdByName: string;
  ticketUrl: string;
}

const TYPE_LABELS: Record<string, string> = {
  bug: 'Bug',
  improvement: 'Melhoria',
  initiative: 'Iniciativa',
};

export function buildTicketCreatedEmail({ projectName, ticketCode, ticketTitle, ticketType, createdByName, ticketUrl }: TicketCreatedEmailParams): { subject: string; html: string; text: string } {
  const typeLabel = TYPE_LABELS[ticketType] || ticketType;

  return {
    subject: `[${ticketCode}] Novo ticket: ${ticketTitle}`,
    text: [
      `Novo ticket criado no projeto "${projectName}".`,
      '',
      `Código: ${ticketCode}`,
      `Título: ${ticketTitle}`,
      `Tipo: ${typeLabel}`,
      `Criado por: ${createdByName}`,
      '',
      `Acesse o ticket: ${ticketUrl}`,
    ].join('\n'),
    html: buildEmailLayout({
      title: `Novo Ticket - ${projectName}`,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827;">
          Novo Ticket Criado
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
          Um novo ticket foi aberto no projeto <strong>${escapeHtml(projectName)}</strong>.
        </p>
        <div style="background-color:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 4px;font-size:14px;color:#374151;">Código: <strong>${escapeHtml(ticketCode)}</strong></p>
          <p style="margin:0 0 4px;font-size:14px;color:#374151;">Título: <strong>${escapeHtml(ticketTitle)}</strong></p>
          <p style="margin:0 0 4px;font-size:14px;color:#374151;">Tipo: <strong>${escapeHtml(typeLabel)}</strong></p>
          <p style="margin:0;font-size:14px;color:#374151;">Criado por: <strong>${escapeHtml(createdByName)}</strong></p>
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
