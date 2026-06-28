import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
  inArray: vi.fn((_col: unknown, vals: unknown[]) => ({ type: 'inArray', vals })),
}))

vi.mock('../../db/schema', () => ({
  tickets: {
    id: 'id', code: 'code', title: 'title', type: 'type', status: 'status',
    projectId: 'projectId', createdBy: 'createdBy', assignedTo: 'assignedTo',
    isVisibleToClient: 'isVisibleToClient', ccEmails: 'ccEmails',
  },
  ticketComments: { id: 'id', userId: 'userId', content: 'content' },
  users: { id: 'id', name: 'name', email: 'email', role: 'role', isActive: 'isActive', locale: 'locale' },
  projects: { id: 'id', name: 'name' },
  clients: { id: 'id', companyName: 'companyName' },
  projectAllocations: { id: 'id', projectId: 'projectId', userId: 'userId' },
}))

vi.mock('../../config/env', () => ({
  env: { FRONTEND_URL: 'https://portal.cloupone.com.br' },
}))

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}))

const mockSend = vi.fn().mockResolvedValue(undefined)
vi.mock('../../providers/email', () => ({
  getEmailProvider: vi.fn(() => ({ send: mockSend })),
}))

vi.mock('../../emails/ticket-created', () => ({
  buildTicketCreatedEmail: vi.fn(() => ({ subject: 'Ticket criado', text: 'text', html: '<p>html</p>' })),
}))

vi.mock('../../emails/ticket-assigned', () => ({
  buildTicketAssignedEmail: vi.fn(() => ({ subject: 'Ticket atribuído', text: 'text', html: '<p>html</p>' })),
}))

vi.mock('../../emails/ticket-status-changed', () => ({
  buildTicketStatusChangedEmail: vi.fn(() => ({ subject: 'Status alterado', text: 'text', html: '<p>html</p>' })),
}))

vi.mock('../../emails/ticket-comment', () => ({
  buildTicketCommentEmail: vi.fn(() => ({ subject: 'Novo comentário', text: 'text', html: '<p>html</p>' })),
}))

vi.mock('../../emails/ticket-attachment', () => ({
  buildTicketAttachmentEmail: vi.fn(() => ({ subject: 'Novo anexo', text: 'text', html: '<p>html</p>' })),
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
  notifyTicketCreated, notifyStatusChanged, notifyNewComment,
  notifyTicketAssigned, notifyNewAttachment,
} from '../ticket-notification.service'
import { db } from '../../db'
import { buildTicketCreatedEmail } from '../../emails/ticket-created'
import { buildTicketCommentEmail } from '../../emails/ticket-comment'

const mockTicketData = {
  id: 't1', code: 'PRJ-001', title: 'Bug no login', type: 'system_error',
  status: 'open', isVisibleToClient: true, ccEmails: [],
  projectId: 'p1', projectName: 'Projeto Alpha',
  createdBy: 'u-creator', assignedTo: 'u-assignee',
  creatorLocale: 'pt-BR',
}

describe('notifyTicketCreated', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('sends email to managers allocated to the project', async () => {
    // getTicketData
    const ticketChain = createChain([mockTicketData])
    // getUserData (creator)
    const creatorChain = createChain([{ id: 'u-creator', name: 'João', email: 'joao@test.com', role: 'consultor' }])
    // managers query (gestors allocated to project)
    const managersChain = createChain([
      { id: 'u-gestor1', name: 'Maria', email: 'maria@test.com' },
      { id: 'u-gestor2', name: 'Ana', email: 'ana@test.com' },
    ])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)       // getTicketData
      .mockReturnValueOnce(creatorChain as never)      // getUserData (creator)
      .mockReturnValueOnce(managersChain as never)     // managers

    await notifyTicketCreated('t1')

    // Should send to both managers (neither is the creator)
    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'maria@test.com' }))
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'ana@test.com' }))
  })

  it('includes CC recipients when ticket is visible to client', async () => {
    const ticketWithCc = { ...mockTicketData, isVisibleToClient: true, ccEmails: ['external@company.com'] }
    const ticketChain = createChain([ticketWithCc])
    const creatorChain = createChain([{ id: 'u-creator', name: 'João', email: 'joao@test.com', role: 'consultor' }])
    const managersChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(creatorChain as never)
      .mockReturnValueOnce(managersChain as never)

    await notifyTicketCreated('t1')

    // No managers, but CC should be sent
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'external@company.com' }))
  })

  it('builds CC email using ticket creator locale', async () => {
    const ticketWithCc = { ...mockTicketData, isVisibleToClient: true, ccEmails: ['external@company.com'], creatorLocale: 'en-US' }
    const ticketChain = createChain([ticketWithCc])
    const creatorChain = createChain([{ id: 'u-creator', name: 'João', email: 'joao@test.com', role: 'consultor', locale: 'en-US' }])
    const managersChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(creatorChain as never)
      .mockReturnValueOnce(managersChain as never)

    await notifyTicketCreated('t1')

    // CC email should be built with creator's locale (en-US)
    const calls = vi.mocked(buildTicketCreatedEmail).mock.calls
    const ccCall = calls[calls.length - 1][0]
    expect(ccCall).toHaveProperty('locale', 'en-US')
  })

  it('does not include CC when ticket is not visible to client', async () => {
    const ticketNotVisible = { ...mockTicketData, isVisibleToClient: false, ccEmails: ['external@company.com'] }
    const ticketChain = createChain([ticketNotVisible])
    const creatorChain = createChain([{ id: 'u-creator', name: 'João', email: 'joao@test.com', role: 'consultor' }])
    const managersChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(creatorChain as never)
      .mockReturnValueOnce(managersChain as never)

    await notifyTicketCreated('t1')

    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('notifyStatusChanged', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('sends email to creator and assignee', async () => {
    // getTicketData
    const ticketChain = createChain([mockTicketData])
    // getUserData (changer)
    const changerChain = createChain([{ id: 'u-other', name: 'Carlos', email: 'carlos@test.com', role: 'gestor' }])
    // recipients query (creator + assignee)
    const recipientsChain = createChain([
      { id: 'u-creator', name: 'João', email: 'joao@test.com', role: 'consultor' },
      { id: 'u-assignee', name: 'Pedro', email: 'pedro@test.com', role: 'consultor' },
    ])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)       // getTicketData
      .mockReturnValueOnce(changerChain as never)      // getUserData (changer)
      .mockReturnValueOnce(recipientsChain as never)   // recipients

    await notifyStatusChanged('t1', 'open', 'in_analysis', 'u-other')

    // Should send to creator and assignee (changer is excluded from recipient set)
    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'joao@test.com' }))
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'pedro@test.com' }))
  })
})

