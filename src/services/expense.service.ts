import { eq, and, or, between, count as drizzleCount, desc, asc, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { expenses, expenseComments, projectExpenseCategories, projects, projectAllocations, users, clients, files } from '../db/schema';
import { AppError } from '../utils/app-error';
import type { PaginationParams } from '../types/pagination.types';
import { buildMeta } from '../utils/pagination';

import { assertUserHasProjectAccess } from '../utils/project-access';
import { isDateInOpenPeriod } from './project-expense-period.service';

const MSG = {
  NOT_FOUND: 'Despesa não encontrada.',
  NOT_OWNER: 'Você não pode editar despesas de outro usuário.',
  NOT_CREATED: 'Apenas despesas criadas podem ser excluídas.',
  NOT_CREATED_OR_REJECTED: 'Despesas aprovadas não podem ser editadas.',
  NOT_REJECTED: 'Apenas despesas rejeitadas podem ser resubmetidas.',
  NOT_PENDING: 'Apenas despesas pendentes podem ser aprovadas ou rejeitadas.',
  NOT_ALLOCATED: 'Consultor não está alocado neste projeto.',
  COMMENT_REQUIRED: 'Comentário é obrigatório ao rejeitar uma despesa.',
  PROJECT_NOT_FOUND: 'Projeto não encontrado ou inativo.',
  CATEGORY_NOT_FOUND: 'Categoria não encontrada ou inativa.',
  NOT_APPROVED_REIMBURSABLE: 'Apenas despesas aprovadas com reembolso pendente podem ser marcadas como reembolsadas.',
  ALREADY_REIMBURSED: 'Despesa já foi reembolsada.',
  NOT_REIMBURSED: 'Despesa não está marcada como reembolsada.',
  PERIOD_NOT_OPEN: 'Esta data não está em um período aberto para lançamento de despesas.',
  KM_QUANTITY_REQUIRED: 'Quantidade de KM é obrigatória para esta categoria.',
  CATEGORY_NOT_IN_PROJECT: 'Esta categoria não está disponível neste projeto.',
  RECEIPT_REQUIRED: 'Esta categoria exige comprovante. Anexe um comprovante antes de salvar.',
  CANNOT_EDIT_REIMBURSEMENT: 'Consultor não pode alterar a marcação de reembolso após a criação.',
} as const;

// --- Week utility functions (Sunday-Saturday cycle) ---

function getSundayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay(); // 0=Sunday
  d.setDate(d.getDate() - day);
  return d.toISOString().split('T')[0];
}

function getWeekEndDate(weekStartDate: string): string {
  const start = new Date(weekStartDate + 'T12:00:00');
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return end.toISOString().split('T')[0];
}

// --- Select fields for expense queries ---

const expenseSelectFields = {
  id: expenses.id,
  projectId: expenses.projectId,
  projectName: projects.name,
  clientName: clients.companyName,
  createdByUserId: expenses.createdByUserId,
  consultantUserId: expenses.consultantUserId,
  expenseCategoryId: expenses.expenseCategoryId,
  categoryName: projectExpenseCategories.name,
  categoryMaxAmount: projectExpenseCategories.maxAmount,
  categoryRequiresReceipt: projectExpenseCategories.requiresReceipt,
  categoryKmRate: projectExpenseCategories.kmRate,
  categoryIsKmCategory: projectExpenseCategories.isKmCategory,
  date: expenses.date,
  description: expenses.description,
  amount: expenses.amount,
  kmQuantity: expenses.kmQuantity,
  clientChargeAmount: expenses.clientChargeAmount,
  clientChargeAmountManuallySet: expenses.clientChargeAmountManuallySet,
  receiptFileId: expenses.receiptFileId,
  receiptUrl: files.url,
  requiresReimbursement: expenses.requiresReimbursement,
  status: expenses.status,
  autoApproved: expenses.autoApproved,
  submittedAt: expenses.submittedAt,
  approvedAt: expenses.approvedAt,
  approvedBy: expenses.approvedBy,
  reimbursedAt: expenses.reimbursedAt,
  reimbursedBy: expenses.reimbursedBy,
  revertedBy: expenses.revertedBy,
  revertedAt: expenses.revertedAt,
  templateId: expenses.templateId,
  createdAt: expenses.createdAt,
  updatedAt: expenses.updatedAt,
};

