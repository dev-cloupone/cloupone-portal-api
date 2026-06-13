import * as XLSX from 'xlsx';
import { eq, and, sql, ilike } from 'drizzle-orm';
import { db } from '../db';
import {
  timeEntries, projects, projectAllocations, tickets,
  consultantProfiles, monthlyTimesheets, projectSubphases,
  projectPhases, subphaseConsultants, importLogs,
} from '../db/schema';
import { AppError } from '../utils/app-error';
import * as monthlyTimesheetService from './monthly-timesheet.service';

// === TYPES ===

interface RawRow {
  date: string;
  project: string;
  subphase: string;
  ticket?: string;
  startTime: string;
  endTime: string;
  description?: string;
}

interface ResolvedIds {
  projectId: string;
  subphaseId: string;
  ticketId: string | null;
}

type RowStatus = 'valid' | 'warning' | 'error';

interface ValidatedRow {
  row: number;
  data: RawRow;
  status: RowStatus;
  message: string | null;
  resolvedIds: ResolvedIds | null;
}

interface ValidateResult {
  valid: number;
  warnings: number;
  errors: number;
  rows: ValidatedRow[];
}

export interface ConfirmInput {
  consultantId: string;
  rows: Array<{
    date: string;
    startTime: string;
    endTime: string;
    projectId: string;
    subphaseId: string;
    ticketId: string | null;
    description: string | null;
  }>;
  includeDuplicates: boolean;
}

interface ConfirmResult {
  imported: number;
  skipped: number;
}

// === HELPERS ===

const HEADER_MAP: Record<string, string> = {
  data: 'date',
  projeto: 'project',
  subfase: 'subphase',
  ticket: 'ticket',
  inicio: 'startTime',
  início: 'startTime',
  fim: 'endTime',
  descricao: 'description',
  descrição: 'description',
};

const IGNORED_HEADERS = new Set(['consultor', 'horas']);
const REQUIRED_FIELDS = ['date', 'project', 'subphase', 'startTime', 'endTime'];

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function roundToFiveMinutes(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const rounded = Math.round(m / 5) * 5;
  const finalH = rounded === 60 ? h + 1 : h;
  const finalM = rounded === 60 ? 0 : rounded;
  return `${String(finalH).padStart(2, '0')}:${String(finalM).padStart(2, '0')}`;
}

function calculateHours(startTime: string, endTime: string): string {
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  return ((endMin - startMin) / 60).toFixed(2);
}

function parseDateDDMMYYYY(dateStr: string): { valid: boolean; isoDate: string; year: number; month: number } {
  const trimmed = dateStr.trim();
  const match = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (!match) return { valid: false, isoDate: '', year: 0, month: 0 };

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { valid: false, isoDate: '', year: 0, month: 0 };
  }

  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return { valid: false, isoDate: '', year: 0, month: 0 };
  }

  const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { valid: true, isoDate, year, month };
}

