import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';

interface ExpenseApprovedEmailParams {
  consultantName: string;
  expenseCount: number;
  totalAmount: string;
  appName: string;
}

export function buildExpenseApprovedEmail({
  consultantName,
  expenseCount,
  totalAmount,
  appName,
}: ExpenseApprovedEmailParams): { subject: string; html: string; text: string } {
  return {
    subject: `${expenseCount} despesa(s) aprovada(s) - Total ${totalAmount}`,
    text: [
      `Olá, ${consultantName}!`,
      '',
      `Suas despesas foram aprovadas.`,
      `Total: ${expenseCount} despesa(s), ${totalAmount}.`,
      '',
      'Nenhuma ação necessária.',
    ].join('\n'),
    html: buildEmailLayout({
      title: `Despesas Aprovadas - ${appName}`,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827;">
          Despesas Aprovadas
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
          Olá, <strong>${escapeHtml(consultantName)}</strong>! Suas despesas foram aprovadas com sucesso.
        </p>
        <div style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 8px;font-size:14px;color:#374151;font-weight:600;">Resumo:</p>
          <p style="margin:0 0 4px;font-size:14px;color:#374151;">Despesas aprovadas: <strong>${expenseCount}</strong></p>
          <p style="margin:0;font-size:14px;color:#374151;">Total: <strong>${escapeHtml(totalAmount)}</strong></p>
        </div>
        <p style="margin:0;font-size:14px;color:#6b7280;line-height:1.6;">
          Nenhuma ação necessária. Este é apenas um aviso de confirmação.
        </p>`,
    }),
  };
}