function buildExpenseQuery() {
  return db
    .select(expenseSelectFields)
    .from(expenses)
    .leftJoin(projects, eq(expenses.projectId, projects.id))
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .leftJoin(projectExpenseCategories, eq(expenses.expenseCategoryId, projectExpenseCategories.id))
    .leftJoin(files, eq(expenses.receiptFileId, files.id));
}

async function fetchRejectionComments(expenseIds: string[]): Promise<Record<string, string>> {
  if (expenseIds.length === 0) return {};

  const comments = await db
    .select({
      expenseId: expenseComments.expenseId,
      content: expenseComments.content,
    })
    .from(expenseComments)
    .where(inArray(expenseComments.expenseId, expenseIds))
    .orderBy(desc(expenseComments.createdAt));

  const commentsMap: Record<string, string> = {};
  for (const c of comments) {
    if (!commentsMap[c.expenseId]) {
      commentsMap[c.expenseId] = c.content;
    }
  }
  return commentsMap;
}

async function fetchCreatedByNames(expenseRows: { createdByUserId: string; consultantUserId: string | null; revertedBy: string | null }[]): Promise<{ createdByMap: Record<string, string>; consultantMap: Record<string, string>; revertedByMap: Record<string, string> }> {
  const userIds = new Set<string>();
  for (const row of expenseRows) {
    userIds.add(row.createdByUserId);
    if (row.consultantUserId) userIds.add(row.consultantUserId);
    if (row.revertedBy) userIds.add(row.revertedBy);
  }

  if (userIds.size === 0) return { createdByMap: {}, consultantMap: {}, revertedByMap: {} };

  const userRows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, Array.from(userIds)));

  const nameMap: Record<string, string> = {};
  for (const u of userRows) {
    nameMap[u.id] = u.name;
  }

  const createdByMap: Record<string, string> = {};
  const consultantMap: Record<string, string> = {};
  const revertedByMap: Record<string, string> = {};
  for (const row of expenseRows) {
    createdByMap[row.createdByUserId] = nameMap[row.createdByUserId] ?? '';
    if (row.consultantUserId) {
      consultantMap[row.consultantUserId] = nameMap[row.consultantUserId] ?? '';
    }
    if (row.revertedBy) {
      revertedByMap[row.revertedBy] = nameMap[row.revertedBy] ?? '';
    }
  }

  return { createdByMap, consultantMap, revertedByMap };
}

// --- Core functions ---

