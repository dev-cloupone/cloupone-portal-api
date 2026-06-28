import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';
import { t, type Locale } from './translations';

interface PasswordChangedEmailParams {
  name: string;
  appName: string;
  timestamp: string;
  locale?: Locale;
}

export function buildPasswordChangedEmail({ name, appName, timestamp, locale = 'pt-BR' }: PasswordChangedEmailParams): { subject: string; html: string; text: string } {
  return {
    subject: t(locale, 'passwordChanged.subject'),
    text: [
      t(locale, 'welcome.greetingText', { name }),
      '',
      t(locale, 'passwordChanged.greetingText', { appName, timestamp }),
      '',
      t(locale, 'passwordChanged.warning'),
    ].join('\n'),
    html: buildEmailLayout({
      title: t(locale, 'passwordChanged.heading'),
      locale,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0F172A;">
          ${t(locale, 'passwordChanged.heading')}
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.6;">
          ${t(locale, 'passwordChanged.greeting', { name: escapeHtml(name), appName: escapeHtml(appName) })}
        </p>
        <div style="background-color:#f5f7ff;border:1px solid #e0e3f0;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0;font-size:14px;color:#334155;">
            ${t(locale, 'passwordChanged.timestamp')} <strong>${escapeHtml(timestamp)}</strong>
          </p>
        </div>
        <div style="border-top:1px solid #e0e3f0;padding-top:24px;">
          <p style="margin:0;font-size:14px;color:#ef4444;line-height:1.6;font-weight:600;">
            ${t(locale, 'passwordChanged.warning')}
          </p>
        </div>`,
    }),
  };
}
