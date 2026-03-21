import { eq, and, ilike, or, count as drizzleCount, desc, asc, sql, inArray } from 'drizzle-orm';
import { db } from '../db';
import { tickets, ticketComments, ticketHistory, ticketAttachments, users, projects, clients, projectAllocations, files, timeEntries } from '../db/schema';
import { AppError } from '../utils/app-error';
import type { PaginationParams } from '../types/pagination.types';
import { buildMeta } from '../utils/pagination';
import { notifyTicketCreated, notifyTicketAssigned, notifyStatusChanged, notifyNewComment } from './ticket-notification.service';

const MSG = {
  NOT_FOUND: 'Ticket não encontrado.',
  PROJECT_NOT_FOUND: 'Projeto não encontrado.',
  NO_ACCESS: 'Você não tem acesso a este projeto.',
  INVALID_TRANSITION: 'Transição de status inválida.',
  NO_PERMISSION: 'Você não tem permissão para realizar esta ação.',
  COMMENT_EMPTY: 'O conteúdo do comentário é obrigatório.',
  FILE_NOT_FOUND: 'Arquivo não encontrado.',
  ATTACHMENT_NOT_FOUND: 'Anexo não encontrado.',
} as const;

const STATUS_TRANSITIONS: Record<string, string[]> = {
  open: ['in_analysis', 'in_progress', 'cancelled'],
  in_analysis: ['in_progress', 'cancelled'],
  in_progress: ['in_review', 'resolved', 'cancelled'],
  in_review: ['in_progress', 'resolved', 'cancelled'],
  resolved: ['closed', 'reopened'],
  closed: ['reopened'],
  reopened: ['in_analysis', 'in_progress', 'cancelled'],
};

const STATUS_ROLE_PERMISSIONS: Record<string, string[]> = {
  in_analysis: ['consultor', 'gestor', 'super_admin'],
  in_progress: ['consultor', 'gestor', 'super_admin'],
  in_review: ['consultor', 'gestor', 'super_admin'],
  resolved: ['consultor', 'gestor', 'super_admin'],
  closed: ['user', 'gestor', 'super_admin'],
  reopened: ['user', 'gestor', 'super_admin'],
  cancelled: ['gestor', 'super_admin'],
};

// --- Helpers ---

async function validateProjectAccess(projectId: string, userId: string, userRole: string, userClientId?: string): Promise<void> {
  if (userRole === 'super_admin' || userRole === 'gestor') return;

  if (userRole === 'consultor') {
    const [allocation] = await db
      .select({ id: projectAllocations.id })
      .from(projectAllocations)
      .where(and(eq(projectAllocations.projectId, projectId), eq(projectAllocations.userId, userId)))
      .limit(1);
    if (!allocation) throw new AppError(MSG.NO_ACCESS, 403);
    return;
  }

  // role 'user'
  if (!userClientId) throw new AppError(MSG.NO_ACCESS, 403);
  const [project] = await db
    .select({ clientId: projects.clientId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.clientId !== userClientId) throw new AppError(MSG.NO_ACCESS, 403);
}

async function generateTicketCode(projectId: string): Promise<string> {
  const [project] = await db
    .select({ name: projects.name, ticketPrefix: projects.ticketPrefix, ticketSequence: projects.ticketSequence })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) throw new AppError(MSG.PROJECT_NOT_FOUND, 404);

  let prefix = project.ticketPrefix;
  if (!prefix) {
    prefix = project.name.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
    if (prefix.length < 2) prefix = 'TK';
    await db.update(projects).set({ ticketPrefix: prefix }).where(eq(projects.id, projectId));
  }

  const [updated] = await db
    .update(projects)
    .set({ ticketSequence: sql`${projects.ticketSequence} + 1` })
    .where(eq(projects.id, projectId))
    .returning({ ticketSequence: projects.ticketSequence });

  return `${prefix}-${String(updated.ticketSequence).padStart(3, '0')}`;
}