export async function getMonthExpenses(
  userId: string,
  userRole: string,
  year: number,
  month: number,
  consultantUserId?: string,
  projectId?: string,
) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const firstDayStr = firstDay.toISOString().split('T')[0];
  const lastDayStr = lastDay.toISOString().split('T')[0];

  const conditions = [between(expenses.date, firstDayStr, lastDayStr)];

  if (consultantUserId && projectId) {
    // Consultant-scoped mode: gestor/admin viewing a specific consultant's expenses in a project
    if (userRole === 'consultor') {
      throw new AppError('Consultores não podem visualizar despesas de outros.', 403);
    }
    if (userRole === 'gestor') {
      // Validate gestor has access to this project
      const [alloc] = await db
        .select()
        .from(projectAllocations)
        .where(and(
          eq(projectAllocations.userId, userId),
          eq(projectAllocations.projectId, projectId),
        ))
        .limit(1);
      if (!alloc) throw new AppError('Sem acesso a este projeto.', 403);
    }
    conditions.push(eq(expenses.consultantUserId, consultantUserId));
    conditions.push(eq(expenses.projectId, projectId));
  } else {
    // Normal mode: "Minhas despesas" — only the user's own expenses
    // For gestors/admins: exclude expenses they created on behalf of other consultants
    conditions.push(eq(expenses.createdByUserId, userId));
    conditions.push(or(isNull(expenses.consultantUserId), eq(expenses.consultantUserId, userId))!);
  }

  const rows = await buildExpenseQuery()
    .where(and(...conditions))
    .orderBy(asc(expenses.date), desc(expenses.createdAt));

  const rejectedIds = rows.filter(e => e.status === 'rejected').map(e => e.id);
  const commentsMap = await fetchRejectionComments(rejectedIds);
  const { createdByMap, consultantMap, revertedByMap } = await fetchCreatedByNames(rows);

  const entriesWithExtras = rows.map(e => ({
    ...e,
    createdByName: createdByMap[e.createdByUserId] ?? '',
    consultantName: e.consultantUserId ? (consultantMap[e.consultantUserId] ?? null) : null,
    revertedByName: e.revertedBy ? (revertedByMap[e.revertedBy] ?? null) : null,
    rejectionComment: commentsMap[e.id] ?? null,
  }));

  const totalAmount = rows.reduce((sum, e) => sum + Number(e.amount), 0);

  return {
    year,
    month,
    expenses: entriesWithExtras,
    totalAmount,
  };
}

export async function getWeekExpenses(userId: string, weekStartDate: string) {
  const weekEnd = getWeekEndDate(weekStartDate);

  const rows = await buildExpenseQuery()
    .where(and(
      eq(expenses.createdByUserId, userId),
      between(expenses.date, weekStartDate, weekEnd),
    ))
    .orderBy(asc(expenses.date), desc(expenses.createdAt));

  const rejectedIds = rows.filter(e => e.status === 'rejected').map(e => e.id);
  const commentsMap = await fetchRejectionComments(rejectedIds);

  const entriesWithComments = rows.map(e => ({
    ...e,
    rejectionComment: commentsMap[e.id] ?? null,
  }));

  const totalAmount = rows.reduce((sum, e) => sum + Number(e.amount), 0);

  return {
    weekStartDate,
    expenses: entriesWithComments,
    totalAmount,
  };
}

// --- CRUD ---

interface UpsertExpenseInput {
  id?: string;
  projectId: string;
  consultantUserId?: string | null;
  expenseCategoryId?: string | null;
  date: string;
  description?: string | null;
  amount: string;
  kmQuantity?: string | null;
  clientChargeAmount?: string | null;
  clientChargeAmountManuallySet?: boolean;
  receiptFileId?: string | null;
  requiresReimbursement?: boolean;
  templateId?: string | null;
}

