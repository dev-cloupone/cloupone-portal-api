import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';
import { t, getTypeLabel, type Locale } from './translations';

interface TicketCreatedEmailParams {
  projectName: string;
  ticketCode: string;
  ticketTitle: string;
  ticketType: string;
  createdByName: string;
  ticketUrl: string;
  locale?: Locale;
}

export function buildTicketCreatedEmail({ projectName, ticketCode, ticketTitle, ticketType, createdByName, ticketUrl, locale = 'pt-BR' }: TicketCreatedEmailParams): { subject: string; html: string; text: string } {
  const typeLabel = getTypeLabel(locale, ticketType);

  return {
    subject: t(locale, 'ticketCreated.subject', { code: ticketCode, title: ticketTitle }),
    text: [
      t(locale, 'ticketCreated.descriptionText', { projectName }),
      '',
      `${t(locale, 'ticket.code')} ${ticketCode}`,
      `${t(locale, 'ticket.title')} ${ticketTitle}`,
      `${t(locale, 'ticket.type')} ${typeLabel}`,
      `${t(locale, 'ticket.createdBy')} ${createdByName}`,
      '',
      `${t(locale, 'ticket.accessTicket')} ${ticketUrl}`,
    ].join('\n'),
    html: buildEmailLayout({
      title: `${t(locale, 'ticketCreated.heading')} - ${projectName}`,
      locale,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0F172A;">
          ${t(locale, 'ticketCreated.heading')}
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.6;">
          ${t(locale, 'ticketCreated.description', { projectName: escapeHtml(projectName) })}
        </p>
        <div style="background-color:#f5f7ff;border:1px solid #e0e3f0;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 4px;font-size:14px;color:#334155;">${t(locale, 'ticket.code')} <strong>${escapeHtml(ticketCode)}</strong></p>
          <p style="margin:0 0 4px;font-size:14px;color:#334155;">${t(locale, 'ticket.title')} <strong>${escapeHtml(ticketTitle)}</strong></p>
          <p style="margin:0 0 4px;font-size:14px;color:#334155;">${t(locale, 'ticket.type')} <strong>${escapeHtml(typeLabel)}</strong></p>
          <p style="margin:0;font-size:14px;color:#334155;">${t(locale, 'ticket.createdBy')} <strong>${escapeHtml(createdByName)}</strong></p>
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${ticketUrl}" style="display:inline-block;padding:14px 32px;background-color:#3B82F6;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                ${t(locale, 'ticketCreated.button')}
              </a>
            </td>
          </tr>
        </table>`,
    }),
  };
}
