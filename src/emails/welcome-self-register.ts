import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';
import { t, type Locale } from './translations';

interface WelcomeSelfRegisterEmailParams {
  name: string;
  appName: string;
  loginUrl: string;
  locale?: Locale;
}

export function buildWelcomeSelfRegisterEmail({ name, appName, loginUrl, locale = 'pt-BR' }: WelcomeSelfRegisterEmailParams): { subject: string; html: string; text: string } {
  return {
    subject: t(locale, 'welcomeSelfRegister.subject'),
    text: [
      t(locale, 'welcome.greetingText', { name }),
      '',
      t(locale, 'welcomeSelfRegister.greetingText', { appName }),
      '',
      `${t(locale, 'welcome.access')} ${loginUrl}`,
    ].join('\n'),
    html: buildEmailLayout({
      title: t(locale, 'welcomeSelfRegister.heading', { appName }),
      locale,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0F172A;">
          ${t(locale, 'welcomeSelfRegister.heading', { appName: escapeHtml(appName) })}
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.6;">
          ${t(locale, 'welcomeSelfRegister.greeting', { name: escapeHtml(name) })}
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${loginUrl}" style="display:inline-block;padding:14px 32px;background-color:#3B82F6;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                ${t(locale, 'welcomeSelfRegister.button')}
              </a>
            </td>
          </tr>
        </table>`,
    }),
  };
}