function excelSerialToDateStr(serial: number): string {
  // Excel serial date: days since 1900-01-01 (with the Lotus 1-2-3 leap year bug)
  const utcDays = serial - 25569; // 25569 = days between 1900-01-01 and 1970-01-01 (Unix epoch)
  const date = new Date(utcDays * 86400000);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

// === PARSE ===

export function parseFile(buffer: Buffer, filename: string): RawRow[] {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext || !['xlsx', 'csv'].includes(ext)) {
    throw new AppError('Formato inválido. Use .xlsx ou .csv.', 400);
  }

  let workbook: XLSX.WorkBook;
  if (ext === 'csv') {
    // Detect separator from first line
    const text = buffer.toString('utf-8');
    const firstLine = text.split('\n')[0] || '';
    const separator = firstLine.includes(';') ? ';' : ',';
    workbook = XLSX.read(buffer, { type: 'buffer', FS: separator, raw: true });
  } else {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new AppError('Arquivo vazio ou inválido.', 400);

  const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true });
  if (rawData.length === 0) throw new AppError('Arquivo não contém dados.', 400);
  if (rawData.length > 500) throw new AppError('Máximo de 500 linhas por importação.', 400);

  // Map headers
  const firstRow = rawData[0];
  const headerMapping: Record<string, string> = {};
  for (const key of Object.keys(firstRow)) {
    const normalized = normalizeHeader(key);
    if (IGNORED_HEADERS.has(normalized)) continue;
    const mapped = HEADER_MAP[normalized];
    if (mapped) headerMapping[key] = mapped;
  }

  // Validate required headers
  const mappedFields = new Set(Object.values(headerMapping));
  const missing = REQUIRED_FIELDS.filter(f => !mappedFields.has(f));
  if (missing.length > 0) {
    throw new AppError(`Colunas obrigatórias não encontradas: ${missing.join(', ')}. Esperado: Data, Projeto, Subfase, Início, Fim.`, 400);
  }

  return rawData.map(row => {
    const mapped: Record<string, string> = {};
    for (const [originalKey, internalKey] of Object.entries(headerMapping)) {
      const val = row[originalKey];
      // Excel stores dates as serial numbers — convert to DD/MM/YYYY
      if (internalKey === 'date' && typeof val === 'number' && val > 0) {
        mapped[internalKey] = excelSerialToDateStr(val);
      } else {
        mapped[internalKey] = String(val ?? '').trim();
      }
    }
    return {
      date: mapped.date || '',
      project: mapped.project || '',
      subphase: mapped.subphase || '',
      ticket: mapped.ticket || undefined,
      startTime: mapped.startTime || '',
      endTime: mapped.endTime || '',
      description: mapped.description || undefined,
    };
  });
}

// === NAME RESOLUTION ===

async function resolveProject(
  projectName: string,
  consultantId: string,
  actorId: string,
  actorRole: string,
): Promise<{ id: string } | null> {
  const results = await db.select({ id: projects.id })
    .from(projects)
    .innerJoin(projectAllocations, and(
      eq(projectAllocations.projectId, projects.id),
      eq(projectAllocations.userId, consultantId),
    ))
    .where(ilike(projects.name, projectName))
    .limit(2);

  if (results.length === 0) return null;
  if (results.length > 1) return null; // ambiguity

  // If gestor, validate gestor is also allocated
  if (actorRole === 'gestor') {
    const [gestorAlloc] = await db.select({ id: projectAllocations.id })
      .from(projectAllocations)
      .where(and(
        eq(projectAllocations.projectId, results[0].id),
        eq(projectAllocations.userId, actorId),
      ))
      .limit(1);
    if (!gestorAlloc) return null;
  }

  return { id: results[0].id };
}

async function resolveSubphase(
  subphaseName: string,
  projectId: string,
  consultantId: string,
  actorRole: string,
): Promise<{ id: string } | null> {
  const results = await db.select({ id: projectSubphases.id, status: projectSubphases.status })
    .from(projectSubphases)
    .innerJoin(projectPhases, eq(projectSubphases.phaseId, projectPhases.id))
    .where(and(
      eq(projectPhases.projectId, projectId),
      ilike(projectSubphases.name, subphaseName),
    ))
    .limit(2);

  if (results.length === 0) return null;
  if (results.length > 1) return null;

  const subphase = results[0];
  if (subphase.status !== 'in_progress') return null;

  // If consultor, validate linkage
  if (actorRole === 'consultor') {
    const [link] = await db.select({ id: subphaseConsultants.id })
      .from(subphaseConsultants)
      .where(and(
        eq(subphaseConsultants.subphaseId, subphase.id),
        eq(subphaseConsultants.userId, consultantId),
      ))
      .limit(1);
    if (!link) return null;
  }

  return { id: subphase.id };
}

async function resolveTicket(
  ticketCode: string,
  projectId: string,
): Promise<{ id: string } | null> {
  const [result] = await db.select({ id: tickets.id })
    .from(tickets)
    .where(and(
      ilike(tickets.code, ticketCode),
      eq(tickets.projectId, projectId),
    ))
    .limit(1);

  return result ? { id: result.id } : null;
}