async function recordHistory(ticketId: string, userId: string, field: string, oldValue: string | null, newValue: string) {
  await db.insert(ticketHistory).values({ ticketId, userId, field, oldValue, newValue });
}

function buildTicketSelect() {
  return {
    id: tickets.id,
    code: tickets.code,
    projectId: tickets.projectId,
    projectName: projects.name,
    clientName: clients.companyName,
    createdBy: tickets.createdBy,
    createdByName: sql<string>`creator.name`.as('created_by_name'),
    assignedTo: tickets.assignedTo,
    assignedToName: sql<string>`assignee.name`.as('assigned_to_name'),
    type: tickets.type,
    priority: tickets.priority,
    status: tickets.status,
    title: tickets.title,
    description: tickets.description,
    metadata: tickets.metadata,
    isVisibleToClient: tickets.isVisibleToClient,
    dueDate: tickets.dueDate,
    estimatedHours: tickets.estimatedHours,
    resolvedAt: tickets.resolvedAt,
    closedAt: tickets.closedAt,
    createdAt: tickets.createdAt,
    updatedAt: tickets.updatedAt,
  };
}

function buildTicketQuery() {
  return db
    .select(buildTicketSelect())
    .from(tickets)
    .innerJoin(projects, eq(tickets.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .innerJoin(sql`${users} as creator`, sql`creator.id = ${tickets.createdBy}`)
    .leftJoin(sql`${users} as assignee`, sql`assignee.id = ${tickets.assignedTo}`);
}

// --- CRUD ---

export async function createTicket(data: {
  projectId: string;
  createdBy: string;
  createdByRole: string;
  createdByClientId?: string;
  type: string;
  priority?: string;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
  isVisibleToClient?: boolean;
  assignedTo?: string | null;
  dueDate?: string | null;
  estimatedHours?: number | null;
}) {
  await validateProjectAccess(data.projectId, data.createdBy, data.createdByRole, data.createdByClientId);

  const isVisibleToClient = data.createdByRole === 'user' ? true : (data.isVisibleToClient ?? true);
  const code = await generateTicketCode(data.projectId);

  const [ticket] = await db.insert(tickets).values({
    code,
    projectId: data.projectId,
    createdBy: data.createdBy,
    assignedTo: data.assignedTo ?? null,
    type: data.type as 'bug' | 'improvement' | 'initiative',
    priority: (data.priority as 'low' | 'medium' | 'high' | 'critical') ?? 'medium',
    status: 'open',
    title: data.title,
    description: data.description,
    metadata: data.metadata,
    isVisibleToClient,
    dueDate: data.dueDate,
    estimatedHours: data.estimatedHours != null ? String(data.estimatedHours) : null,
  }).returning();

  await recordHistory(ticket.id, data.createdBy, 'status', null, 'open');

  // Fire-and-forget notifications
  notifyTicketCreated(ticket.id);

  // Return with joins
  const result = await getTicketByIdInternal(ticket.id);
  return result;
}

async function getTicketByIdInternal(ticketId: string) {
  const [ticket] = await db
    .select({
      id: tickets.id,
      code: tickets.code,
      projectId: tickets.projectId,
      projectName: projects.name,
      clientName: clients.companyName,
      createdBy: tickets.createdBy,
      createdByName: users.name,
      assignedTo: tickets.assignedTo,
      type: tickets.type,
      priority: tickets.priority,
      status: tickets.status,
      title: tickets.title,
      description: tickets.description,
      metadata: tickets.metadata,
      isVisibleToClient: tickets.isVisibleToClient,
      dueDate: tickets.dueDate,
      estimatedHours: tickets.estimatedHours,
      resolvedAt: tickets.resolvedAt,
      closedAt: tickets.closedAt,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
    })
    .from(tickets)
    .innerJoin(projects, eq(tickets.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .innerJoin(users, eq(tickets.createdBy, users.id))
    .where(eq(tickets.id, ticketId))
    .limit(1);

  if (!ticket) return null;

  // Get assignee name separately
  let assignedToName: string | null = null;
  if (ticket.assignedTo) {
    const [assignee] = await db.select({ name: users.name }).from(users).where(eq(users.id, ticket.assignedTo)).limit(1);
    assignedToName = assignee?.name ?? null;
  }

  return { ...ticket, assignedToName };
}

export async function getTicketById(ticketId: string, userId: string, userRole: string, userClientId?: string) {
  const ticket = await getTicketByIdInternal(ticketId);
  if (!ticket) throw new AppError(MSG.NOT_FOUND, 404);

  // Check access
  if (userRole === 'user') {
    if (!ticket.isVisibleToClient) throw new AppError(MSG.NOT_FOUND, 404);
    // Check client access
    const [project] = await db.select({ clientId: projects.clientId }).from(projects).where(eq(projects.id, ticket.projectId)).limit(1);
    if (!userClientId || project?.clientId !== userClientId) throw new AppError(MSG.NOT_FOUND, 404);
  } else if (userRole === 'consultor') {
    const [allocation] = await db
      .select({ id: projectAllocations.id })
      .from(projectAllocations)
      .where(and(eq(projectAllocations.projectId, ticket.projectId), eq(projectAllocations.userId, userId)))
      .limit(1);
    if (!allocation) throw new AppError(MSG.NOT_FOUND, 404);
  }

  return ticket;
}

export async function listTickets(params: {
  userId: string;
  userRole: string;
  userClientId?: string;
  projectId?: string;
  status?: string;
  type?: string;
  priority?: string;
  assignedTo?: string;
  createdBy?: string;
  search?: string;
  page: number;
  limit: number;
  sort?: string;
  order?: 'asc' | 'desc';
}) {
  const { page, limit, userId, userRole, userClientId } = params;
  const offset = (page - 1) * limit;

  const conditions = [];

  // Permission-based filtering
  if (userRole === 'user') {
    if (!userClientId) return { data: [], meta: buildMeta(0, { page, limit }) };
    conditions.push(eq(tickets.isVisibleToClient, true));
    // Only projects from user's client
    const clientProjects = await db.select({ id: projects.id }).from(projects).where(eq(projects.clientId, userClientId));
    if (clientProjects.length === 0) return { data: [], meta: buildMeta(0, { page, limit }) };
    conditions.push(inArray(tickets.projectId, clientProjects.map(p => p.id)));
  } else if (userRole === 'consultor') {
    const allocations = await db.select({ projectId: projectAllocations.projectId }).from(projectAllocations).where(eq(projectAllocations.userId, userId));
    if (allocations.length === 0) return { data: [], meta: buildMeta(0, { page, limit }) };
    conditions.push(inArray(tickets.projectId, allocations.map(a => a.projectId)));
  }

  // Optional filters
  if (params.projectId) conditions.push(eq(tickets.projectId, params.projectId));
  if (params.status) {
    const statuses = params.status.split(',') as Array<'open' | 'in_analysis' | 'in_progress' | 'in_review' | 'resolved' | 'closed' | 'reopened' | 'cancelled'>;
    if (statuses.length === 1) {
      conditions.push(eq(tickets.status, statuses[0]));
    } else {
      conditions.push(inArray(tickets.status, statuses));
    }
  }
  if (params.type) conditions.push(eq(tickets.type, params.type as 'bug' | 'improvement' | 'initiative'));
  if (params.priority) conditions.push(eq(tickets.priority, params.priority as 'low' | 'medium' | 'high' | 'critical'));
  if (params.assignedTo) conditions.push(eq(tickets.assignedTo, params.assignedTo));
  if (params.createdBy) conditions.push(eq(tickets.createdBy, params.createdBy));
  if (params.search) {
    conditions.push(or(ilike(tickets.title, `%${params.search}%`), ilike(tickets.description, `%${params.search}%`)));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Sort
  let orderBy;
  const direction = params.order === 'asc' ? asc : desc;
  switch (params.sort) {
    case 'priority': orderBy = direction(tickets.priority); break;
    case 'status': orderBy = direction(tickets.status); break;
    case 'updated_at': orderBy = direction(tickets.updatedAt); break;
    default: orderBy = direction(tickets.createdAt);
  }

  const [data, [{ total }]] = await Promise.all([
    db
      .select({
        id: tickets.id,
        code: tickets.code,
        projectId: tickets.projectId,
        projectName: projects.name,
        clientName: clients.companyName,
        createdBy: tickets.createdBy,
        createdByName: users.name,
        assignedTo: tickets.assignedTo,
        type: tickets.type,
        priority: tickets.priority,
        status: tickets.status,
        title: tickets.title,
        description: tickets.description,
        metadata: tickets.metadata,
        isVisibleToClient: tickets.isVisibleToClient,
        dueDate: tickets.dueDate,
        estimatedHours: tickets.estimatedHours,
        resolvedAt: tickets.resolvedAt,
        closedAt: tickets.closedAt,
        createdAt: tickets.createdAt,
        updatedAt: tickets.updatedAt,
      })
      .from(tickets)
      .innerJoin(projects, eq(tickets.projectId, projects.id))
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .innerJoin(users, eq(tickets.createdBy, users.id))
      .where(where)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset),
    db.select({ total: drizzleCount() }).from(tickets).where(where),
  ]);

  // Fetch assignee names for tickets that have assignments
  const assignedIds = [...new Set(data.filter(t => t.assignedTo).map(t => t.assignedTo!))];
  const assigneeMap = new Map<string, string>();
  if (assignedIds.length > 0) {
    const assignees = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, assignedIds));
    for (const a of assignees) assigneeMap.set(a.id, a.name);
  }

  const enrichedData = data.map(t => ({
    ...t,
    assignedToName: t.assignedTo ? (assigneeMap.get(t.assignedTo) ?? null) : null,
  }));

  return { data: enrichedData, meta: buildMeta(total, { page, limit }) };
}

export async function updateTicket(ticketId: string, userId: string, userRole: string, userClientId: string | undefined, data: Partial<{
  status: string;
  priority: string;
  assignedTo: string | null;
  isVisibleToClient: boolean;
  title: string;
  description: string;
  dueDate: string | null;
  estimatedHours: number | null;
}>) {
  const ticket = await getTicketByIdInternal(ticketId);
  if (!ticket) throw new AppError(MSG.NOT_FOUND, 404);

  // Validate access
  if (userRole === 'user') {
    if (!ticket.isVisibleToClient) throw new AppError(MSG.NOT_FOUND, 404);
    const [project] = await db.select({ clientId: projects.clientId }).from(projects).where(eq(projects.id, ticket.projectId)).limit(1);
    if (!userClientId || project?.clientId !== userClientId) throw new AppError(MSG.NOT_FOUND, 404);
  } else if (userRole === 'consultor') {
    const [allocation] = await db
      .select({ id: projectAllocations.id })
      .from(projectAllocations)
      .where(and(eq(projectAllocations.projectId, ticket.projectId), eq(projectAllocations.userId, userId)))
      .limit(1);
    if (!allocation) throw new AppError(MSG.NOT_FOUND, 404);
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };

  // Status transition
  if (data.status && data.status !== ticket.status) {
    const allowed = STATUS_TRANSITIONS[ticket.status];
    if (!allowed || !allowed.includes(data.status)) {
      throw new AppError(MSG.INVALID_TRANSITION, 400);
    }
    const roleAllowed = STATUS_ROLE_PERMISSIONS[data.status];
    if (!roleAllowed || !roleAllowed.includes(userRole)) {
      throw new AppError(MSG.NO_PERMISSION, 403);
    }
    updateData.status = data.status;
    await recordHistory(ticketId, userId, 'status', ticket.status, data.status);

    if (data.status === 'resolved') updateData.resolvedAt = new Date();
    if (data.status === 'closed') updateData.closedAt = new Date();
    if (data.status === 'reopened') {
      updateData.resolvedAt = null;
      updateData.closedAt = null;
    }
  }

  // Priority
  if (data.priority !== undefined && data.priority !== ticket.priority) {
    if (userRole === 'user') throw new AppError(MSG.NO_PERMISSION, 403);
    updateData.priority = data.priority;
    await recordHistory(ticketId, userId, 'priority', ticket.priority, data.priority);
  }

  // Assigned to
  if (data.assignedTo !== undefined && data.assignedTo !== ticket.assignedTo) {
    if (userRole !== 'gestor' && userRole !== 'super_admin') throw new AppError(MSG.NO_PERMISSION, 403);
    updateData.assignedTo = data.assignedTo;
    const oldName = ticket.assignedToName || 'Nenhum';
    let newName = 'Nenhum';
    if (data.assignedTo) {
      const [assignee] = await db.select({ name: users.name }).from(users).where(eq(users.id, data.assignedTo)).limit(1);
      newName = assignee?.name || data.assignedTo;
    }
    await recordHistory(ticketId, userId, 'assigned_to', oldName, newName);
  }

  // Visibility
  if (data.isVisibleToClient !== undefined && data.isVisibleToClient !== ticket.isVisibleToClient) {
    if (userRole === 'user') throw new AppError(MSG.NO_PERMISSION, 403);
    updateData.isVisibleToClient = data.isVisibleToClient;
    await recordHistory(ticketId, userId, 'is_visible_to_client', String(ticket.isVisibleToClient), String(data.isVisibleToClient));
  }

  // Title
  if (data.title !== undefined && data.title !== ticket.title) {
    updateData.title = data.title;
    await recordHistory(ticketId, userId, 'title', ticket.title, data.title);
  }

  // Description
  if (data.description !== undefined && data.description !== ticket.description) {
    updateData.description = data.description;
    await recordHistory(ticketId, userId, 'description', ticket.description || '', data.description);
  }

  // Due date
  if (data.dueDate !== undefined && data.dueDate !== ticket.dueDate) {
    updateData.dueDate = data.dueDate;
    await recordHistory(ticketId, userId, 'due_date', ticket.dueDate || 'Nenhum', data.dueDate || 'Nenhum');
  }

  // Estimated hours
  if (data.estimatedHours !== undefined) {
    const currentHours = ticket.estimatedHours ? Number(ticket.estimatedHours) : null;
    if (data.estimatedHours !== currentHours) {
      updateData.estimatedHours = data.estimatedHours != null ? String(data.estimatedHours) : null;
      await recordHistory(ticketId, userId, 'estimated_hours', currentHours != null ? String(currentHours) : 'Nenhum', data.estimatedHours != null ? String(data.estimatedHours) : 'Nenhum');
    }
  }

  await db.update(tickets).set(updateData).where(eq(tickets.id, ticketId));

  // Fire-and-forget notifications
  if (data.status && data.status !== ticket.status) {
    notifyStatusChanged(ticketId, ticket.status, data.status, userId);
  }
  if (data.assignedTo !== undefined && data.assignedTo !== ticket.assignedTo && data.assignedTo) {
    notifyTicketAssigned(ticketId, userId);
  }

  const result = await getTicketByIdInternal(ticketId);
  return result;
}

// --- Comments ---

export async function addComment(data: {
  ticketId: string;
  userId: string;
  userRole: string;
  userClientId?: string;
  content: string;
  isInternal?: boolean;
}) {
  if (!data.content.trim()) throw new AppError(MSG.COMMENT_EMPTY, 400);

  // Validate ticket access
  const ticket = await getTicketByIdInternal(data.ticketId);
  if (!ticket) throw new AppError(MSG.NOT_FOUND, 404);

  if (data.userRole === 'user') {
    if (!ticket.isVisibleToClient) throw new AppError(MSG.NOT_FOUND, 404);
    const [project] = await db.select({ clientId: projects.clientId }).from(projects).where(eq(projects.id, ticket.projectId)).limit(1);
    if (!data.userClientId || project?.clientId !== data.userClientId) throw new AppError(MSG.NOT_FOUND, 404);
  } else if (data.userRole === 'consultor') {
    const [allocation] = await db
      .select({ id: projectAllocations.id })
      .from(projectAllocations)
      .where(and(eq(projectAllocations.projectId, ticket.projectId), eq(projectAllocations.userId, data.userId)))
      .limit(1);
    if (!allocation) throw new AppError(MSG.NOT_FOUND, 404);
  }

  const isInternal = data.userRole === 'user' ? false : (data.isInternal ?? false);

  const [comment] = await db.insert(ticketComments).values({
    ticketId: data.ticketId,
    userId: data.userId,
    content: data.content,
    isInternal,
  }).returning();

  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, data.userId)).limit(1);

  // Fire-and-forget notification
  notifyNewComment(data.ticketId, comment.id, isInternal);

  return { ...comment, userName: user?.name || '' };
}

