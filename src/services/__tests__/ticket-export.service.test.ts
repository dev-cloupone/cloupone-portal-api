import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import {
  formatTicketDateTime, formatDueDate, buildExportFilenameTimestamp,
  buildExportFilename, buildTicketExportWorkbook,
} from '../ticket-export.service'
import type { TicketExportRow } from '../ticket.service'

// 2026-01-16T02:05:00Z === 2026-01-15 23:05 em America/Sao_Paulo (UTC-3)
const dateWithPadding = new Date('2026-01-16T02:05:00Z')
// 2026-03-05T14:30:00Z === 2026-03-05 11:30 em America/Sao_Paulo (UTC-3)
const fixedDate = new Date('2026-03-05T14:30:00Z')

describe('formatTicketDateTime', () => {
  it('formats pt-BR as dd/MM/yyyy HH:mm', () => {
    expect(formatTicketDateTime(fixedDate, 'pt-BR')).toBe('05/03/2026 11:30')
  })

  it('formats en-US as MM/dd/yyyy HH:mm', () => {
    expect(formatTicketDateTime(fixedDate, 'en-US')).toBe('03/05/2026 11:30')
  })

  it('pads hour/minute correctly across the day boundary', () => {
    expect(formatTicketDateTime(dateWithPadding, 'pt-BR')).toBe('15/01/2026 23:05')
    expect(formatTicketDateTime(dateWithPadding, 'en-US')).toBe('01/15/2026 23:05')
  })
})

describe('formatDueDate', () => {
  it('formats pt-BR as dd/MM/yyyy', () => {
    expect(formatDueDate('2026-02-01', 'pt-BR')).toBe('01/02/2026')
  })

  it('formats en-US as MM/dd/yyyy', () => {
    expect(formatDueDate('2026-02-01', 'en-US')).toBe('02/01/2026')
  })
})

describe('buildExportFilenameTimestamp', () => {
  it('converts to America/Sao_Paulo before formatting', () => {
    expect(buildExportFilenameTimestamp(fixedDate)).toBe('2026-03-05-1130')
  })
})

describe('buildExportFilename', () => {
  it('includes a slugified project name when provided', () => {
    expect(buildExportFilename('Projeto Água Limpa', fixedDate)).toBe('tickets-projeto-agua-limpa-2026-03-05-1130.xlsx')
  })

  it('omits the project segment when no projectName is provided', () => {
    expect(buildExportFilename(undefined, fixedDate)).toBe('tickets-2026-03-05-1130.xlsx')
  })
})

describe('buildTicketExportWorkbook', () => {
  const baseRow: TicketExportRow = {
    code: 'PRJ-001',
    title: 'Erro ao salvar',
    status: 'open',
    priority: 'high',
    type: 'system_error',
    projectName: 'Projeto Alpha',
    clientName: 'Acme Corp',
    assignedToName: 'Maria',
    createdByName: 'João',
    createdAt: fixedDate,
    dueDate: '2026-04-01',
    lastComment: { authorName: 'Cliente X', content: 'Ainda não resolvido' },
  }

  function readBack(buffer: Buffer): unknown[][] {
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    return XLSX.utils.sheet_to_json(sheet, { header: 1 })
  }

  it('writes the header row followed by one row per ticket', () => {
    const buffer = buildTicketExportWorkbook([baseRow], 'pt-BR')
    const rows = readBack(buffer)

    expect(rows[0]).toEqual([
      'Código', 'Título', 'Status', 'Prioridade', 'Tipo', 'Projeto', 'Cliente',
      'Atribuído a', 'Criado por', 'Criado em', 'Prazo', 'Último comentário',
    ])
    expect(rows).toHaveLength(2)
  })

  it('leaves the last-comment column empty when lastComment is null', () => {
    const buffer = buildTicketExportWorkbook([{ ...baseRow, lastComment: null }], 'pt-BR')
    const rows = readBack(buffer)

    expect(rows[1][11]).toBe('')
  })

  it('translates status/priority/type according to the given locale', () => {
    const ptBuffer = buildTicketExportWorkbook([baseRow], 'pt-BR')
    const ptRows = readBack(ptBuffer)
    expect(ptRows[1]).toEqual([
      'PRJ-001', 'Erro ao salvar', 'Aberto', 'Alta', 'Erro de sistema', 'Projeto Alpha', 'Acme Corp',
      'Maria', 'João', '05/03/2026 11:30', '01/04/2026', 'Cliente X: Ainda não resolvido',
    ])

    const enBuffer = buildTicketExportWorkbook([baseRow], 'en-US')
    const enRows = readBack(enBuffer)
    expect(enRows[1]).toEqual([
      'PRJ-001', 'Erro ao salvar', 'Open', 'High', 'System Error', 'Projeto Alpha', 'Acme Corp',
      'Maria', 'João', '03/05/2026 11:30', '04/01/2026', 'Cliente X: Ainda não resolvido',
    ])
  })

  it('falls back to pt-BR when userLocale is null/undefined', () => {
    const buffer = buildTicketExportWorkbook([baseRow], null)
    const rows = readBack(buffer)
    expect(rows[1][2]).toBe('Aberto')
  })
})
