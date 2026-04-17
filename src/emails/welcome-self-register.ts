import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';

interface WelcomeSelfRegisterEmailParams {
  name: string;
  appName: string;
  loginUrl: string;
}

export function buildWelcomeSelfRegisterEmail({ name, appName, loginUrl }: WelcomeSelfRegisterEmailParams): { subject: string; html: string; text: string } {
  return {
    subject: `Cloup One | Bem-vindo(a)`,
    text: [
      `Olá, ${name}!`,
      '',
      `Seu cadastro no ${appName} foi realizado com sucesso.`,
      '',
      `Acesse: ${loginUrl}`,
    ].join('\n'),
    html: buildEmailLayout({
      title: `Bem-vindo(a) ao ${appName}`,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0F172A;">
          Bem-vindo(a) ao ${escapeHtml(appName)}!
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.6;">
          Olá, <strong>${escapeHtml(name)}</strong>! Seu cadastro foi realizado com sucesso.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${loginUrl}" style="display:inline-block;padding:14px 32px;background-color:#3B82F6;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                Fazer Login
              </a>
            </td>
          </tr>
        </table>`,
    }),
  };
}