export async function listComments(ticketId: string, userId: string, userRole: string, userClientId?: string) {
  // Validate access
  await getTicketById(ticketId, userId, userRole, userClientId);

  const conditions = [eq(ticketComments.ticketId, ticketId)];
  if (userRole === 'user') {
    conditions.push(eq(ticketComments.isInternal, false));
  }

  const data = await db
    .select({
      id: ticketComments.id,
      ticketId: ticketComments.ticketId,
      userId: ticketComments.userId,
      userName: users.name,
      content: ticketComments.content,
      isInternal: ticketComments.isInternal,
      createdAt: ticketComments.createdAt,
    })
    .from(ticketComments)
    .innerJoin(users, eq(ticketComments.userId, users.id))
    .where(and(...conditions))
    .orderBy(asc(ticketComments.createdAt));

  return data;
}

// --- History ---

export async function listHistory(ticketId: string, userId: string, userRole: string, userClientId?: string) {
  await getTicketById(ticketId, userId, userRole, userClientId);

  const data = await db
    .select({
      id: ticketHistory.id,
      ticketId: ticketHistory.ticketId,
      userId: ticketHistory.userId,
      userName: users.name,
      field: ticketHistory.field,
      oldValue: ticketHistory.oldValue,
      newValue: ticketHistory.newValue,
      createdAt: ticketHistory.createdAt,
    })
    .from(ticketHistory)
    .innerJoin(users, eq(ticketHistory.userId, users.id))
    .where(eq(ticketHistory.ticketId, ticketId))
    .orderBy(asc(ticketHistory.createdAt));

  return data;
}