describe('notifyNewComment', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('sends notifications to creator and assignee', async () => {
    const ticketChain = createChain([mockTicketData])
    const commentChain = createChain([{ id: 'c1', userId: 'u-other', content: 'Um comentário' }])
    const authorChain = createChain([{ id: 'u-other', name: 'Carlos', email: 'carlos@test.com', role: 'gestor' }])
    const recipientsChain = createChain([
      { id: 'u-creator', name: 'João', email: 'joao@test.com', role: 'consultor' },
      { id: 'u-assignee', name: 'Pedro', email: 'pedro@test.com', role: 'consultor' },
    ])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(commentChain as never)
      .mockReturnValueOnce(authorChain as never)
      .mockReturnValueOnce(recipientsChain as never)

    await notifyNewComment('t1', 'c1', false)

    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'joao@test.com' }))
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'pedro@test.com' }))
  })

  it('builds CC email using ticket creator locale', async () => {
    const ticketWithCc = { ...mockTicketData, ccEmails: ['ext@test.com'], creatorLocale: 'en-US' }
    const ticketChain = createChain([ticketWithCc])
    const commentChain = createChain([{ id: 'c1', userId: 'u-other', content: 'A comment' }])
    const authorChain = createChain([{ id: 'u-other', name: 'Carlos', email: 'carlos@test.com', role: 'gestor' }])
    const recipientsChain = createChain([
      { id: 'u-creator', name: 'João', email: 'joao@test.com', role: 'consultor', locale: 'en-US' },
    ])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(commentChain as never)
      .mockReturnValueOnce(authorChain as never)
      .mockReturnValueOnce(recipientsChain as never)

    await notifyNewComment('t1', 'c1', false)

    // CC email should be built with creator's locale (en-US)
    const calls = vi.mocked(buildTicketCommentEmail).mock.calls
    const ccCall = calls[calls.length - 1][0]
    expect(ccCall).toHaveProperty('locale', 'en-US')
  })

  it('skips CC for internal comments', async () => {
    const ticketChain = createChain([{ ...mockTicketData, ccEmails: ['ext@test.com'], createdBy: 'u-other', assignedTo: null }])
    const commentChain = createChain([{ id: 'c1', userId: 'u-other', content: 'Comentário interno' }])
    const authorChain = createChain([{ id: 'u-other', name: 'Carlos', email: 'carlos@test.com', role: 'gestor' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(commentChain as never)
      .mockReturnValueOnce(authorChain as never)

    await notifyNewComment('t1', 'c1', true)

    // author is creator so no recipients, and CC skipped for internal
    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('notifyTicketAssigned', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('sends email to assignee', async () => {
    const ticketChain = createChain([mockTicketData])
    const assigneeChain = createChain([{ id: 'u-assignee', name: 'Pedro', email: 'pedro@test.com', role: 'consultor' }])
    const assignerChain = createChain([{ id: 'u-assigner', name: 'Maria', email: 'maria@test.com', role: 'gestor' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(assigneeChain as never)
      .mockReturnValueOnce(assignerChain as never)

    await notifyTicketAssigned('t1', 'u-assigner')

    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'pedro@test.com' }))
  })

  it('skips when assignee assigned to self', async () => {
    const ticketChain = createChain([{ ...mockTicketData, assignedTo: 'u-self' }])

    vi.mocked(db.select).mockReturnValueOnce(ticketChain as never)

    await notifyTicketAssigned('t1', 'u-self')

    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('notifyNewAttachment', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('sends email to creator and assignee', async () => {
    const ticketChain = createChain([mockTicketData])
    const uploaderChain = createChain([{ id: 'u-other', name: 'Carlos', email: 'carlos@test.com', role: 'gestor' }])
    const recipientsChain = createChain([
      { id: 'u-creator', name: 'João', email: 'joao@test.com', role: 'consultor' },
      { id: 'u-assignee', name: 'Pedro', email: 'pedro@test.com', role: 'consultor' },
    ])

    vi.mocked(db.select)
      .mockReturnValueOnce(ticketChain as never)
      .mockReturnValueOnce(uploaderChain as never)
      .mockReturnValueOnce(recipientsChain as never)

    await notifyNewAttachment('t1', 'u-other', 'document.pdf')

    expect(mockSend).toHaveBeenCalledTimes(2)
  })

  it('does not notify when ticket not found', async () => {
    vi.mocked(db.select).mockReturnValueOnce(createChain([]) as never)

    await notifyNewAttachment('t-missing', 'u1', 'file.pdf')

    expect(mockSend).not.toHaveBeenCalled()
  })
})
