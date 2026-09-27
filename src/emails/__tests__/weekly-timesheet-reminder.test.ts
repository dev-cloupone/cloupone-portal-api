import { describe, it, expect } from 'vitest';
import { buildWeeklyTimesheetReminderEmail } from '../weekly-timesheet-reminder';

const baseParams = {
  name: 'Maria Souza',
  weekStart: '15/09',
  weekEnd: '21/09',
  projectNames: ['Projeto Alpha', 'Projeto Beta'],
  timesheetUrl: 'https://portal.cloupone.com.br/timesheet',
};

describe('buildWeeklyTimesheetReminderEmail', () => {
  it('gera subject e text corretos para pt-BR', () => {
    const email = buildWeeklyTimesheetReminderEmail(baseParams);
    expect(email.subject).toBe('Cloup One | Lembrete de apontamento de horas');
    expect(email.text).toContain('Olá, Maria Souza!');
    expect(email.text).toContain('15/09');
    expect(email.text).toContain('21/09');
    expect(email.text).toContain('- Projeto Alpha');
    expect(email.text).toContain(baseParams.timesheetUrl);
  });

  it('inclui o link correto do CTA no html', () => {
    const email = buildWeeklyTimesheetReminderEmail(baseParams);
    expect(email.html).toContain(`href="${baseParams.timesheetUrl}"`);
  });

  it('escapa tentativas de XSS em name e projectNames', () => {
    const email = buildWeeklyTimesheetReminderEmail({
      ...baseParams,
      name: '<script>alert("xss")</script>',
      projectNames: ['<img src=x onerror=alert(1)>'],
    });
    expect(email.html).not.toContain('<script>alert');
    expect(email.html).not.toContain('<img src=x onerror');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('usa traduções en-US quando o locale é informado', () => {
    const email = buildWeeklyTimesheetReminderEmail({ ...baseParams, locale: 'en-US' });
    expect(email.subject).toBe('Cloup One | Timesheet Reminder');
    expect(email.text).toContain('Hi Maria Souza!');
  });

  it('mantém o html estável (snapshot)', () => {
    const email = buildWeeklyTimesheetReminderEmail(baseParams);
    expect(email.html).toMatchSnapshot();
  });
});