// --- Attachments ---

export async function addAttachment(data: {
  ticketId: string;
  fileId: string;
  uploadedBy: string;
  userRole: string;
  userClientId?: string;
}) {
  await getTicketById(data.ticketId, data.uploadedBy, data.userRole, data.userClientId);

  const [file] = await db.select({ id: files.id }).from(files).where(eq(files.id, data.fileId)).limit(1);
  if (!file) throw new AppError(MSG.FILE_NOT_FOUND, 404);

  const [attachment] = await db.insert(ticketAttachments).values({
    ticketId: data.ticketId,
    fileId: data.fileId,
    uploadedBy: data.uploadedBy,
  }).returning();

  await recordHistory(data.ticketId, data.uploadedBy, 'attachment', null, 'Arquivo anexado');

  return attachment;
}

export async function removeAttachment(ticketId: string, attachmentId: string, userId: string, userRole: string) {
  const [attachment] = await db
    .select({ id: ticketAttachments.id, uploadedBy: ticketAttachments.uploadedBy })
    .from(ticketAttachments)
    .where(and(eq(ticketAttachments.id, attachmentId), eq(ticketAttachments.ticketId, ticketId)))
    .limit(1);

  if (!attachment) throw new AppError(MSG.ATTACHMENT_NOT_FOUND, 404);

  if (attachment.uploadedBy !== userId && userRole !== 'gestor' && userRole !== 'super_admin') {
    throw new AppError(MSG.NO_PERMISSION, 403);
  }

  await db.delete(ticketAttachments).where(eq(ticketAttachments.id, attachmentId));
  await recordHistory(ticketId, userId, 'attachment', 'Arquivo anexado', 'Arquivo removido');
}