export async function upsertExpense(data: UpsertExpenseInput, requestUserId: string, requestUserRole: string) {
  // Validate project exists and is active
  const [project] = await db
    .select({ id: projects.id, isActive: projects.isActive })
    .from(projects)
    .where(eq(projects.id, data.projectId))
    .limit(1);
  if (!project || !project.isActive) throw new AppError(MSG.PROJECT_NOT_FOUND, 400);

  // Validar acesso do gestor ao projeto
  await assertUserHasProjectAccess(requestUserId, requestUserRole, data.projectId);

  // V2: Validate date is in an open period
  const periodCheck = await isDateInOpenPeriod(data.projectId, data.date);
  if (!periodCheck.allowed) {
    throw new AppError(periodCheck.reason || MSG.PERIOD_NOT_OPEN, 400);
  }

  // Determine consultant user id
  let consultantUserId: string | null = null;
  if (requestUserRole === 'consultor') {
    consultantUserId = requestUserId;
  } else if (data.consultantUserId) {
    consultantUserId = data.consultantUserId;
  }

  // Validate allocation if consultant is set
  if (consultantUserId) {
    const [allocation] = await db
      .select({ id: projectAllocations.id })
      .from(projectAllocations)
      .where(and(
        eq(projectAllocations.projectId, data.projectId),
        eq(projectAllocations.userId, consultantUserId),
      ))
      .limit(1);
    if (!allocation) throw new AppError(MSG.NOT_ALLOCATED, 400);
  }

  // V2: Validate category belongs to project (projectExpenseCategories)
  let categoryData: { isKmCategory: boolean; kmRate: string | null; requiresReceipt: boolean } | null = null;
  if (data.expenseCategoryId) {
    const [category] = await db
      .select({
        id: projectExpenseCategories.id,
        isActive: projectExpenseCategories.isActive,
        projectId: projectExpenseCategories.projectId,
        isKmCategory: projectExpenseCategories.isKmCategory,
        kmRate: projectExpenseCategories.kmRate,
        requiresReceipt: projectExpenseCategories.requiresReceipt,
      })
      .from(projectExpenseCategories)
      .where(eq(projectExpenseCategories.id, data.expenseCategoryId))
      .limit(1);

    if (!category || !category.isActive) throw new AppError(MSG.CATEGORY_NOT_FOUND, 400);
    if (category.projectId !== data.projectId) throw new AppError(MSG.CATEGORY_NOT_IN_PROJECT, 400);
    categoryData = { isKmCategory: category.isKmCategory, kmRate: category.kmRate, requiresReceipt: category.requiresReceipt };

    // Validate receipt is provided when category requires it
    if (category.requiresReceipt && !data.receiptFileId) {
      throw new AppError(MSG.RECEIPT_REQUIRED, 400);
    }
  }

  // V2: KM calculation
  let computedAmount = data.amount;
  let kmQuantity = data.kmQuantity ?? null;
  if (categoryData?.isKmCategory) {
    if (!kmQuantity) throw new AppError(MSG.KM_QUANTITY_REQUIRED, 400);
    if (categoryData.kmRate) {
      computedAmount = (Number(kmQuantity) * Number(categoryData.kmRate)).toFixed(2);
    }
  }

  // V2: client_charge_amount logic
  const isGestorOrAdmin = requestUserRole === 'gestor' || requestUserRole === 'super_admin';
  let clientChargeAmount = computedAmount;
  let clientChargeAmountManuallySet = false;
  if (isGestorOrAdmin && data.clientChargeAmount != null) {
    clientChargeAmount = data.clientChargeAmount;
    clientChargeAmountManuallySet = true;
  }

  // V2: requires_reimbursement defaults
  const defaultReimbursement = requestUserRole === 'consultor';

  // Update path
  if (data.id) {
    const [existing] = await db.select()
      .from(expenses)
      .where(eq(expenses.id, data.id))
      .limit(1);

    if (!existing) throw new AppError(MSG.NOT_FOUND, 404);

    // Ownership check: creator or gestor+
    if (existing.createdByUserId !== requestUserId && !isGestorOrAdmin) {
      throw new AppError(MSG.NOT_OWNER, 403);
    }
    if (existing.status === 'approved') {
      throw new AppError(MSG.NOT_CREATED_OR_REJECTED, 400);
    }

    // V2: Consultant cannot change reimbursement after creation
    if (requestUserRole === 'consultor' && data.requiresReimbursement !== undefined && data.requiresReimbursement !== existing.requiresReimbursement) {
      throw new AppError(MSG.CANNOT_EDIT_REIMBURSEMENT, 400);
    }

    // V2: Recalculate client_charge if not manually set
    if (!existing.clientChargeAmountManuallySet && !clientChargeAmountManuallySet) {
      clientChargeAmount = computedAmount;
    } else if (existing.clientChargeAmountManuallySet && !clientChargeAmountManuallySet) {
      // Keep existing manual value
      clientChargeAmount = existing.clientChargeAmount;
      clientChargeAmountManuallySet = true;
    }

    const [updated] = await db.update(expenses).set({
      projectId: data.projectId,
      consultantUserId: consultantUserId,
      expenseCategoryId: data.expenseCategoryId ?? null,
      date: data.date,
      description: data.description ?? null,
      amount: computedAmount,
      kmQuantity,
      clientChargeAmount,
      clientChargeAmountManuallySet,
      receiptFileId: data.receiptFileId ?? null,
      requiresReimbursement: data.requiresReimbursement ?? existing.requiresReimbursement,
      templateId: data.templateId ?? null,
      status: 'created',
      updatedAt: new Date(),
    }).where(eq(expenses.id, data.id)).returning();

    return updated;
  }

  // V2: Gestor/admin creating expense for consultant → auto-approved
  const isCreatingForOther = isGestorOrAdmin && consultantUserId && consultantUserId !== requestUserId;
  const initialStatus = isCreatingForOther ? 'approved' as const : 'created' as const;

  // Insert path
  const [created] = await db.insert(expenses).values({
    projectId: data.projectId,
    createdByUserId: requestUserId,
    consultantUserId: consultantUserId,
    expenseCategoryId: data.expenseCategoryId ?? null,
    date: data.date,
    description: data.description ?? null,
    amount: computedAmount,
    kmQuantity,
    clientChargeAmount,
    clientChargeAmountManuallySet,
    receiptFileId: data.receiptFileId ?? null,
    requiresReimbursement: data.requiresReimbursement ?? defaultReimbursement,
    templateId: data.templateId ?? null,
    status: initialStatus,
    ...(isCreatingForOther ? { approvedAt: new Date(), approvedBy: requestUserId } : {}),
  }).returning();

  return created;
}

