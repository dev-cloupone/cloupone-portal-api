import { buildEmailLayout, SUPPORT_CONTACT_TEXT } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';

interface PasswordResetEmailParams {
  name: string;
  resetUrl: string;
  expiryMinutes: number;
  appName: string;
}

export function buildPasswordResetEmail({ name, resetUrl, expiryMinutes }: PasswordResetEmailParams): { subject: string; html: string; text: string } {
  return {
    subject: 'Redefinição de senha',
    text: [
      `Olá, ${name}!`,
      '',
      'Recebemos uma solicitação para redefinir sua senha.',
      '',
      'Clique no link abaixo para criar uma nova senha:',
      resetUrl,
      '',
      `Este link expira em ${expiryMinutes} minutos.`,
      '',
      'Se você não solicitou esta redefinição, ignore este email.',
      '',
      SUPPORT_CONTACT_TEXT,
    ].join('\n'),
    html: buildEmailLayout({
      title: 'Redefinição de Senha',
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827;">
          Redefinição de Senha
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
          Olá, <strong>${escapeHtml(name)}</strong>! Recebemos uma solicitação para redefinir sua senha.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${resetUrl}" style="display:inline-block;padding:14px 32px;background-color:#10b981;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                Redefinir Senha
              </a>
            </td>
          </tr>
        </table>
        <div style="border-top:1px solid #e5e7eb;padding-top:24px;">
          <p style="margin:0 0 8px;font-size:14px;color:#6b7280;line-height:1.6;">
            Este link expira em <strong>${expiryMinutes} minutos</strong>.
          </p>
          <p style="margin:0;font-size:14px;color:#6b7280;line-height:1.6;">
            Se você não solicitou esta redefinição, ignore este email.
          </p>
        </div>`,
    }),
  };
}