export async function listAttachments(ticketId: string) {
  const data = await db
    .select({
      id: ticketAttachments.id,
      ticketId: ticketAttachments.ticketId,
      fileId: ticketAttachments.fileId,
      fileName: files.originalName,
      fileUrl: files.url,
      fileSize: files.size,
      fileMimeType: files.mimeType,
      uploadedBy: ticketAttachments.uploadedBy,
      uploadedByName: users.name,
      createdAt: ticketAttachments.createdAt,
    })
    .from(ticketAttachments)
    .innerJoin(files, eq(ticketAttachments.fileId, files.id))
    .innerJoin(users, eq(ticketAttachments.uploadedBy, users.id))
    .where(eq(ticketAttachments.ticketId, ticketId))
    .orderBy(desc(ticketAttachments.createdAt));

  return data;
}

// --- Time Entries ---

export async function listTicketTimeEntries(ticketId: string, userId: string, userRole: string, userClientId?: string) {
  await getTicketById(ticketId, userId, userRole, userClientId);

  const data = await db
    .select({
      id: timeEntries.id,
      userId: timeEntries.userId,
      userName: users.name,
      date: timeEntries.date,
      hours: timeEntries.hours,
      description: timeEntries.description,
      status: timeEntries.status,
    })
    .from(timeEntries)
    .innerJoin(users, eq(timeEntries.userId, users.id))
    .where(eq(timeEntries.ticketId, ticketId))
    .orderBy(desc(timeEntries.date));

  return data.map((e) => ({ ...e, hours: Number(e.hours) }));
}