export async function deleteExpense(id: string, requestUserId: string, requestUserRole: string) {
  const [entry] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
  if (!entry) throw new AppError(MSG.NOT_FOUND, 404);

  if (entry.createdByUserId !== requestUserId && requestUserRole !== 'gestor' && requestUserRole !== 'super_admin') {
    throw new AppError(MSG.NOT_OWNER, 403);
  }
  if (!['created', 'draft'].includes(entry.status)) throw new AppError(MSG.NOT_CREATED, 400);

  await db.delete(expenses).where(eq(expenses.id, id));
}

export async function resubmitExpense(id: string, requestUserId: string) {
  const [expense] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
  if (!expense) throw new AppError(MSG.NOT_FOUND, 404);
  if (expense.createdByUserId !== requestUserId) throw new AppError(MSG.NOT_OWNER, 403);
  if (expense.status !== 'rejected') throw new AppError(MSG.NOT_REJECTED, 400);

  const now = new Date();
  const [updated] = await db.update(expenses).set({
    status: 'created',
    submittedAt: null,
    updatedAt: now,
  }).where(eq(expenses.id, id)).returning();
  return updated;
}

export async function revertExpense(id: string, requestUserId: string, requestUserRole: string) {
  if (requestUserRole !== 'gestor' && requestUserRole !== 'super_admin') {
    throw new AppError('Apenas gestores podem reverter despesas.', 403);
  }

  const [entry] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
  if (!entry) throw new AppError(MSG.NOT_FOUND, 404);
  if (entry.status !== 'approved') throw new AppError('Apenas despesas aprovadas podem ser revertidas.', 400);
  if (entry.reimbursedAt) throw new AppError('Despesas reembolsadas não podem ser revertidas. Desfaça o reembolso antes.', 400);

  const now = new Date();
  const [updated] = await db.update(expenses).set({
    status: 'created',
    approvedAt: null,
    approvedBy: null,
    revertedBy: requestUserId,
    revertedAt: now,
    updatedAt: now,
  }).where(eq(expenses.id, id)).returning();

  return updated;
}

// --- Approval / Rejection (Phase 4) ---

