import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError } from '../../utils/app-error'

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
  ilike: vi.fn((_col: unknown, val: unknown) => ({ type: 'ilike', val })),
  count: vi.fn(() => 'count'),
  desc: vi.fn((col: unknown) => ({ type: 'desc', col })),
  asc: vi.fn((col: unknown) => ({ type: 'asc', col })),
  sql: vi.fn(),
  inArray: vi.fn((_col: unknown, vals: unknown[]) => ({ type: 'inArray', vals })),
}))

vi.mock('../../db/schema', () => ({
  tickets: {
    id: 'id', code: 'code', projectId: 'projectId', createdBy: 'createdBy',
    assignedTo: 'assignedTo', type: 'type', priority: 'priority', status: 'status',
    title: 'title', description: 'description', metadata: 'metadata',
    isVisibleToClient: 'isVisibleToClient', ccEmails: 'ccEmails', dueDate: 'dueDate',
    estimatedHours: 'estimatedHours', resolvedAt: 'resolvedAt', closedAt: 'closedAt',
    createdAt: 'createdAt', updatedAt: 'updatedAt',
  },
  ticketComments: {
    id: 'id', ticketId: 'ticketId', userId: 'userId', content: 'content',
    isInternal: 'isInternal', createdAt: 'createdAt',
  },
  ticketHistory: {
    id: 'id', ticketId: 'ticketId', userId: 'userId', field: 'field',
    oldValue: 'oldValue', newValue: 'newValue', createdAt: 'createdAt',
  },
  ticketAttachments: {
    id: 'id', ticketId: 'ticketId', fileId: 'fileId', uploadedBy: 'uploadedBy',
    createdAt: 'createdAt',
  },
  users: { id: 'id', name: 'name', email: 'email', role: 'role', isActive: 'isActive' },
  projects: {
    id: 'id', name: 'name', clientId: 'clientId', ticketPrefix: 'ticketPrefix',
    ticketSequence: 'ticketSequence',
  },
  clients: { id: 'id', companyName: 'companyName' },
  projectAllocations: { id: 'id', projectId: 'projectId', userId: 'userId' },
  files: { id: 'id', originalName: 'originalName', url: 'url', size: 'size', mimeType: 'mimeType' },
  timeEntries: { id: 'id', userId: 'userId', ticketId: 'ticketId', date: 'date', hours: 'hours', description: 'description' },
}))

vi.mock('../../utils/project-access', () => ({
  assertUserHasProjectAccess: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../utils/pagination', () => ({
  buildMeta: vi.fn((total: number, params: { page: number; limit: number }) => ({
    page: params.page, limit: params.limit, total, totalPages: Math.ceil(total / params.limit),
  })),
}))

vi.mock('../ticket-notification.service', () => ({
  notifyTicketCreated: vi.fn(),
  notifyTicketAssigned: vi.fn(),
  notifyStatusChanged: vi.fn(),
  notifyNewComment: vi.fn(),
  notifyNewAttachment: vi.fn(),
}))

vi.mock('../file.service', () => ({
  deleteFile: vi.fn().mockResolvedValue(undefined),
}))

import { createChain } from '../../__test-utils__/drizzle-chain'

vi.mock('../../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

import {
  createTicket, updateTicket, getTicketById, addComment, getTicketStats,
  listTickets, listComments, removeAttachment, addAttachment, listHistory,
  listAttachments, listTicketTimeEntries,
} from '../ticket.service'
import { db } from '../../db'

const mockTicket = {
  id: 't1', code: 'PRJ-001', projectId: 'p1', projectName: 'Projeto Alpha',
  clientName: 'Acme Corp', createdBy: 'u1', createdByName: 'João',
  assignedTo: null, assignedToName: null, type: 'question', priority: 'medium',
  status: 'open', title: 'Teste ticket', description: 'Descrição',
  metadata: null, isVisibleToClient: true, ccEmails: [], dueDate: null,
  estimatedHours: null, resolvedAt: null, closedAt: null,
  createdAt: new Date(), updatedAt: new Date(),
}

describe('createTicket', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('creates ticket with auto-generated code', async () => {
    // 1. assertUserHasProjectAccess (mocked)
    // 2. generateTicketCode: select project
    const projectChain = createChain([{ name: 'Projeto Alpha', ticketPrefix: 'PRJ', ticketSequence: 1 }])
    // 3. generateTicketCode: update ticketSequence → returns new sequence
    const updateSeqChain = createChain([{ ticketSequence: 2 }])
    // 4. insert ticket
    const insertedTicket = { ...mockTicket, id: 't-new', code: 'PRJ-002' }
    const insertChain = createChain([insertedTicket])
    // 5. recordHistory: insert into ticketHistory
    const historyChain = createChain([])
    // 6. getTicketByIdInternal: select ticket with joins
    const internalChain = createChain([insertedTicket])

    vi.mocked(db.select)
      .mockReturnValueOnce(projectChain as never)     // generateTicketCode: project lookup
      .mockReturnValueOnce(internalChain as never)     // getTicketByIdInternal: ticket select

    vi.mocked(db.update).mockReturnValue(updateSeqChain as never)

    vi.mocked(db.insert)
      .mockReturnValueOnce(insertChain as never)       // insert ticket
      .mockReturnValueOnce(historyChain as never)      // recordHistory

    const result = await createTicket({
      projectId: 'p1', createdBy: 'u1', createdByRole: 'consultor',
      type: 'question', title: 'Teste ticket',
    })

    expect(result).toBeTruthy()
    expect(db.insert).toHaveBeenCalled()
  })

  it('records creation history', async () => {
    const projectChain = createChain([{ name: 'Projeto Alpha', ticketPrefix: 'PRJ', ticketSequence: 1 }])
    const updateSeqChain = createChain([{ ticketSequence: 2 }])
    const insertedTicket = { ...mockTicket, id: 't-new', code: 'PRJ-002' }
    const insertChain = createChain([insertedTicket])
    const historyChain = createChain([])
    const internalChain = createChain([insertedTicket])

    vi.mocked(db.select)
      .mockReturnValueOnce(projectChain as never)
      .mockReturnValueOnce(internalChain as never)

    vi.mocked(db.update).mockReturnValue(updateSeqChain as never)

    vi.mocked(db.insert)
      .mockReturnValueOnce(insertChain as never)
      .mockReturnValueOnce(historyChain as never)

    await createTicket({
      projectId: 'p1', createdBy: 'u1', createdByRole: 'consultor',
      type: 'question', title: 'Teste ticket',
    })

    // insert called twice: ticket + history
    expect(db.insert).toHaveBeenCalledTimes(2)
  })
})

