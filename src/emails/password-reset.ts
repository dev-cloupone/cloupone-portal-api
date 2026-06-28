import { buildEmailLayout, getSupportContactText } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';
import { t, type Locale } from './translations';

interface PasswordResetEmailParams {
  name: string;
  resetUrl: string;
  expiryMinutes: number;
  appName: string;
  locale?: Locale;
}

export function buildPasswordResetEmail({ name, resetUrl, expiryMinutes, locale = 'pt-BR' }: PasswordResetEmailParams): { subject: string; html: string; text: string } {
  return {
    subject: t(locale, 'passwordReset.subject'),
    text: [
      t(locale, 'welcome.greetingText', { name }),
      '',
      t(locale, 'passwordReset.greetingText'),
      '',
      t(locale, 'passwordReset.linkInstruction'),
      resetUrl,
      '',
      t(locale, 'passwordReset.expiryText', { minutes: String(expiryMinutes) }),
      '',
      t(locale, 'passwordReset.ignore'),
      '',
      getSupportContactText(locale),
    ].join('\n'),
    html: buildEmailLayout({
      title: t(locale, 'passwordReset.heading'),
      locale,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0F172A;">
          ${t(locale, 'passwordReset.heading')}
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.6;">
          ${t(locale, 'passwordReset.greeting', { name: escapeHtml(name) })}
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${resetUrl}" style="display:inline-block;padding:14px 32px;background-color:#3B82F6;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                ${t(locale, 'passwordReset.button')}
              </a>
            </td>
          </tr>
        </table>
        <div style="border-top:1px solid #e0e3f0;padding-top:24px;">
          <p style="margin:0 0 8px;font-size:14px;color:#64748B;line-height:1.6;">
            ${t(locale, 'passwordReset.expiry', { minutes: String(expiryMinutes) })}
          </p>
          <p style="margin:0;font-size:14px;color:#64748B;line-height:1.6;">
            ${t(locale, 'passwordReset.ignore')}
          </p>
        </div>`,
    }),
  };
}