export async function listPendingApprovals(params: PaginationParams & { consultantId?: string; projectId?: string; requestUserId: string; requestUserRole: string }) {
  const { page, limit, consultantId, projectId, requestUserId, requestUserRole } = params;
  const offset = (page - 1) * limit;

  const conditions = [inArray(expenses.status, ['created', 'submitted'])];
  if (consultantId) conditions.push(eq(expenses.consultantUserId, consultantId));
  if (projectId) conditions.push(eq(expenses.projectId, projectId));

  // Project access: gestor only sees expenses from allocated projects
  if (requestUserRole !== 'super_admin') {
    const allocs = await db
      .select({ projectId: projectAllocations.projectId })
      .from(projectAllocations)
      .where(eq(projectAllocations.userId, requestUserId));
    const projectIds = allocs.map(a => a.projectId);
    if (projectIds.length === 0) {
      return { data: [], meta: buildMeta(0, { page, limit }) };
    }
    conditions.push(inArray(expenses.projectId, projectIds));
  }

  const where = and(...conditions);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        ...expenseSelectFields,
        createdByName: users.name,
        createdByEmail: users.email,
      })
      .from(expenses)
      .leftJoin(projects, eq(expenses.projectId, projects.id))
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .leftJoin(projectExpenseCategories, eq(expenses.expenseCategoryId, projectExpenseCategories.id))
      .leftJoin(files, eq(expenses.receiptFileId, files.id))
      .leftJoin(users, eq(expenses.createdByUserId, users.id))
      .where(where)
      .orderBy(expenses.submittedAt, asc(expenses.date))
      .limit(limit)
      .offset(offset),
    db.select({ total: drizzleCount() }).from(expenses).where(where),
  ]);

  const { consultantMap } = await fetchCreatedByNames(rows);
  const data = rows.map(e => ({
    ...e,
    consultantName: e.consultantUserId ? (consultantMap[e.consultantUserId] ?? null) : null,
  }));

  return { data, meta: buildMeta(total, { page, limit }) };
}

export async function approveExpenses(
  ids: string[],
  approvedByUserId: string,
  updates?: Record<string, { clientChargeAmount: string }>,
) {
  const entries = await db
    .select({ id: expenses.id, status: expenses.status })
    .from(expenses)
    .where(inArray(expenses.id, ids));

  const notPending = entries.filter(e => !['created', 'submitted'].includes(e.status));
  if (notPending.length > 0) throw new AppError(MSG.NOT_PENDING, 400);

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(expenses).set({
      status: 'approved',
      approvedAt: now,
      approvedBy: approvedByUserId,
      revertedBy: null,
      revertedAt: null,
      updatedAt: now,
    }).where(inArray(expenses.id, ids));

    if (updates) {
      for (const [expenseId, data] of Object.entries(updates)) {
        if (ids.includes(expenseId)) {
          await tx.update(expenses).set({
            clientChargeAmount: data.clientChargeAmount,
            clientChargeAmountManuallySet: true,
            updatedAt: now,
          }).where(eq(expenses.id, expenseId));
        }
      }
    }
  });

  return { approved: ids.length };
}

export async function rejectExpense(expenseId: string, rejectedByUserId: string, comment: string) {
  if (!comment.trim()) throw new AppError(MSG.COMMENT_REQUIRED, 400);

  const [expense] = await db.select().from(expenses).where(eq(expenses.id, expenseId)).limit(1);
  if (!expense) throw new AppError(MSG.NOT_FOUND, 404);
  if (!['created', 'submitted'].includes(expense.status)) throw new AppError(MSG.NOT_PENDING, 400);

  await db.transaction(async (tx) => {
    await tx.update(expenses).set({
      status: 'rejected',
      updatedAt: new Date(),
    }).where(eq(expenses.id, expenseId));

    await tx.insert(expenseComments).values({
      expenseId,
      userId: rejectedByUserId,
      content: comment,
    });
  });

}

// --- Reimbursement (Phase 5, but included in service for completeness) ---

