import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';
import { t, type Locale } from './translations';

interface WelcomeEmailParams {
  name: string;
  email: string;
  tempPassword: string;
  appName: string;
  loginUrl: string;
  locale?: Locale;
}

export function buildWelcomeEmail({ name, email, tempPassword, appName, loginUrl, locale = 'pt-BR' }: WelcomeEmailParams): { subject: string; html: string; text: string } {
  return {
    subject: t(locale, 'welcome.subject'),
    text: [
      t(locale, 'welcome.greetingText', { name }),
      '',
      t(locale, 'welcome.accountCreated', { appName }),
      '',
      t(locale, 'welcome.credentials'),
      `${t(locale, 'welcome.email')} ${email}`,
      `${t(locale, 'welcome.tempPassword')} ${tempPassword}`,
      '',
      `${t(locale, 'welcome.access')} ${loginUrl}`,
      '',
      t(locale, 'welcome.warningText'),
    ].join('\n'),
    html: buildEmailLayout({
      title: t(locale, 'welcome.heading', { appName }),
      locale,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0F172A;">
          ${t(locale, 'welcome.heading', { appName: escapeHtml(appName) })}
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.6;">
          ${t(locale, 'welcome.greeting', { name: escapeHtml(name) })}
        </p>
        <div style="background-color:#f5f7ff;border:1px solid #e0e3f0;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 8px;font-size:14px;color:#334155;font-weight:600;">${t(locale, 'welcome.credentials')}</p>
          <p style="margin:0 0 4px;font-size:14px;color:#334155;">${t(locale, 'welcome.email')} <strong>${escapeHtml(email)}</strong></p>
          <p style="margin:0;font-size:14px;color:#334155;">${t(locale, 'welcome.tempPassword')} <strong>${escapeHtml(tempPassword)}</strong></p>
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${loginUrl}" style="display:inline-block;padding:14px 32px;background-color:#3B82F6;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                ${t(locale, 'welcome.button')}
              </a>
            </td>
          </tr>
        </table>
        <div style="border-top:1px solid #e0e3f0;padding-top:24px;">
          <p style="margin:0;font-size:14px;color:#64748B;line-height:1.6;">
            ${t(locale, 'welcome.warning')}
          </p>
        </div>`,
    }),
  };
}