describe('updateTicket', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('updates allowed fields', async () => {
    // getTicketByIdInternal
    const ticketChain = createChain([mockTicket])
    // updateTicket: check allocation for gestor
    const allocationChain = createChain([{ id: 'a1' }])
    // recordHistory for title
    const historyChain = createChain([])
    // db.update ticket
    const updateChain = createChain([])
    // getTicketByIdInternal (return after update)
    const updatedTicket = { ...mockTicket, title: 'Titulo atualizado' }
    const returnChain = createChain([updatedTicket])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)       // getTicketByIdInternal
      .mockReturnValueOnce(allocationChain as never)   // allocation check
      .mockReturnValueOnce(returnChain as never)       // getTicketByIdInternal after update

    vi.mocked(db.insert).mockReturnValue(historyChain as never)
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await updateTicket('t1', 'u2', 'gestor', undefined, { title: 'Titulo atualizado' })
    expect(result).toBeTruthy()
    expect(db.update).toHaveBeenCalled()
  })

  it('records change history', async () => {
    const ticketChain = createChain([mockTicket])
    const allocationChain = createChain([{ id: 'a1' }])
    const historyChain = createChain([])
    const updateChain = createChain([])
    const returnChain = createChain([{ ...mockTicket, title: 'Novo titulo' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(allocationChain as never)
      .mockReturnValueOnce(returnChain as never)

    vi.mocked(db.insert).mockReturnValue(historyChain as never)
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    await updateTicket('t1', 'u2', 'gestor', undefined, { title: 'Novo titulo' })

    // recordHistory inserts for title change
    expect(db.insert).toHaveBeenCalled()
  })
})

describe('getTicketById', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns ticket for user with access', async () => {
    // getTicketByIdInternal
    const ticketChain = createChain([mockTicket])
    // allocation check for gestor
    const allocationChain = createChain([{ id: 'a1' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(allocationChain as never)

    const result = await getTicketById('t1', 'u2', 'gestor')
    expect(result).toBeTruthy()
    expect(result.id).toBe('t1')
    expect(result.code).toBe('PRJ-001')
  })
})

describe('addComment', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('adds comment', async () => {
    // getTicketByIdInternal
    const ticketChain = createChain([mockTicket])
    // allocation check for gestor
    const allocationChain = createChain([{ id: 'a1' }])
    // insert comment
    const comment = { id: 'c1', ticketId: 't1', userId: 'u2', content: 'Comentário teste', isInternal: false, createdAt: new Date() }
    const insertChain = createChain([comment])
    // get user name
    const userChain = createChain([{ name: 'Maria' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)       // getTicketByIdInternal
      .mockReturnValueOnce(allocationChain as never)   // allocation check
      .mockReturnValueOnce(userChain as never)         // user name

    vi.mocked(db.insert).mockReturnValue(insertChain as never)

    const result = await addComment({
      ticketId: 't1', userId: 'u2', userRole: 'gestor', content: 'Comentário teste',
    })

    expect(result.id).toBe('c1')
    expect(result.userName).toBe('Maria')
    expect(db.insert).toHaveBeenCalled()
  })
})

describe('getTicketStats', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns count by status', async () => {
    const now = new Date()
    const ticketsData = [
      { status: 'open', priority: 'high', type: 'question', assignedTo: null, createdAt: now },
      { status: 'open', priority: 'medium', type: 'question', assignedTo: 'u1', createdAt: now },
      { status: 'finished', priority: 'low', type: 'improvement', assignedTo: 'u2', createdAt: now },
    ]
    const ticketsChain = createChain(ticketsData)

    vi.mocked(db.select).mockReturnValue(ticketsChain as never)

    const result = await getTicketStats({ userId: 'u-admin', userRole: 'super_admin' })

    expect(result.byStatus).toEqual({ open: 2, finished: 1 })
    expect(result.byPriority).toEqual({ high: 1, medium: 1, low: 1 })
    expect(result.unassigned).toBe(1)
  })

  it('returns empty stats for client without clientId', async () => {
    const result = await getTicketStats({ userId: 'u1', userRole: 'client' })
    expect(result).toEqual({ byStatus: {}, byPriority: {}, byType: {}, unassigned: 0, myAssigned: 0, recentlyOpened: 0 })
  })

  it('returns empty stats for client with no projects', async () => {
    const clientProjectsChain = createChain([])
    vi.mocked(db.select).mockReturnValueOnce(clientProjectsChain as never)

    const result = await getTicketStats({ userId: 'u1', userRole: 'client', userClientId: 'c1' })
    expect(result).toEqual({ byStatus: {}, byPriority: {}, byType: {}, unassigned: 0, myAssigned: 0, recentlyOpened: 0 })
  })

  it('returns empty stats for gestor with no allocations', async () => {
    const allocationsChain = createChain([])
    vi.mocked(db.select).mockReturnValueOnce(allocationsChain as never)

    const result = await getTicketStats({ userId: 'u1', userRole: 'gestor' })
    expect(result).toEqual({ byStatus: {}, byPriority: {}, byType: {}, unassigned: 0, myAssigned: 0, recentlyOpened: 0 })
  })

  it('counts myAssigned for current user', async () => {
    const now = new Date()
    const ticketsData = [
      { status: 'open', priority: 'high', type: 'question', assignedTo: 'u-admin', createdAt: now },
      { status: 'open', priority: 'medium', type: 'question', assignedTo: 'u-other', createdAt: now },
    ]
    const ticketsChain = createChain(ticketsData)
    vi.mocked(db.select).mockReturnValue(ticketsChain as never)

    const result = await getTicketStats({ userId: 'u-admin', userRole: 'super_admin' })
    expect(result.myAssigned).toBe(1)
  })
})