export async function listReimbursements(params: PaginationParams & {
  consultantId?: string;
  projectId?: string;
  from?: string;
  to?: string;
  reimbursementStatus?: 'pending' | 'paid';
}) {
  const { page, limit, consultantId, projectId, from, to, reimbursementStatus } = params;
  const offset = (page - 1) * limit;

  const conditions = [
    eq(expenses.status, 'approved'),
    eq(expenses.requiresReimbursement, true),
  ];

  if (consultantId) conditions.push(eq(expenses.consultantUserId, consultantId));
  if (projectId) conditions.push(eq(expenses.projectId, projectId));
  if (from && to) conditions.push(between(expenses.date, from, to));
  else if (from) conditions.push(sql`${expenses.date} >= ${from}`);
  else if (to) conditions.push(sql`${expenses.date} <= ${to}`);

  if (reimbursementStatus === 'pending') {
    conditions.push(sql`${expenses.reimbursedAt} IS NULL`);
  } else if (reimbursementStatus === 'paid') {
    conditions.push(sql`${expenses.reimbursedAt} IS NOT NULL`);
  }

  const where = and(...conditions);

  // Base conditions without reimbursementStatus filter (for aggregate totals)
  const baseConditions = [
    eq(expenses.status, 'approved'),
    eq(expenses.requiresReimbursement, true),
  ];
  if (consultantId) baseConditions.push(eq(expenses.consultantUserId, consultantId));
  if (projectId) baseConditions.push(eq(expenses.projectId, projectId));
  if (from && to) baseConditions.push(between(expenses.date, from, to));
  else if (from) baseConditions.push(sql`${expenses.date} >= ${from}`);
  else if (to) baseConditions.push(sql`${expenses.date} <= ${to}`);

  const [data, [{ total }], [pendingResult], [paidResult]] = await Promise.all([
    db
      .select({
        ...expenseSelectFields,
        createdByName: users.name,
        createdByEmail: users.email,
      })
      .from(expenses)
      .leftJoin(projects, eq(expenses.projectId, projects.id))
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .leftJoin(projectExpenseCategories, eq(expenses.expenseCategoryId, projectExpenseCategories.id))
      .leftJoin(files, eq(expenses.receiptFileId, files.id))
      .leftJoin(users, eq(expenses.createdByUserId, users.id))
      .where(where)
      .orderBy(desc(expenses.date))
      .limit(limit)
      .offset(offset),
    db.select({ total: drizzleCount() }).from(expenses).where(where),
    db.select({ total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)` })
      .from(expenses)
      .where(and(...baseConditions, sql`${expenses.reimbursedAt} IS NULL`)),
    db.select({ total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)` })
      .from(expenses)
      .where(and(...baseConditions, sql`${expenses.reimbursedAt} IS NOT NULL`)),
  ]);

  const totalPending = Number(pendingResult.total);
  const totalPaid = Number(paidResult.total);

  return { data, meta: buildMeta(total, { page, limit }), totalPending, totalPaid };
}

export async function markAsReimbursed(ids: string[], reimbursedByUserId: string) {
  const entries = await db
    .select({ id: expenses.id, status: expenses.status, requiresReimbursement: expenses.requiresReimbursement, reimbursedAt: expenses.reimbursedAt })
    .from(expenses)
    .where(inArray(expenses.id, ids));

  const invalid = entries.filter(e => e.status !== 'approved' || !e.requiresReimbursement || !!e.reimbursedAt);
  if (invalid.length > 0) throw new AppError(MSG.NOT_APPROVED_REIMBURSABLE, 400);

  const now = new Date();
  await db.update(expenses).set({
    reimbursedAt: now,
    reimbursedBy: reimbursedByUserId,
    updatedAt: now,
  }).where(inArray(expenses.id, ids));

  return { reimbursed: ids.length };
}

export async function unmarkReimbursement(id: string) {
  const [expense] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
  if (!expense) throw new AppError(MSG.NOT_FOUND, 404);
  if (!expense.reimbursedAt) throw new AppError(MSG.NOT_REIMBURSED, 400);

  const [updated] = await db.update(expenses).set({
    reimbursedAt: null,
    reimbursedBy: null,
    updatedAt: new Date(),
  }).where(eq(expenses.id, id)).returning();

  return updated;
}
