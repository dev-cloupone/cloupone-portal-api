import { buildEmailLayout } from '../utils/email-layout';
import { escapeHtml } from '../utils/escape-html';
import { t, type Locale } from './translations';

interface WeeklyTimesheetReminderParams {
  name: string;
  weekStart: string; // "15/09"
  weekEnd: string; // "21/09"
  projectNames: string[];
  timesheetUrl: string;
  locale?: Locale;
}

export function buildWeeklyTimesheetReminderEmail({
  name, weekStart, weekEnd, projectNames, timesheetUrl, locale = 'pt-BR',
}: WeeklyTimesheetReminderParams): { subject: string; html: string; text: string } {
  return {
    subject: t(locale, 'weeklyTimesheetReminder.subject'),
    text: [
      t(locale, 'welcome.greetingText', { name }),
      '',
      t(locale, 'weeklyTimesheetReminder.greetingText', { weekStart, weekEnd }),
      '',
      t(locale, 'weeklyTimesheetReminder.projectsLabel'),
      ...projectNames.map((p) => `- ${p}`),
      '',
      timesheetUrl,
    ].join('\n'),
    html: buildEmailLayout({
      title: t(locale, 'weeklyTimesheetReminder.heading'),
      locale,
      body: `
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0F172A;">
          ${t(locale, 'weeklyTimesheetReminder.heading')}
        </h2>
        <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.6;">
          ${t(locale, 'weeklyTimesheetReminder.greeting', { name: escapeHtml(name), weekStart, weekEnd })}
        </p>
        <div style="background-color:#f5f7ff;border:1px solid #e0e3f0;border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 8px;font-size:14px;color:#334155;font-weight:600;">${t(locale, 'weeklyTimesheetReminder.projectsLabel')}</p>
          <ul style="margin:0;padding-left:20px;font-size:14px;color:#334155;line-height:1.8;">
            ${projectNames.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}
          </ul>
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:8px;">
              <a href="${timesheetUrl}" style="display:inline-block;padding:14px 32px;background-color:#3B82F6;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                ${t(locale, 'weeklyTimesheetReminder.button')}
              </a>
            </td>
          </tr>
        </table>`,
    }),
  };
}