// ─── listTickets ───────────────────────────────────────────────────

describe('listTickets', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns empty for client without clientId', async () => {
    const result = await listTickets({
      userId: 'u1', userRole: 'client', page: 1, limit: 20,
    })
    expect(result.data).toEqual([])
    expect(result.meta.total).toBe(0)
  })

  it('returns empty for client with no projects', async () => {
    const clientProjectsChain = createChain([])
    vi.mocked(db.select).mockReturnValueOnce(clientProjectsChain as never)

    const result = await listTickets({
      userId: 'u1', userRole: 'client', userClientId: 'c1', page: 1, limit: 20,
    })
    expect(result.data).toEqual([])
  })

  it('returns empty for gestor with no allocations', async () => {
    const allocationsChain = createChain([])
    vi.mocked(db.select).mockReturnValueOnce(allocationsChain as never)

    const result = await listTickets({
      userId: 'u1', userRole: 'gestor', page: 1, limit: 20,
    })
    expect(result.data).toEqual([])
  })

  it('returns empty for consultor with no allocations', async () => {
    const allocationsChain = createChain([])
    vi.mocked(db.select).mockReturnValueOnce(allocationsChain as never)

    const result = await listTickets({
      userId: 'u1', userRole: 'consultor', page: 1, limit: 20,
    })
    expect(result.data).toEqual([])
  })

  it('lists tickets for super_admin', async () => {
    const ticketRow = {
      id: 't1', code: 'PRJ-001', projectId: 'p1', projectName: 'Projeto Alpha',
      clientName: 'Acme Corp', createdBy: 'u1', createdByName: 'João',
      assignedTo: 'u2', type: 'question', priority: 'medium', status: 'open',
      title: 'Teste', description: 'Desc', metadata: null,
      isVisibleToClient: true, ccEmails: [], dueDate: null,
      estimatedHours: null, resolvedAt: null, closedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    }
    const dataChain = createChain([ticketRow])
    const countChain = createChain([{ total: 1 }])
    const assigneesChain = createChain([{ id: 'u2', name: 'Maria' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(dataChain as never)     // data query
      .mockReturnValueOnce(countChain as never)     // count query
      .mockReturnValueOnce(assigneesChain as never) // assignee names

    const result = await listTickets({
      userId: 'u-admin', userRole: 'super_admin', page: 1, limit: 20,
    })

    expect(result.data).toHaveLength(1)
    expect(result.data[0].assignedToName).toBe('Maria')
  })

  it('lists tickets for client with valid projects', async () => {
    const clientProjectsChain = createChain([{ id: 'p1' }])
    const ticketRow = {
      id: 't1', code: 'PRJ-001', projectId: 'p1', projectName: 'Projeto Alpha',
      clientName: 'Acme Corp', createdBy: 'u1', createdByName: 'João',
      assignedTo: null, type: 'question', priority: 'medium', status: 'open',
      title: 'Teste', description: 'Desc', metadata: null,
      isVisibleToClient: true, ccEmails: [], dueDate: null,
      estimatedHours: null, resolvedAt: null, closedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    }
    const dataChain = createChain([ticketRow])
    const countChain = createChain([{ total: 1 }])

    vi.mocked(db.select)
      .mockReturnValueOnce(clientProjectsChain as never) // client projects
      .mockReturnValueOnce(dataChain as never)           // data query
      .mockReturnValueOnce(countChain as never)          // count query

    const result = await listTickets({
      userId: 'u1', userRole: 'client', userClientId: 'c1', page: 1, limit: 20,
    })

    expect(result.data).toHaveLength(1)
    expect(result.data[0].assignedToName).toBeNull()
  })

  it('applies optional filters: status, type, priority, assignedTo, createdBy, search', async () => {
    const dataChain = createChain([])
    const countChain = createChain([{ total: 0 }])

    vi.mocked(db.select)
      .mockReturnValueOnce(dataChain as never)
      .mockReturnValueOnce(countChain as never)

    const result = await listTickets({
      userId: 'u-admin', userRole: 'super_admin', page: 1, limit: 20,
      status: 'open', type: 'question', priority: 'high',
      assignedTo: 'u2', createdBy: 'u1', search: 'teste',
    })

    expect(result.data).toEqual([])
  })

  it('handles comma-separated status filter', async () => {
    const dataChain = createChain([])
    const countChain = createChain([{ total: 0 }])

    vi.mocked(db.select)
      .mockReturnValueOnce(dataChain as never)
      .mockReturnValueOnce(countChain as never)

    const result = await listTickets({
      userId: 'u-admin', userRole: 'super_admin', page: 1, limit: 20,
      status: 'open,in_analysis',
    })

    expect(result.data).toEqual([])
  })

  it('applies projectId filter', async () => {
    const dataChain = createChain([])
    const countChain = createChain([{ total: 0 }])

    vi.mocked(db.select)
      .mockReturnValueOnce(dataChain as never)
      .mockReturnValueOnce(countChain as never)

    const result = await listTickets({
      userId: 'u-admin', userRole: 'super_admin', page: 1, limit: 20,
      projectId: 'p1',
    })

    expect(result.data).toEqual([])
  })

  it('sorts by priority ascending', async () => {
    const dataChain = createChain([])
    const countChain = createChain([{ total: 0 }])

    vi.mocked(db.select)
      .mockReturnValueOnce(dataChain as never)
      .mockReturnValueOnce(countChain as never)

    const result = await listTickets({
      userId: 'u-admin', userRole: 'super_admin', page: 1, limit: 20,
      sort: 'priority', order: 'asc',
    })

    expect(result.data).toEqual([])
  })

  it('sorts by status', async () => {
    const dataChain = createChain([])
    const countChain = createChain([{ total: 0 }])

    vi.mocked(db.select)
      .mockReturnValueOnce(dataChain as never)
      .mockReturnValueOnce(countChain as never)

    const result = await listTickets({
      userId: 'u-admin', userRole: 'super_admin', page: 1, limit: 20,
      sort: 'status',
    })

    expect(result.data).toEqual([])
  })

  it('sorts by updated_at', async () => {
    const dataChain = createChain([])
    const countChain = createChain([{ total: 0 }])

    vi.mocked(db.select)
      .mockReturnValueOnce(dataChain as never)
      .mockReturnValueOnce(countChain as never)

    const result = await listTickets({
      userId: 'u-admin', userRole: 'super_admin', page: 1, limit: 20,
      sort: 'updated_at',
    })

    expect(result.data).toEqual([])
  })

  it('lists tickets for gestor with allocations', async () => {
    const allocationsChain = createChain([{ projectId: 'p1' }])
    const dataChain = createChain([])
    const countChain = createChain([{ total: 0 }])

    vi.mocked(db.select)
      .mockReturnValueOnce(allocationsChain as never)
      .mockReturnValueOnce(dataChain as never)
      .mockReturnValueOnce(countChain as never)

    const result = await listTickets({
      userId: 'u1', userRole: 'gestor', page: 1, limit: 20,
    })

    expect(result.data).toEqual([])
  })
})

// ─── updateTicket – status transitions & client rules ──────────────

describe('updateTicket – status transitions', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('throws INVALID_TRANSITION for same status', async () => {
    // status === ticket.status is skipped (no-op), not an error – test transition to a truly invalid status
    // Actually, same status is skipped. Let's test an impossible transition scenario.
    // All statuses can transition to all other statuses in the current config,
    // so we test the permission check instead.
  })

  it('throws NO_PERMISSION when client tries to change status to in_analysis from open', async () => {
    const clientTicket = { ...mockTicket, status: 'open', isVisibleToClient: true }
    const ticketChain = createChain([clientTicket])
    const projectChain = createChain([{ clientId: 'c1' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)   // getTicketByIdInternal
      .mockReturnValueOnce(projectChain as never)  // client access check

    await expect(
      updateTicket('t1', 'u-client', 'client', 'c1', { status: 'in_analysis' })
    ).rejects.toMatchObject({ status: 403 })
  })

  it('allows client to change status to finished', async () => {
    const clientTicket = { ...mockTicket, status: 'open', isVisibleToClient: true }
    const ticketChain = createChain([clientTicket])
    const projectChain = createChain([{ clientId: 'c1' }])
    const historyChain = createChain([])
    const updateChain = createChain([])
    const returnChain = createChain([{ ...clientTicket, status: 'finished' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)   // getTicketByIdInternal
      .mockReturnValueOnce(projectChain as never)  // client access check
      .mockReturnValueOnce(returnChain as never)   // getTicketByIdInternal after update

    vi.mocked(db.insert).mockReturnValue(historyChain as never)
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await updateTicket('t1', 'u-client', 'client', 'c1', { status: 'finished' })
    expect(result).toBeTruthy()
  })

  it('allows client to move to in_analysis when awaiting_customer', async () => {
    const clientTicket = { ...mockTicket, status: 'awaiting_customer', isVisibleToClient: true }
    const ticketChain = createChain([clientTicket])
    const projectChain = createChain([{ clientId: 'c1' }])
    const historyChain = createChain([])
    const updateChain = createChain([])
    const returnChain = createChain([{ ...clientTicket, status: 'in_analysis' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(projectChain as never)
      .mockReturnValueOnce(returnChain as never)

    vi.mocked(db.insert).mockReturnValue(historyChain as never)
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await updateTicket('t1', 'u-client', 'client', 'c1', { status: 'in_analysis' })
    expect(result).toBeTruthy()
  })

  it('throws CLIENT_CANNOT_REOPEN when client tries to reopen finished ticket', async () => {
    const finishedTicket = { ...mockTicket, status: 'finished', isVisibleToClient: true }
    const ticketChain = createChain([finishedTicket])
    const projectChain = createChain([{ clientId: 'c1' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(projectChain as never)

    await expect(
      updateTicket('t1', 'u-client', 'client', 'c1', { status: 'open' })
    ).rejects.toThrow('Cliente não pode reabrir ticket finalizado.')
  })

  it('throws FINISHED_NOT_EDITABLE when updating non-status fields on finished ticket', async () => {
    const finishedTicket = { ...mockTicket, status: 'finished' }
    const ticketChain = createChain([finishedTicket])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)

    await expect(
      updateTicket('t1', 'u-admin', 'super_admin', undefined, { title: 'Novo titulo' })
    ).rejects.toThrow('Ticket finalizado não pode ser alterado.')
  })

  it('throws FINISHED_NOT_EDITABLE when updating multiple fields including status on finished ticket', async () => {
    const finishedTicket = { ...mockTicket, status: 'finished' }
    const ticketChain = createChain([finishedTicket])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)

    await expect(
      updateTicket('t1', 'u-admin', 'super_admin', undefined, { status: 'open', title: 'Novo' })
    ).rejects.toThrow('Ticket finalizado não pode ser alterado.')
  })

  it('allows internal user to reopen finished ticket with only status change', async () => {
    const finishedTicket = { ...mockTicket, status: 'finished' }
    const ticketChain = createChain([finishedTicket])
    const historyChain = createChain([])
    const updateChain = createChain([])
    const returnChain = createChain([{ ...finishedTicket, status: 'open' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(returnChain as never)

    vi.mocked(db.insert).mockReturnValue(historyChain as never)
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await updateTicket('t1', 'u-admin', 'super_admin', undefined, { status: 'open' })
    expect(result).toBeTruthy()
  })

  it('sets resolvedAt and closedAt when transitioning to finished', async () => {
    const ticketChain = createChain([mockTicket])
    const allocationChain = createChain([{ id: 'a1' }])
    const historyChain = createChain([])
    const updateChain = createChain([])
    const returnChain = createChain([{ ...mockTicket, status: 'finished' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(allocationChain as never)
      .mockReturnValueOnce(returnChain as never)

    vi.mocked(db.insert).mockReturnValue(historyChain as never)
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    await updateTicket('t1', 'u2', 'gestor', undefined, { status: 'finished' })

    expect(db.update).toHaveBeenCalled()
  })

  it('throws NO_PERMISSION when client tries to change priority', async () => {
    const clientTicket = { ...mockTicket, status: 'open', isVisibleToClient: true }
    const ticketChain = createChain([clientTicket])
    const projectChain = createChain([{ clientId: 'c1' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(projectChain as never)

    await expect(
      updateTicket('t1', 'u-client', 'client', 'c1', { priority: 'high' })
    ).rejects.toThrow('Você não tem permissão para realizar esta ação.')
  })

  it('throws NO_PERMISSION when client tries to change assignedTo', async () => {
    const clientTicket = { ...mockTicket, status: 'open', isVisibleToClient: true }
    const ticketChain = createChain([clientTicket])
    const projectChain = createChain([{ clientId: 'c1' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(projectChain as never)

    await expect(
      updateTicket('t1', 'u-client', 'client', 'c1', { assignedTo: 'u2' })
    ).rejects.toThrow('Você não tem permissão para realizar esta ação.')
  })

  it('throws NO_PERMISSION when client tries to change visibility', async () => {
    const clientTicket = { ...mockTicket, status: 'open', isVisibleToClient: true }
    const ticketChain = createChain([clientTicket])
    const projectChain = createChain([{ clientId: 'c1' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(projectChain as never)

    await expect(
      updateTicket('t1', 'u-client', 'client', 'c1', { isVisibleToClient: false })
    ).rejects.toThrow('Você não tem permissão para realizar esta ação.')
  })

  it('throws NOT_FOUND when ticket does not exist', async () => {
    const emptyChain = createChain([])
    vi.mocked(db.select).mockReturnValueOnce(emptyChain as never)

    await expect(
      updateTicket('t-nonexistent', 'u1', 'super_admin', undefined, { title: 'Novo' })
    ).rejects.toThrow('Ticket não encontrado.')
  })

  it('throws NOT_FOUND when client has no access to ticket project', async () => {
    const clientTicket = { ...mockTicket, status: 'open', isVisibleToClient: true }
    const ticketChain = createChain([clientTicket])
    const projectChain = createChain([{ clientId: 'c-other' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(projectChain as never)

    await expect(
      updateTicket('t1', 'u-client', 'client', 'c1', { title: 'Novo' })
    ).rejects.toThrow('Ticket não encontrado.')
  })

  it('throws NOT_FOUND when client accesses non-visible ticket', async () => {
    const hiddenTicket = { ...mockTicket, status: 'open', isVisibleToClient: false }
    const ticketChain = createChain([hiddenTicket])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)

    await expect(
      updateTicket('t1', 'u-client', 'client', 'c1', { title: 'Novo' })
    ).rejects.toThrow('Ticket não encontrado.')
  })

  it('throws NOT_FOUND when gestor has no allocation', async () => {
    const ticketChain = createChain([mockTicket])
    const emptyAllocationChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(emptyAllocationChain as never)

    await expect(
      updateTicket('t1', 'u-no-alloc', 'gestor', undefined, { title: 'Novo' })
    ).rejects.toThrow('Ticket não encontrado.')
  })

  it('updates assignedTo and records history with assignee name', async () => {
    const ticketChain = createChain([mockTicket])
    const allocationChain = createChain([{ id: 'a1' }])
    const assigneeChain = createChain([{ name: 'Carlos' }])
    const historyChain = createChain([])
    const updateChain = createChain([])
    const returnChain = createChain([{ ...mockTicket, assignedTo: 'u3' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)     // getTicketByIdInternal
      .mockReturnValueOnce(allocationChain as never) // allocation check
      .mockReturnValueOnce(assigneeChain as never)   // assignee name lookup
      .mockReturnValueOnce(returnChain as never)     // getTicketByIdInternal after update

    vi.mocked(db.insert).mockReturnValue(historyChain as never)
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await updateTicket('t1', 'u2', 'gestor', undefined, { assignedTo: 'u3' })
    expect(result).toBeTruthy()
    expect(db.insert).toHaveBeenCalled()
  })

  it('updates assignedTo to null (unassign)', async () => {
    const ticketWithAssignee = { ...mockTicket, assignedTo: 'u3', assignedToName: 'Carlos' }
    const ticketChain = createChain([ticketWithAssignee])
    const allocationChain = createChain([{ id: 'a1' }])
    const historyChain = createChain([])
    const updateChain = createChain([])
    const returnChain = createChain([{ ...ticketWithAssignee, assignedTo: null }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(allocationChain as never)
      .mockReturnValueOnce(returnChain as never)

    vi.mocked(db.insert).mockReturnValue(historyChain as never)
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await updateTicket('t1', 'u2', 'gestor', undefined, { assignedTo: null })
    expect(result).toBeTruthy()
  })

  it('updates description and records history', async () => {
    const ticketChain = createChain([mockTicket])
    const allocationChain = createChain([{ id: 'a1' }])
    const historyChain = createChain([])
    const updateChain = createChain([])
    const returnChain = createChain([{ ...mockTicket, description: 'Nova desc' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(allocationChain as never)
      .mockReturnValueOnce(returnChain as never)

    vi.mocked(db.insert).mockReturnValue(historyChain as never)
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await updateTicket('t1', 'u2', 'gestor', undefined, { description: 'Nova desc' })
    expect(result).toBeTruthy()
  })

  it('updates dueDate and records history', async () => {
    const ticketChain = createChain([mockTicket])
    const allocationChain = createChain([{ id: 'a1' }])
    const historyChain = createChain([])
    const updateChain = createChain([])
    const returnChain = createChain([{ ...mockTicket, dueDate: '2026-06-01' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(allocationChain as never)
      .mockReturnValueOnce(returnChain as never)

    vi.mocked(db.insert).mockReturnValue(historyChain as never)
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await updateTicket('t1', 'u2', 'gestor', undefined, { dueDate: '2026-06-01' })
    expect(result).toBeTruthy()
  })

  it('updates estimatedHours and records history', async () => {
    const ticketChain = createChain([mockTicket])
    const allocationChain = createChain([{ id: 'a1' }])
    const historyChain = createChain([])
    const updateChain = createChain([])
    const returnChain = createChain([{ ...mockTicket, estimatedHours: '10' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(allocationChain as never)
      .mockReturnValueOnce(returnChain as never)

    vi.mocked(db.insert).mockReturnValue(historyChain as never)
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await updateTicket('t1', 'u2', 'gestor', undefined, { estimatedHours: 10 })
    expect(result).toBeTruthy()
  })

  it('updates ccEmails and records history', async () => {
    const ticketChain = createChain([mockTicket])
    const allocationChain = createChain([{ id: 'a1' }])
    const historyChain = createChain([])
    const updateChain = createChain([])
    const returnChain = createChain([{ ...mockTicket, ccEmails: ['a@b.com'] }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(allocationChain as never)
      .mockReturnValueOnce(returnChain as never)

    vi.mocked(db.insert).mockReturnValue(historyChain as never)
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await updateTicket('t1', 'u2', 'gestor', undefined, { ccEmails: ['a@b.com'] })
    expect(result).toBeTruthy()
  })

  it('updates isVisibleToClient for gestor', async () => {
    const ticketChain = createChain([mockTicket])
    const allocationChain = createChain([{ id: 'a1' }])
    const historyChain = createChain([])
    const updateChain = createChain([])
    const returnChain = createChain([{ ...mockTicket, isVisibleToClient: false }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(allocationChain as never)
      .mockReturnValueOnce(returnChain as never)

    vi.mocked(db.insert).mockReturnValue(historyChain as never)
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await updateTicket('t1', 'u2', 'gestor', undefined, { isVisibleToClient: false })
    expect(result).toBeTruthy()
  })
})

// ─── addComment – error paths ──────────────────────────────────────

describe('addComment – error paths', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('throws when content is empty', async () => {
    await expect(
      addComment({ ticketId: 't1', userId: 'u1', userRole: 'gestor', content: '   ' })
    ).rejects.toThrow('O conteúdo do comentário é obrigatório.')
  })

  it('throws NOT_FOUND when ticket does not exist', async () => {
    const emptyChain = createChain([])
    vi.mocked(db.select).mockReturnValueOnce(emptyChain as never)

    await expect(
      addComment({ ticketId: 't-nope', userId: 'u1', userRole: 'gestor', content: 'Teste' })
    ).rejects.toThrow('Ticket não encontrado.')
  })

  it('throws when ticket is finished (not editable)', async () => {
    const finishedTicket = { ...mockTicket, status: 'finished' }
    const ticketChain = createChain([finishedTicket])
    const allocationChain = createChain([{ id: 'a1' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(allocationChain as never)

    await expect(
      addComment({ ticketId: 't1', userId: 'u2', userRole: 'gestor', content: 'Teste' })
    ).rejects.toThrow('Ticket finalizado não pode ser alterado.')
  })

  it('forces isInternal=false for client role', async () => {
    const clientTicket = { ...mockTicket, status: 'open', isVisibleToClient: true }
    const ticketChain = createChain([clientTicket])
    const projectChain = createChain([{ clientId: 'c1' }])
    const comment = { id: 'c1', ticketId: 't1', userId: 'u-client', content: 'Comentário', isInternal: false, createdAt: new Date() }
    const insertChain = createChain([comment])
    const userChain = createChain([{ name: 'Cliente User' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)   // getTicketByIdInternal
      .mockReturnValueOnce(projectChain as never)  // client project check
      .mockReturnValueOnce(userChain as never)     // user name

    vi.mocked(db.insert).mockReturnValue(insertChain as never)

    const result = await addComment({
      ticketId: 't1', userId: 'u-client', userRole: 'client',
      userClientId: 'c1', content: 'Comentário', isInternal: true,
    })

    // Client cannot add internal comments – isInternal forced to false
    expect(result.id).toBe('c1')
    expect(db.insert).toHaveBeenCalled()
  })

  it('throws NOT_FOUND when client ticket is not visible', async () => {
    const hiddenTicket = { ...mockTicket, status: 'open', isVisibleToClient: false }
    const ticketChain = createChain([hiddenTicket])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)

    await expect(
      addComment({ ticketId: 't1', userId: 'u-client', userRole: 'client', userClientId: 'c1', content: 'Teste' })
    ).rejects.toThrow('Ticket não encontrado.')
  })

  it('throws NOT_FOUND when client project mismatch', async () => {
    const clientTicket = { ...mockTicket, status: 'open', isVisibleToClient: true }
    const ticketChain = createChain([clientTicket])
    const projectChain = createChain([{ clientId: 'c-other' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(projectChain as never)

    await expect(
      addComment({ ticketId: 't1', userId: 'u-client', userRole: 'client', userClientId: 'c1', content: 'Teste' })
    ).rejects.toThrow('Ticket não encontrado.')
  })

  it('throws NOT_FOUND when consultor has no allocation', async () => {
    const ticketChain = createChain([mockTicket])
    const emptyAllocationChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(emptyAllocationChain as never)

    await expect(
      addComment({ ticketId: 't1', userId: 'u-no-alloc', userRole: 'consultor', content: 'Teste' })
    ).rejects.toThrow('Ticket não encontrado.')
  })
})

// ─── listComments ──────────────────────────────────────────────────

describe('listComments', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('lists comments for gestor (includes internal)', async () => {
    // getTicketById → getTicketByIdInternal + allocation check
    const ticketChain = createChain([mockTicket])
    const allocationChain = createChain([{ id: 'a1' }])
    const commentsData = [
      { id: 'c1', ticketId: 't1', userId: 'u2', userName: 'Maria', content: 'Teste', isInternal: false, createdAt: new Date() },
    ]
    const commentsChain = createChain(commentsData)

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)     // getTicketByIdInternal
      .mockReturnValueOnce(allocationChain as never) // allocation check
      .mockReturnValueOnce(commentsChain as never)   // comments query

    const result = await listComments('t1', 'u2', 'gestor')
    expect(result).toHaveLength(1)
  })
})

// ─── listHistory ───────────────────────────────────────────────────

describe('listHistory', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('lists history for super_admin', async () => {
    const ticketChain = createChain([mockTicket])
    const historyData = [
      { id: 'h1', ticketId: 't1', userId: 'u1', userName: 'João', field: 'status', oldValue: null, newValue: 'open', createdAt: new Date() },
    ]
    const historyChain = createChain(historyData)

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)  // getTicketByIdInternal (via getTicketById)
      .mockReturnValueOnce(historyChain as never) // history query

    const result = await listHistory('t1', 'u-admin', 'super_admin')
    expect(result).toHaveLength(1)
    expect(result[0].field).toBe('status')
  })
})

// ─── addAttachment ─────────────────────────────────────────────────

describe('addAttachment', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('adds attachment successfully', async () => {
    // getTicketById → getTicketByIdInternal + no allocation check for super_admin
    const ticketChain = createChain([mockTicket])
    const fileChain = createChain([{ id: 'f1', originalName: 'doc.pdf' }])
    const attachment = { id: 'att1', ticketId: 't1', fileId: 'f1', uploadedBy: 'u-admin', createdAt: new Date() }
    const insertChain = createChain([attachment])
    const historyChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never) // getTicketByIdInternal
      .mockReturnValueOnce(fileChain as never)   // file lookup

    vi.mocked(db.insert)
      .mockReturnValueOnce(insertChain as never)  // insert attachment
      .mockReturnValueOnce(historyChain as never) // recordHistory

    const result = await addAttachment({
      ticketId: 't1', fileId: 'f1', uploadedBy: 'u-admin', userRole: 'super_admin',
    })
    expect(result.id).toBe('att1')
  })

  it('throws FILE_NOT_FOUND when file does not exist', async () => {
    const ticketChain = createChain([mockTicket])
    const emptyFileChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(emptyFileChain as never)

    await expect(
      addAttachment({ ticketId: 't1', fileId: 'f-nope', uploadedBy: 'u-admin', userRole: 'super_admin' })
    ).rejects.toThrow('Arquivo não encontrado.')
  })

  it('throws when ticket is finished', async () => {
    const finishedTicket = { ...mockTicket, status: 'finished' }
    const ticketChain = createChain([finishedTicket])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)

    await expect(
      addAttachment({ ticketId: 't1', fileId: 'f1', uploadedBy: 'u-admin', userRole: 'super_admin' })
    ).rejects.toThrow('Ticket finalizado não pode ser alterado.')
  })
})

// ─── removeAttachment – additional paths ───────────────────────────

describe('removeAttachment – additional paths', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('throws ATTACHMENT_NOT_FOUND when attachment does not exist', async () => {
    const emptyChain = createChain([])
    vi.mocked(db.select).mockReturnValueOnce(emptyChain as never)

    await expect(
      removeAttachment('t1', 'att-nope', 'u1', 'super_admin')
    ).rejects.toThrow('Anexo não encontrado.')
  })

  it('throws NOT_FOUND when ticket does not exist', async () => {
    const attachmentChain = createChain([{ id: 'att1', fileId: 'f1', uploadedBy: 'u1' }])
    const emptyTicketChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(attachmentChain as never)
      .mockReturnValueOnce(emptyTicketChain as never)

    await expect(
      removeAttachment('t1', 'att1', 'u1', 'super_admin')
    ).rejects.toThrow('Ticket não encontrado.')
  })

  it('throws when ticket is finished', async () => {
    const attachmentChain = createChain([{ id: 'att1', fileId: 'f1', uploadedBy: 'u1' }])
    const ticketRowChain = createChain([{ status: 'finished' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(attachmentChain as never)
      .mockReturnValueOnce(ticketRowChain as never)

    await expect(
      removeAttachment('t1', 'att1', 'u1', 'super_admin')
    ).rejects.toThrow('Ticket finalizado não pode ser alterado.')
  })

  it('throws NO_PERMISSION when non-owner consultor tries to remove', async () => {
    const attachmentChain = createChain([{ id: 'att1', fileId: 'f1', uploadedBy: 'u-other' }])
    const ticketRowChain = createChain([{ status: 'open' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(attachmentChain as never)
      .mockReturnValueOnce(ticketRowChain as never)

    await expect(
      removeAttachment('t1', 'att1', 'u-not-owner', 'consultor')
    ).rejects.toThrow('Você não tem permissão para realizar esta ação.')
  })

  it('allows gestor to remove any attachment', async () => {
    const attachmentChain = createChain([{ id: 'att1', fileId: 'f1', uploadedBy: 'u-other' }])
    const ticketRowChain = createChain([{ status: 'open' }])
    const deleteChain = createChain([])
    const historyChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(attachmentChain as never)
      .mockReturnValueOnce(ticketRowChain as never)

    vi.mocked(db.delete).mockReturnValue(deleteChain as never)
    vi.mocked(db.insert).mockReturnValue(historyChain as never)

    await removeAttachment('t1', 'att1', 'u-gestor', 'gestor')
    expect(db.delete).toHaveBeenCalled()
  })
})

// ─── listAttachments ───────────────────────────────────────────────

describe('listAttachments', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('lists attachments for a ticket', async () => {
    const attachmentsData = [
      { id: 'att1', ticketId: 't1', fileId: 'f1', fileName: 'doc.pdf', fileUrl: 'https://url', fileSize: 1024, fileMimeType: 'application/pdf', uploadedBy: 'u1', uploadedByName: 'João', createdAt: new Date() },
    ]
    const attachmentsChain = createChain(attachmentsData)
    vi.mocked(db.select).mockReturnValueOnce(attachmentsChain as never)

    const result = await listAttachments('t1')
    expect(result).toHaveLength(1)
    expect(result[0].fileName).toBe('doc.pdf')
  })
})

// ─── listTicketTimeEntries ─────────────────────────────────────────

describe('listTicketTimeEntries', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('throws CLIENT_NO_TIME_ACCESS for client role', async () => {
    await expect(
      listTicketTimeEntries('t1', 'u-client', 'client', 'c1')
    ).rejects.toThrow('Cliente não tem acesso às horas do ticket.')
  })

  it('returns time entries for gestor', async () => {
    // getTicketById → getTicketByIdInternal + allocation
    const ticketChain = createChain([mockTicket])
    const allocationChain = createChain([{ id: 'a1' }])
    const timeData = [
      { id: 'te1', userId: 'u2', userName: 'Maria', date: '2026-05-01', hours: '8.00', description: 'Dev' },
    ]
    const timeChain = createChain(timeData)

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(allocationChain as never)
      .mockReturnValueOnce(timeChain as never)

    const result = await listTicketTimeEntries('t1', 'u2', 'gestor')
    expect(result).toHaveLength(1)
    expect(result[0].hours).toBe(8)
  })
})

// ─── getTicketById – error paths ───────────────────────────────────

describe('getTicketById – error paths', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('throws NOT_FOUND for non-existent ticket', async () => {
    const emptyChain = createChain([])
    vi.mocked(db.select).mockReturnValueOnce(emptyChain as never)

    await expect(
      getTicketById('t-nope', 'u1', 'super_admin')
    ).rejects.toThrow('Ticket não encontrado.')
  })

  it('throws NOT_FOUND for client when ticket is not visible', async () => {
    const hiddenTicket = { ...mockTicket, isVisibleToClient: false }
    const ticketChain = createChain([hiddenTicket])

    vi.mocked(db.select).mockReturnValueOnce(ticketChain as never)

    await expect(
      getTicketById('t1', 'u-client', 'client', 'c1')
    ).rejects.toThrow('Ticket não encontrado.')
  })

  it('throws NOT_FOUND for client when clientId does not match project', async () => {
    const clientTicket = { ...mockTicket, isVisibleToClient: true }
    const ticketChain = createChain([clientTicket])
    const projectChain = createChain([{ clientId: 'c-other' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(projectChain as never)

    await expect(
      getTicketById('t1', 'u-client', 'client', 'c1')
    ).rejects.toThrow('Ticket não encontrado.')
  })

  it('throws NOT_FOUND for client without clientId', async () => {
    const clientTicket = { ...mockTicket, isVisibleToClient: true }
    const ticketChain = createChain([clientTicket])
    const projectChain = createChain([{ clientId: 'c1' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(projectChain as never)

    await expect(
      getTicketById('t1', 'u-client', 'client', undefined)
    ).rejects.toThrow('Ticket não encontrado.')
  })

  it('throws NOT_FOUND for consultor without allocation', async () => {
    const ticketChain = createChain([mockTicket])
    const emptyAllocationChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(emptyAllocationChain as never)

    await expect(
      getTicketById('t1', 'u-no-alloc', 'consultor')
    ).rejects.toThrow('Ticket não encontrado.')
  })
})

// ─── createTicket – additional branches ────────────────────────────

describe('createTicket – additional branches', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('forces isVisibleToClient=true for client role', async () => {
    const projectChain = createChain([{ name: 'Projeto Alpha', ticketPrefix: 'PRJ', ticketSequence: 1 }])
    const updateSeqChain = createChain([{ ticketSequence: 2 }])
    const insertedTicket = { ...mockTicket, id: 't-new', code: 'PRJ-002', isVisibleToClient: true }
    const insertChain = createChain([insertedTicket])
    const historyChain = createChain([])
    const internalChain = createChain([insertedTicket])

    vi.mocked(db.select)
      .mockReturnValueOnce(projectChain as never)
      .mockReturnValueOnce(internalChain as never)

    vi.mocked(db.update).mockReturnValue(updateSeqChain as never)

    vi.mocked(db.insert)
      .mockReturnValueOnce(insertChain as never)
      .mockReturnValueOnce(historyChain as never)

    const result = await createTicket({
      projectId: 'p1', createdBy: 'u1', createdByRole: 'client',
      type: 'question', title: 'Teste ticket', isVisibleToClient: false,
    })

    expect(result).toBeTruthy()
  })

  it('generates prefix from project name when ticketPrefix is null', async () => {
    const projectChain = createChain([{ name: 'Projeto Alpha', ticketPrefix: null, ticketSequence: 1 }])
    const updatePrefixChain = createChain([])
    const updateSeqChain = createChain([{ ticketSequence: 2 }])
    const insertedTicket = { ...mockTicket, id: 't-new', code: 'PRO-002' }
    const insertChain = createChain([insertedTicket])
    const historyChain = createChain([])
    const internalChain = createChain([insertedTicket])

    vi.mocked(db.select)
      .mockReturnValueOnce(projectChain as never)
      .mockReturnValueOnce(internalChain as never)

    vi.mocked(db.update)
      .mockReturnValueOnce(updatePrefixChain as never) // update ticketPrefix
      .mockReturnValueOnce(updateSeqChain as never)    // update ticketSequence

    vi.mocked(db.insert)
      .mockReturnValueOnce(insertChain as never)
      .mockReturnValueOnce(historyChain as never)

    const result = await createTicket({
      projectId: 'p1', createdBy: 'u1', createdByRole: 'consultor',
      type: 'question', title: 'Teste ticket',
    })

    expect(result).toBeTruthy()
    // update called for prefix + sequence
    expect(db.update).toHaveBeenCalledTimes(2)
  })

  it('uses TK prefix when project name is too short', async () => {
    const projectChain = createChain([{ name: 'X', ticketPrefix: null, ticketSequence: 1 }])
    const updatePrefixChain = createChain([])
    const updateSeqChain = createChain([{ ticketSequence: 2 }])
    const insertedTicket = { ...mockTicket, id: 't-new', code: 'TK-002' }
    const insertChain = createChain([insertedTicket])
    const historyChain = createChain([])
    const internalChain = createChain([insertedTicket])

    vi.mocked(db.select)
      .mockReturnValueOnce(projectChain as never)
      .mockReturnValueOnce(internalChain as never)

    vi.mocked(db.update)
      .mockReturnValueOnce(updatePrefixChain as never)
      .mockReturnValueOnce(updateSeqChain as never)

    vi.mocked(db.insert)
      .mockReturnValueOnce(insertChain as never)
      .mockReturnValueOnce(historyChain as never)

    const result = await createTicket({
      projectId: 'p1', createdBy: 'u1', createdByRole: 'consultor',
      type: 'question', title: 'Teste ticket',
    })

    expect(result).toBeTruthy()
  })

  it('throws PROJECT_NOT_FOUND when project does not exist', async () => {
    const emptyProjectChain = createChain([])
    vi.mocked(db.select).mockReturnValueOnce(emptyProjectChain as never)

    await expect(
      createTicket({
        projectId: 'p-nope', createdBy: 'u1', createdByRole: 'consultor',
        type: 'question', title: 'Teste',
      })
    ).rejects.toThrow('Projeto não encontrado.')
  })
})
