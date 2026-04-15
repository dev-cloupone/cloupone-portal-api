import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';

interface TicketAssignedEmailParams {
  consultantName: string;
  ticketCode: string;
  ticketTitle: string;
  projectName: string;
  assignedByName: string;
  ticketUrl: string;
}

export function buildTicketAssignedEmail({ consultantName, ticketCode, ticketTitle, projectName, assignedByName, ticketUrl }: TicketAssignedEmailParams): { subject: string; html: string; text: string } {
  return {
    subject: `[${ticketCode}] Ticket atribuído a você: ${ticketTitle}`,
    text: [
      `Olá, ${consultantName}!`,
      '',
      `O ticket ${ticketCode} "${ticketTitle}" do projeto "${projectName}" foi atribuído a você por ${assignedByName}.`,
      '',
      `Acesse o ticket: ${ticketUrl}`,
    ].join('\n'),
    html: buildEmailLayout({
      title: `Ticket Atribuído - ${projectName}`,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0F172A;">
          Ticket Atribuído a Você
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.6;">
          Olá, <strong>${escapeHtml(consultantName)}</strong>! Um ticket foi atribuído a você.
        </p>
        <div style="background-color:#f5f7ff;border:1px solid #e0e3f0;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 4px;font-size:14px;color:#334155;">Código: <strong>${escapeHtml(ticketCode)}</strong></p>
          <p style="margin:0 0 4px;font-size:14px;color:#334155;">Título: <strong>${escapeHtml(ticketTitle)}</strong></p>
          <p style="margin:0 0 4px;font-size:14px;color:#334155;">Projeto: <strong>${escapeHtml(projectName)}</strong></p>
          <p style="margin:0;font-size:14px;color:#334155;">Atribuído por: <strong>${escapeHtml(assignedByName)}</strong></p>
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${ticketUrl}" style="display:inline-block;padding:14px 32px;background-color:#3B82F6;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                Ver Ticket
              </a>
            </td>
          </tr>
        </table>`,
    }),
  };
}
