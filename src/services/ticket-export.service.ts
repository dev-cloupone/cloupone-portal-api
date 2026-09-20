import * as XLSX from 'xlsx';
import { getStatusLabel, getTypeLabel, getPriorityLabel, toLocale, type Locale } from '../emails/translations';
import { BRAZIL_TZ } from '../utils/brazil-date';
import type { TicketExportRow } from './ticket.service';

const HEADERS = [
  'Código', 'Título', 'Status', 'Prioridade', 'Tipo', 'Projeto', 'Cliente',
  'Atribuído a', 'Criado por', 'Criado em', 'Prazo', 'Último comentário',
];

function dateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BRAZIL_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

export function formatTicketDateTime(date: Date, locale: Locale): string {
  const { year, month, day, hour, minute } = dateParts(date);
  return locale === 'en-US' ? `${month}/${day}/${year} ${hour}:${minute}` : `${day}/${month}/${year} ${hour}:${minute}`;
}

export function formatDueDate(dueDate: string, locale: Locale): string {
  const [year, month, day] = dueDate.split('-');
  return locale === 'en-US' ? `${month}/${day}/${year}` : `${day}/${month}/${year}`;
}

export function buildExportFilenameTimestamp(date: Date): string {
  const { year, month, day, hour, minute } = dateParts(date);
  return `${year}-${month}-${day}-${hour}${minute}`;
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

export function buildExportFilename(projectName: string | undefined, now: Date = new Date()): string {
  const timestamp = buildExportFilenameTimestamp(now);
  return projectName ? `tickets-${slugify(projectName)}-${timestamp}.xlsx` : `tickets-${timestamp}.xlsx`;
}

export function buildTicketExportWorkbook(rows: TicketExportRow[], userLocale: string | null | undefined): Buffer {
  const locale = toLocale(userLocale);
  const aoa = [
    HEADERS,
    ...rows.map((r) => [
      r.code,
      r.title,
      getStatusLabel(locale, r.status),
      getPriorityLabel(locale, r.priority),
      getTypeLabel(locale, r.type),
      r.projectName,
      r.clientName,
      r.assignedToName ?? '',
      r.createdByName,
      formatTicketDateTime(r.createdAt, locale),
      r.dueDate ? formatDueDate(r.dueDate, locale) : '',
      r.lastComment ? `${r.lastComment.authorName}: ${r.lastComment.content}` : '',
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Tickets');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