// === VALIDATION ===

export async function validateImport(
  rows: RawRow[],
  consultantId: string,
  actorId: string,
  actorRole: string,
): Promise<ValidateResult> {
  const validatedRows: ValidatedRow[] = [];
  let valid = 0;
  let warnings = 0;
  let errors = 0;

  // Pre-fetch consultant profile for overlap setting
  const [profile] = await db.select({ allowOverlappingEntries: consultantProfiles.allowOverlappingEntries })
    .from(consultantProfiles)
    .where(eq(consultantProfiles.userId, consultantId))
    .limit(1);
  const allowOverlap = profile?.allowOverlappingEntries ?? false;

  // Track validated entries for intra-file overlap detection
  const validEntries: Array<{ date: string; startMin: number; endMin: number }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;

    // 1. Validate date
    const dateResult = parseDateDDMMYYYY(row.date);
    if (!dateResult.valid) {
      errors++;
      validatedRows.push({ row: rowNum, data: row, status: 'error', message: `Data inválida: "${row.date}". Use DD/MM/AAAA.`, resolvedIds: null });
      continue;
    }

    // 2. Validate month is open
    const isOpen = await monthlyTimesheetService.isMonthOpen(consultantId, dateResult.year, dateResult.month);
    if (!isOpen) {
      errors++;
      validatedRows.push({ row: rowNum, data: row, status: 'error', message: 'Mês aprovado. Não é possível inserir apontamentos.', resolvedIds: null });
      continue;
    }

    // 3. Validate times
    if (!TIME_REGEX.test(row.startTime) || !TIME_REGEX.test(row.endTime)) {
      errors++;
      validatedRows.push({ row: rowNum, data: row, status: 'error', message: 'Horário inválido. Use formato HH:MM.', resolvedIds: null });
      continue;
    }

    // 4. Round times
    const startTime = roundToFiveMinutes(row.startTime);
    const endTime = roundToFiveMinutes(row.endTime);
    const startMin = timeToMinutes(startTime);
    const endMin = timeToMinutes(endTime);

    if (startMin >= endMin) {
      errors++;
      validatedRows.push({ row: rowNum, data: row, status: 'error', message: 'Horário de início deve ser anterior ao horário de fim.', resolvedIds: null });
      continue;
    }
    if (endMin - startMin < 15) {
      errors++;
      validatedRows.push({ row: rowNum, data: row, status: 'error', message: 'Duração mínima de 15 minutos.', resolvedIds: null });
      continue;
    }

    // 5. Resolve project
    const project = await resolveProject(row.project, consultantId, actorId, actorRole);
    if (!project) {
      errors++;
      validatedRows.push({ row: rowNum, data: row, status: 'error', message: `Projeto não encontrado ou não alocado: "${row.project}".`, resolvedIds: null });
      continue;
    }

    // 6. Resolve subphase
    const subphase = await resolveSubphase(row.subphase, project.id, consultantId, actorRole);
    if (!subphase) {
      errors++;
      validatedRows.push({ row: rowNum, data: row, status: 'error', message: `Subfase não encontrada ou não está em andamento: "${row.subphase}".`, resolvedIds: null });
      continue;
    }

    // 7. Resolve ticket (if provided)
    let ticketId: string | null = null;
    if (row.ticket) {
      const ticket = await resolveTicket(row.ticket, project.id);
      if (!ticket) {
        errors++;
        validatedRows.push({ row: rowNum, data: row, status: 'error', message: `Ticket não encontrado: "${row.ticket}".`, resolvedIds: null });
        continue;
      }
      ticketId = ticket.id;
    }

    // 8. Validate overlap with DB
    if (!allowOverlap) {
      const overlapping = await db.select({ id: timeEntries.id, startTime: timeEntries.startTime, endTime: timeEntries.endTime })
        .from(timeEntries)
        .where(and(
          eq(timeEntries.userId, consultantId),
          eq(timeEntries.date, dateResult.isoDate),
          sql`${timeEntries.startTime} < ${endTime}::time`,
          sql`${timeEntries.endTime} > ${startTime}::time`,
        ))
        .limit(1);

      if (overlapping.length > 0) {
        const entry = overlapping[0];
        errors++;
        validatedRows.push({ row: rowNum, data: row, status: 'error', message: `Sobreposição com registro das ${entry.startTime} às ${entry.endTime}.`, resolvedIds: null });
        continue;
      }
    }

    // 9. Validate intra-file overlap
    if (!allowOverlap) {
      const intraOverlap = validEntries.some(e =>
        e.date === dateResult.isoDate && e.startMin < endMin && e.endMin > startMin
      );
      if (intraOverlap) {
        errors++;
        validatedRows.push({ row: rowNum, data: row, status: 'error', message: 'Sobreposição com outra linha do arquivo.', resolvedIds: null });
        continue;
      }
    }

    // 10. Detect duplicate in DB
    const [duplicate] = await db.select({ id: timeEntries.id })
      .from(timeEntries)
      .where(and(
        eq(timeEntries.userId, consultantId),
        eq(timeEntries.date, dateResult.isoDate),
        sql`${timeEntries.startTime} = ${startTime}::time`,
        sql`${timeEntries.endTime} = ${endTime}::time`,
      ))
      .limit(1);

    if (duplicate) {
      warnings++;
      validEntries.push({ date: dateResult.isoDate, startMin, endMin });
      validatedRows.push({
        row: rowNum,
        data: row,
        status: 'warning',
        message: 'Apontamento duplicado já existe no sistema.',
        resolvedIds: { projectId: project.id, subphaseId: subphase.id, ticketId },
      });
      continue;
    }

    // All good
    valid++;
    validEntries.push({ date: dateResult.isoDate, startMin, endMin });
    validatedRows.push({
      row: rowNum,
      data: row,
      status: 'valid',
      message: null,
      resolvedIds: { projectId: project.id, subphaseId: subphase.id, ticketId },
    });
  }

  return { valid, warnings, errors, rows: validatedRows };
}

