import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';

interface WelcomeEmailParams {
  name: string;
  email: string;
  tempPassword: string;
  appName: string;
  loginUrl: string;
}

export function buildWelcomeEmail({ name, email, tempPassword, appName, loginUrl }: WelcomeEmailParams): { subject: string; html: string; text: string } {
  return {
    subject: `Cloup One | Bem-vindo(a)`,
    text: [
      `Olá, ${name}!`,
      '',
      `Sua conta no ${appName} foi criada com sucesso.`,
      '',
      'Suas credenciais de acesso:',
      `Email: ${email}`,
      `Senha temporária: ${tempPassword}`,
      '',
      `Acesse: ${loginUrl}`,
      '',
      'Por segurança, você deverá alterar sua senha no primeiro acesso.',
    ].join('\n'),
    html: buildEmailLayout({
      title: `Bem-vindo(a) ao ${appName}`,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0F172A;">
          Bem-vindo(a) ao ${escapeHtml(appName)}!
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.6;">
          Olá, <strong>${escapeHtml(name)}</strong>! Sua conta foi criada com sucesso.
        </p>
        <div style="background-color:#f5f7ff;border:1px solid #e0e3f0;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 8px;font-size:14px;color:#334155;font-weight:600;">Suas credenciais de acesso:</p>
          <p style="margin:0 0 4px;font-size:14px;color:#334155;">Email: <strong>${escapeHtml(email)}</strong></p>
          <p style="margin:0;font-size:14px;color:#334155;">Senha temporária: <strong>${escapeHtml(tempPassword)}</strong></p>
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${loginUrl}" style="display:inline-block;padding:14px 32px;background-color:#3B82F6;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                Acessar Plataforma
              </a>
            </td>
          </tr>
        </table>
        <div style="border-top:1px solid #e0e3f0;padding-top:24px;">
          <p style="margin:0;font-size:14px;color:#64748B;line-height:1.6;">
            Por segurança, você deverá <strong>alterar sua senha</strong> no primeiro acesso.
          </p>
        </div>`,
    }),
  };
}
