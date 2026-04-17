import { eq, and, between, count as drizzleCount, desc, asc, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { expenses, expenseComments, expenseCategories, projects, projectAllocations, users, clients, files } from '../db/schema';
import { AppError } from '../utils/app-error';
import type { PaginationParams } from '../types/pagination.types';
import { buildMeta } from '../utils/pagination';

import { assertUserHasProjectAccess } from '../utils/project-access';

const MSG = {
  NOT_FOUND: 'Despesa não encontrada.',
  NOT_OWNER: 'Você não pode editar despesas de outro usuário.',
  NOT_DRAFT: 'Apenas despesas em rascunho podem ser excluídas.',
  NOT_DRAFT_OR_REJECTED: 'Apenas despesas em rascunho ou rejeitadas podem ser editadas.',
  NOT_REJECTED: 'Apenas despesas rejeitadas podem ser resubmetidas.',
  NOT_SUBMITTED: 'Apenas despesas submetidas podem ser aprovadas ou rejeitadas.',
  NOT_ALLOCATED: 'Consultor não está alocado neste projeto.',
  NO_ENTRIES: 'Nenhuma despesa em rascunho encontrada para submeter nesta semana.',
  COMMENT_REQUIRED: 'Comentário é obrigatório ao rejeitar uma despesa.',
  PROJECT_NOT_FOUND: 'Projeto não encontrado ou inativo.',
  CATEGORY_NOT_FOUND: 'Categoria não encontrada ou inativa.',
  NOT_APPROVED_REIMBURSABLE: 'Apenas despesas aprovadas com reembolso pendente podem ser marcadas como reembolsadas.',
  ALREADY_REIMBURSED: 'Despesa já foi reembolsada.',
  NOT_REIMBURSED: 'Despesa não está marcada como reembolsada.',
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
  categoryName: expenseCategories.name,
  categoryMaxAmount: expenseCategories.maxAmount,
  categoryRequiresReceipt: expenseCategories.requiresReceipt,
  date: expenses.date,
  description: expenses.description,
  amount: expenses.amount,
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
    .leftJoin(expenseCategories, eq(expenses.expenseCategoryId, expenseCategories.id))
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

async function fetchCreatedByNames(expenseRows: { createdByUserId: string; consultantUserId: string | null }[]): Promise<{ createdByMap: Record<string, string>; consultantMap: Record<string, string> }> {
  const userIds = new Set<string>();
  for (const row of expenseRows) {
    userIds.add(row.createdByUserId);
    if (row.consultantUserId) userIds.add(row.consultantUserId);
  }

  if (userIds.size === 0) return { createdByMap: {}, consultantMap: {} };

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
  for (const row of expenseRows) {
    createdByMap[row.createdByUserId] = nameMap[row.createdByUserId] ?? '';
    if (row.consultantUserId) {
      consultantMap[row.consultantUserId] = nameMap[row.consultantUserId] ?? '';
    }
  }

  return { createdByMap, consultantMap };
}

// --- Core functions ---

export async function getMonthExpenses(userId: string, year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const firstDayStr = firstDay.toISOString().split('T')[0];
  const lastDayStr = lastDay.toISOString().split('T')[0];

  const rows = await buildExpenseQuery()
    .where(and(
      eq(expenses.createdByUserId, userId),
      between(expenses.date, firstDayStr, lastDayStr),
    ))
    .orderBy(asc(expenses.date), desc(expenses.createdAt));

  const rejectedIds = rows.filter(e => e.status === 'rejected').map(e => e.id);
  const commentsMap = await fetchRejectionComments(rejectedIds);
  const { createdByMap, consultantMap } = await fetchCreatedByNames(rows);

  const entriesWithExtras = rows.map(e => ({
    ...e,
    createdByName: createdByMap[e.createdByUserId] ?? '',
    consultantName: e.consultantUserId ? (consultantMap[e.consultantUserId] ?? null) : null,
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
  description: string;
  amount: string;
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

  // Validate category if provided
  if (data.expenseCategoryId) {
    const [category] = await db
      .select({ id: expenseCategories.id, isActive: expenseCategories.isActive })
      .from(expenseCategories)
      .where(eq(expenseCategories.id, data.expenseCategoryId))
      .limit(1);
    if (!category || !category.isActive) throw new AppError(MSG.CATEGORY_NOT_FOUND, 400);
  }

  // Update path
  if (data.id) {
    const [existing] = await db.select()
      .from(expenses)
      .where(eq(expenses.id, data.id))
      .limit(1);

    if (!existing) throw new AppError(MSG.NOT_FOUND, 404);

    // Ownership check: creator or gestor+
    if (existing.createdByUserId !== requestUserId && requestUserRole !== 'gestor' && requestUserRole !== 'super_admin') {
      throw new AppError(MSG.NOT_OWNER, 403);
    }
    if (existing.status !== 'draft' && existing.status !== 'rejected') {
      throw new AppError(MSG.NOT_DRAFT_OR_REJECTED, 400);
    }

    const [updated] = await db.update(expenses).set({
      projectId: data.projectId,
      consultantUserId: consultantUserId,
      expenseCategoryId: data.expenseCategoryId ?? null,
      date: data.date,
      description: data.description,
      amount: data.amount,
      receiptFileId: data.receiptFileId ?? null,
      requiresReimbursement: data.requiresReimbursement ?? false,
      templateId: data.templateId ?? null,
      status: 'draft',
      updatedAt: new Date(),
    }).where(eq(expenses.id, data.id)).returning();

    return updated;
  }

  // Insert path
  const [created] = await db.insert(expenses).values({
    projectId: data.projectId,
    createdByUserId: requestUserId,
    consultantUserId: consultantUserId,
    expenseCategoryId: data.expenseCategoryId ?? null,
    date: data.date,
    description: data.description,
    amount: data.amount,
    receiptFileId: data.receiptFileId ?? null,
    requiresReimbursement: data.requiresReimbursement ?? (requestUserRole === 'consultor'),
    templateId: data.templateId ?? null,
  }).returning();

  return created;
}

export async function deleteExpense(id: string, requestUserId: string, requestUserRole: string) {
  const [entry] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
  if (!entry) throw new AppError(MSG.NOT_FOUND, 404);

  if (entry.createdByUserId !== requestUserId && requestUserRole !== 'gestor' && requestUserRole !== 'super_admin') {
    throw new AppError(MSG.NOT_OWNER, 403);
  }
  if (entry.status !== 'draft') throw new AppError(MSG.NOT_DRAFT, 400);

  await db.delete(expenses).where(eq(expenses.id, id));
}

// --- Submit week with auto-approval ---

export async function submitWeek(userId: string, weekStartDate: string) {
  const weekEnd = getWeekEndDate(weekStartDate);

  const draftExpenses = await db
    .select({
      id: expenses.id,
      amount: expenses.amount,
      expenseCategoryId: expenses.expenseCategoryId,
      receiptFileId: expenses.receiptFileId,
    })
    .from(expenses)
    .where(and(
      eq(expenses.createdByUserId, userId),
      between(expenses.date, weekStartDate, weekEnd),
      eq(expenses.status, 'draft'),
    ));

  if (draftExpenses.length === 0) throw new AppError(MSG.NO_ENTRIES, 400);

  // Fetch categories for auto-approval check
  const categoryIds = [...new Set(draftExpenses.map(e => e.expenseCategoryId).filter(Boolean))] as string[];
  let categoriesMap = new Map<string, { maxAmount: string | null; requiresReceipt: boolean }>();

  if (categoryIds.length > 0) {
    const cats = await db
      .select({
        id: expenseCategories.id,
        maxAmount: expenseCategories.maxAmount,
        requiresReceipt: expenseCategories.requiresReceipt,
      })
      .from(expenseCategories)
      .where(inArray(expenseCategories.id, categoryIds));

    for (const c of cats) {
      categoriesMap.set(c.id, { maxAmount: c.maxAmount, requiresReceipt: c.requiresReceipt });
    }
  }

  const now = new Date();
  let autoApprovedCount = 0;
  let pendingApprovalCount = 0;
  const warnings: string[] = [];

  for (const expense of draftExpenses) {
    const category = expense.expenseCategoryId ? categoriesMap.get(expense.expenseCategoryId) : null;

    let canAutoApprove = false;
    if (category && category.maxAmount) {
      const withinBudget = Number(expense.amount) <= Number(category.maxAmount);
      const hasReceipt = !!expense.receiptFileId || !category.requiresReceipt;
      canAutoApprove = withinBudget && hasReceipt;
    }

    if (canAutoApprove) {
      await db.update(expenses).set({
        status: 'approved',
        autoApproved: true,
        submittedAt: now,
        approvedAt: now,
        updatedAt: now,
      }).where(eq(expenses.id, expense.id));
      autoApprovedCount++;
    } else {
      await db.update(expenses).set({
        status: 'submitted',
        submittedAt: now,
        updatedAt: now,
      }).where(eq(expenses.id, expense.id));
      pendingApprovalCount++;

      // Generate warning for why it wasn't auto-approved
      if (!category) {
        warnings.push(`Despesa sem categoria enviada para aprovação manual.`);
      } else if (!category.maxAmount) {
        warnings.push(`Categoria sem teto definido - enviada para aprovação manual.`);
      } else if (Number(expense.amount) > Number(category.maxAmount)) {
        warnings.push(`Despesa de R$ ${Number(expense.amount).toFixed(2)} acima do teto de R$ ${Number(category.maxAmount).toFixed(2)} - enviada para aprovação manual.`);
      } else if (category.requiresReceipt && !expense.receiptFileId) {
        warnings.push(`Despesa sem comprovante obrigatório - enviada para aprovação manual.`);
      }
    }
  }

  const result = {
    submitted: draftExpenses.length,
    autoApproved: autoApprovedCount,
    pendingApproval: pendingApprovalCount,
    warnings,
  };

  return result;
}

export async function resubmitExpense(id: string, requestUserId: string) {
  const [expense] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
  if (!expense) throw new AppError(MSG.NOT_FOUND, 404);
  if (expense.createdByUserId !== requestUserId) throw new AppError(MSG.NOT_OWNER, 403);
  if (expense.status !== 'rejected') throw new AppError(MSG.NOT_REJECTED, 400);

  // Re-check auto-approval
  let canAutoApprove = false;
  if (expense.expenseCategoryId) {
    const [category] = await db
      .select({ maxAmount: expenseCategories.maxAmount, requiresReceipt: expenseCategories.requiresReceipt })
      .from(expenseCategories)
      .where(eq(expenseCategories.id, expense.expenseCategoryId))
      .limit(1);

    if (category && category.maxAmount) {
      const withinBudget = Number(expense.amount) <= Number(category.maxAmount);
      const hasReceipt = !!expense.receiptFileId || !category.requiresReceipt;
      canAutoApprove = withinBudget && hasReceipt;
    }
  }

  const now = new Date();
  if (canAutoApprove) {
    const [updated] = await db.update(expenses).set({
      status: 'approved',
      autoApproved: true,
      submittedAt: now,
      approvedAt: now,
      updatedAt: now,
    }).where(eq(expenses.id, id)).returning();
    return updated;
  }

  const [updated] = await db.update(expenses).set({
    status: 'submitted',
    submittedAt: now,
    updatedAt: now,
  }).where(eq(expenses.id, id)).returning();
  return updated;
}

// --- Approval / Rejection (Phase 4) ---

export async function listPendingApprovals(params: PaginationParams & { consultantId?: string; projectId?: string }) {
  const { page, limit, consultantId, projectId } = params;
  const offset = (page - 1) * limit;

  const conditions = [eq(expenses.status, 'submitted')];
  if (consultantId) conditions.push(eq(expenses.createdByUserId, consultantId));
  if (projectId) conditions.push(eq(expenses.projectId, projectId));

  const where = and(...conditions);

  const [data, [{ total }]] = await Promise.all([
    db
      .select({
        ...expenseSelectFields,
        createdByName: users.name,
        createdByEmail: users.email,
      })
      .from(expenses)
      .leftJoin(projects, eq(expenses.projectId, projects.id))
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .leftJoin(expenseCategories, eq(expenses.expenseCategoryId, expenseCategories.id))
      .leftJoin(files, eq(expenses.receiptFileId, files.id))
      .leftJoin(users, eq(expenses.createdByUserId, users.id))
      .where(where)
      .orderBy(expenses.submittedAt, asc(expenses.date))
      .limit(limit)
      .offset(offset),
    db.select({ total: drizzleCount() }).from(expenses).where(where),
  ]);

  return { data, meta: buildMeta(total, { page, limit }) };
}

export async function approveExpenses(ids: string[], approvedByUserId: string) {
  const entries = await db
    .select({ id: expenses.id, status: expenses.status })
    .from(expenses)
    .where(inArray(expenses.id, ids));

  const notSubmitted = entries.filter(e => e.status !== 'submitted');
  if (notSubmitted.length > 0) throw new AppError(MSG.NOT_SUBMITTED, 400);

  const now = new Date();
  await db.update(expenses).set({
    status: 'approved',
    approvedAt: now,
    approvedBy: approvedByUserId,
    updatedAt: now,
  }).where(inArray(expenses.id, ids));

  return { approved: ids.length };
}

export async function rejectExpense(expenseId: string, rejectedByUserId: string, comment: string) {
  if (!comment.trim()) throw new AppError(MSG.COMMENT_REQUIRED, 400);

  const [expense] = await db.select().from(expenses).where(eq(expenses.id, expenseId)).limit(1);
  if (!expense) throw new AppError(MSG.NOT_FOUND, 404);
  if (expense.status !== 'submitted') throw new AppError(MSG.NOT_SUBMITTED, 400);

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

  if (consultantId) conditions.push(eq(expenses.createdByUserId, consultantId));
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

  const [data, [{ total }]] = await Promise.all([
    db
      .select({
        ...expenseSelectFields,
        createdByName: users.name,
        createdByEmail: users.email,
      })
      .from(expenses)
      .leftJoin(projects, eq(expenses.projectId, projects.id))
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .leftJoin(expenseCategories, eq(expenses.expenseCategoryId, expenseCategories.id))
      .leftJoin(files, eq(expenses.receiptFileId, files.id))
      .leftJoin(users, eq(expenses.createdByUserId, users.id))
      .where(where)
      .orderBy(desc(expenses.date))
      .limit(limit)
      .offset(offset),
    db.select({ total: drizzleCount() }).from(expenses).where(where),
  ]);

  // Compute totals
  const pendingConditions = [...conditions.filter(c => c !== where), sql`${expenses.reimbursedAt} IS NULL`];
  const paidConditions = [...conditions.filter(c => c !== where), sql`${expenses.reimbursedAt} IS NOT NULL`];

  // Simplified: compute from returned data + total
  const totalPending = data.filter(d => !d.reimbursedAt).reduce((sum, d) => sum + Number(d.amount), 0);
  const totalPaid = data.filter(d => !!d.reimbursedAt).reduce((sum, d) => sum + Number(d.amount), 0);

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