// === CONFIRMATION ===

export async function confirmImport(
  input: ConfirmInput,
  actorId: string,
  actorRole: string,
  filename: string,
): Promise<ConfirmResult> {
  const { consultantId, rows: inputRows, includeDuplicates } = input;

  // Filter duplicates if not included
  let rowsToProcess = inputRows;
  if (!includeDuplicates) {
    const filtered: typeof inputRows = [];
    for (const row of inputRows) {
      const [dup] = await db.select({ id: timeEntries.id })
        .from(timeEntries)
        .where(and(
          eq(timeEntries.userId, consultantId),
          eq(timeEntries.date, row.date),
          sql`${timeEntries.startTime} = ${row.startTime}::time`,
          sql`${timeEntries.endTime} = ${row.endTime}::time`,
        ))
        .limit(1);
      if (!dup) filtered.push(row);
    }
    rowsToProcess = filtered;
  }

  const skipped = inputRows.length - rowsToProcess.length;

  if (rowsToProcess.length === 0) {
    // Log the import even with 0 imported
    await db.insert(importLogs).values({
      userId: actorId,
      consultantId,
      filename,
      totalRows: inputRows.length,
      imported: 0,
      skipped,
    });
    return { imported: 0, skipped };
  }

  // Pre-fetch overlap setting
  const [profile] = await db.select({ allowOverlappingEntries: consultantProfiles.allowOverlappingEntries })
    .from(consultantProfiles)
    .where(eq(consultantProfiles.userId, consultantId))
    .limit(1);
  const allowOverlap = profile?.allowOverlappingEntries ?? false;

  let imported = 0;

  await db.transaction(async (tx) => {
    // Track inserted entries for intra-transaction overlap
    const insertedEntries: Array<{ date: string; startMin: number; endMin: number }> = [];

    for (const row of rowsToProcess) {
      const startTime = roundToFiveMinutes(row.startTime);
      const endTime = roundToFiveMinutes(row.endTime);
      const hours = calculateHours(startTime, endTime);

      // Extract year/month
      const d = new Date(row.date + 'T12:00:00');
      const year = d.getFullYear();
      const month = d.getMonth() + 1;

      // Revalidate: month open
      const isOpen = await monthlyTimesheetService.isMonthOpen(consultantId, year, month);
      if (!isOpen) throw new AppError(`Mês ${month}/${year} está aprovado. Importação cancelada.`, 400);

      // Revalidate: allocation
      const [allocation] = await tx.select({ id: projectAllocations.id })
        .from(projectAllocations)
        .where(and(
          eq(projectAllocations.projectId, row.projectId),
          eq(projectAllocations.userId, consultantId),
        ))
        .limit(1);
      if (!allocation) throw new AppError(`Consultor não está alocado no projeto. Importação cancelada.`, 400);

      // Revalidate: subphase in progress + consultant link
      const [subphase] = await tx.select({ id: projectSubphases.id, status: projectSubphases.status })
        .from(projectSubphases)
        .where(eq(projectSubphases.id, row.subphaseId))
        .limit(1);
      if (!subphase) throw new AppError('Subfase não encontrada. Importação cancelada.', 400);
      if (subphase.status !== 'in_progress') throw new AppError('Subfase não está em andamento. Importação cancelada.', 400);

      if (actorRole === 'consultor') {
        const [link] = await tx.select({ id: subphaseConsultants.id })
          .from(subphaseConsultants)
          .where(and(
            eq(subphaseConsultants.subphaseId, row.subphaseId),
            eq(subphaseConsultants.userId, consultantId),
          ))
          .limit(1);
        if (!link) throw new AppError('Consultor não está vinculado à subfase. Importação cancelada.', 400);
      }

      // Revalidate: ticket
      if (row.ticketId) {
        const [ticket] = await tx.select({ projectId: tickets.projectId })
          .from(tickets)
          .where(eq(tickets.id, row.ticketId))
          .limit(1);
        if (!ticket) throw new AppError('Ticket não encontrado. Importação cancelada.', 404);
        if (ticket.projectId !== row.projectId) throw new AppError('Ticket não pertence ao projeto. Importação cancelada.', 400);
      }

      // Revalidate: overlap with DB + already-inserted
      if (!allowOverlap) {
        const startMin = timeToMinutes(startTime);
        const endMin = timeToMinutes(endTime);

        const overlapping = await tx.select({ id: timeEntries.id })
          .from(timeEntries)
          .where(and(
            eq(timeEntries.userId, consultantId),
            eq(timeEntries.date, row.date),
            sql`${timeEntries.startTime} < ${endTime}::time`,
            sql`${timeEntries.endTime} > ${startTime}::time`,
          ))
          .limit(1);
        if (overlapping.length > 0) throw new AppError('Sobreposição detectada. Importação cancelada.', 409);

        const intraOverlap = insertedEntries.some(e =>
          e.date === row.date && e.startMin < endMin && e.endMin > startMin
        );
        if (intraOverlap) throw new AppError('Sobreposição intra-arquivo detectada. Importação cancelada.', 409);

        insertedEntries.push({ date: row.date, startMin, endMin });
      }

      // Ensure monthly timesheet exists
      await monthlyTimesheetService.getOrCreate(consultantId, year, month);

      // Insert
      await tx.insert(timeEntries).values({
        userId: consultantId,
        projectId: row.projectId,
        date: row.date,
        startTime,
        endTime,
        hours,
        description: row.description ?? null,
        ticketId: row.ticketId ?? null,
        subphaseId: row.subphaseId,
      });

      imported++;
    }
  });

  // Log import after successful transaction
  await db.insert(importLogs).values({
    userId: actorId,
    consultantId,
    filename,
    totalRows: inputRows.length,
    imported,
    skipped,
  });

  return { imported, skipped };
}