// --- Stats ---

export async function getTicketStats(params: {
  userId: string;
  userRole: string;
  userClientId?: string;
  projectId?: string;
}) {
  const { userId, userRole, userClientId, projectId } = params;

  // Build base conditions based on access
  const conditions = [];
  if (projectId) conditions.push(eq(tickets.projectId, projectId));

  if (userRole === 'user') {
    if (!userClientId) return emptyStats();
    conditions.push(eq(tickets.isVisibleToClient, true));
    const clientProjects = await db.select({ id: projects.id }).from(projects).where(eq(projects.clientId, userClientId));
    if (clientProjects.length === 0) return emptyStats();
    conditions.push(inArray(tickets.projectId, clientProjects.map(p => p.id)));
  } else if (userRole === 'consultor') {
    const allocations = await db.select({ projectId: projectAllocations.projectId }).from(projectAllocations).where(eq(projectAllocations.userId, userId));
    if (allocations.length === 0) return emptyStats();
    conditions.push(inArray(tickets.projectId, allocations.map(a => a.projectId)));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const allTickets = await db
    .select({
      status: tickets.status,
      priority: tickets.priority,
      type: tickets.type,
      assignedTo: tickets.assignedTo,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .where(where);

  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let unassigned = 0;
  let myAssigned = 0;
  let recentlyOpened = 0;

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  for (const t of allTickets) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
    byType[t.type] = (byType[t.type] || 0) + 1;
    if (!t.assignedTo) unassigned++;
    if (t.assignedTo === userId) myAssigned++;
    if (t.createdAt >= sevenDaysAgo) recentlyOpened++;
  }

  return { byStatus, byPriority, byType, unassigned, myAssigned, recentlyOpened };
}

function emptyStats() {
  return { byStatus: {}, byPriority: {}, byType: {}, unassigned: 0, myAssigned: 0, recentlyOpened: 0 };
}

// --- Helpers for notification service ---

export async function getTicketWithDetails(ticketId: string) {
  return getTicketByIdInternal(ticketId);
}
