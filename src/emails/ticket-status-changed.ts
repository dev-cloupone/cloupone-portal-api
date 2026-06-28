import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';
import { t, getStatusLabel, type Locale } from './translations';

interface TicketStatusChangedEmailParams {
  recipientName?: string;
  ticketCode: string;
  ticketTitle: string;
  oldStatus: string;
  newStatus: string;
  changedByName: string;
  ticketUrl: string;
  locale?: Locale;
}

export function buildTicketStatusChangedEmail({ recipientName, ticketCode, ticketTitle, oldStatus, newStatus, changedByName, ticketUrl, locale = 'pt-BR' }: TicketStatusChangedEmailParams): { subject: string; html: string; text: string } {
  const oldLabel = getStatusLabel(locale, oldStatus);
  const newLabel = getStatusLabel(locale, newStatus);

  return {
    subject: t(locale, 'ticketStatus.subject', { code: ticketCode, oldStatus: oldLabel, newStatus: newLabel }),
    text: [
      ...(recipientName ? [t(locale, 'common.hello', { name: recipientName }), ''] : []),
      t(locale, 'ticketStatus.descriptionText', { code: ticketCode, title: ticketTitle }),
      `${t(locale, 'ticket.from')} ${oldLabel}`,
      `${t(locale, 'ticket.to')} ${newLabel}`,
      `${t(locale, 'ticket.by')} ${changedByName}`,
      '',
      `${t(locale, 'ticket.accessTicket')} ${ticketUrl}`,
    ].join('\n'),
    html: buildEmailLayout({
      title: `${t(locale, 'ticketStatus.heading')} - ${ticketCode}`,
      locale,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0F172A;">
          ${t(locale, 'ticketStatus.heading')}
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.6;">
          ${recipientName ? `${t(locale, 'common.hello', { name: `<strong>${escapeHtml(recipientName)}</strong>` })} ` : ''}${t(locale, 'ticketStatus.greeting')}
        </p>
        <div style="background-color:#f5f7ff;border:1px solid #e0e3f0;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 4px;font-size:14px;color:#334155;">${t(locale, 'ticket.code')} <strong>${escapeHtml(ticketCode)}</strong></p>
          <p style="margin:0 0 12px;font-size:14px;color:#334155;">${t(locale, 'ticket.title')} <strong>${escapeHtml(ticketTitle)}</strong></p>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="display:inline-block;padding:6px 12px;background-color:#fef2f2;border:1px solid #fecaca;border-radius:6px;font-size:13px;color:#991b1b;font-weight:600;">${escapeHtml(oldLabel)}</span>
            <span style="font-size:16px;color:#64748B;">&rarr;</span>
            <span style="display:inline-block;padding:6px 12px;background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;font-size:13px;color:#166534;font-weight:600;">${escapeHtml(newLabel)}</span>
          </div>
          <p style="margin:12px 0 0;font-size:13px;color:#64748B;">${t(locale, 'ticketStatus.changedBy')} ${escapeHtml(changedByName)}</p>
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${ticketUrl}" style="display:inline-block;padding:14px 32px;background-color:#3B82F6;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                ${t(locale, 'ticketStatus.button')}
              </a>
            </td>
          </tr>
        </table>`,
    }),
  };
}
