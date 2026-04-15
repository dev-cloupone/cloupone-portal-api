import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';

interface PasswordChangedEmailParams {
  name: string;
  appName: string;
  timestamp: string;
}

export function buildPasswordChangedEmail({ name, appName, timestamp }: PasswordChangedEmailParams): { subject: string; html: string; text: string } {
  return {
    subject: `Senha alterada - ${appName}`,
    text: [
      `Olá, ${name}!`,
      '',
      `Sua senha no ${appName} foi alterada com sucesso em ${timestamp}.`,
      '',
      'Se você não realizou esta alteração, entre em contato com o suporte imediatamente.',
    ].join('\n'),
    html: buildEmailLayout({
      title: 'Senha Alterada',
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0F172A;">
          Senha Alterada
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.6;">
          Olá, <strong>${escapeHtml(name)}</strong>! Sua senha no <strong>${escapeHtml(appName)}</strong> foi alterada com sucesso.
        </p>
        <div style="background-color:#f5f7ff;border:1px solid #e0e3f0;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0;font-size:14px;color:#334155;">
            Data/hora da alteração: <strong>${escapeHtml(timestamp)}</strong>
          </p>
        </div>
        <div style="border-top:1px solid #e0e3f0;padding-top:24px;">
          <p style="margin:0;font-size:14px;color:#ef4444;line-height:1.6;font-weight:600;">
            Se você não realizou esta alteração, entre em contato com o suporte imediatamente.
          </p>
        </div>`,
    }),
  };
}
