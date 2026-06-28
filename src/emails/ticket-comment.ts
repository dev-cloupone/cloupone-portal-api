import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';
import { t, type Locale } from './translations';

interface TicketCommentEmailParams {
  recipientName?: string;
  ticketCode: string;
  ticketTitle: string;
  commentAuthorName: string;
  commentPreview: string;
  ticketUrl: string;
  locale?: Locale;
}

export function buildTicketCommentEmail({ recipientName, ticketCode, ticketTitle, commentAuthorName, commentPreview, ticketUrl, locale = 'pt-BR' }: TicketCommentEmailParams): { subject: string; html: string; text: string } {
  return {
    subject: t(locale, 'ticketComment.subject', { code: ticketCode, title: ticketTitle }),
    text: [
      ...(recipientName ? [t(locale, 'common.hello', { name: recipientName }), ''] : []),
      t(locale, 'ticketComment.descriptionText', { authorName: commentAuthorName, code: ticketCode, title: ticketTitle }),
      '',
      `"${commentPreview}"`,
      '',
      `${t(locale, 'ticket.accessTicket')} ${ticketUrl}`,
    ].join('\n'),
    html: buildEmailLayout({
      title: `${t(locale, 'ticketComment.heading')} - ${ticketCode}`,
      locale,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0F172A;">
          ${t(locale, 'ticketComment.heading')}
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.6;">
          ${recipientName ? `${t(locale, 'common.hello', { name: `<strong>${escapeHtml(recipientName)}</strong>` })} ` : ''}${t(locale, 'ticketComment.descriptionPersonal', { authorName: escapeHtml(commentAuthorName) })}
        </p>
        <div style="background-color:#f5f7ff;border:1px solid #e0e3f0;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 4px;font-size:14px;color:#334155;">Ticket: <strong>${escapeHtml(ticketCode)} — ${escapeHtml(ticketTitle)}</strong></p>
          <div style="border-top:1px solid #e0e3f0;margin-top:12px;padding-top:12px;">
            <p style="margin:0;font-size:14px;color:#334155;font-style:italic;line-height:1.5;">"${escapeHtml(commentPreview)}"</p>
          </div>
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${ticketUrl}" style="display:inline-block;padding:14px 32px;background-color:#3B82F6;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                ${t(locale, 'ticketComment.button')}
              </a>
            </td>
          </tr>
        </table>`,
    }),
  };
}
