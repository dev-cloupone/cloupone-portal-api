import { eq, and, or, between, count as drizzleCount, desc, asc, inArray, isNull, sql, gte, lt } from 'drizzle-orm';
import { db } from '../db';
import { expenses, expenseComments, projectExpenseCategories, projects, projectAllocations, users, clients, files } from '../db/schema';
import { appError } from '../utils/app-error';
import type { PaginationParams } from '../types/pagination.types';
import { buildMeta } from '../utils/pagination';

import { assertUserHasProjectAccess } from '../utils/project-access';
import { isDateInOpenPeriod } from './project-expense-period.service';
import * as expensePaymentService from './expense-payment.service';
import * as expenseInvoiceService from './expense-invoice.service';

const MSG = {
  NOT_FOUND: { message: 'Despesa não encontrada.', code: 'EXPENSE_NOT_FOUND' },
  NOT_OWNER: { message: 'Você não pode editar despesas de outro usuário.', code: 'EXPENSE_NOT_OWNER' },
  NOT_CREATED: { message: 'Apenas despesas criadas podem ser excluídas.', code: 'EXPENSE_NOT_CREATED' },
  NOT_CREATED_OR_REJECTED: { message: 'Despesas aprovadas não podem ser editadas.', code: 'EXPENSE_NOT_CREATED_OR_REJECTED' },
  NOT_REJECTED: { message: 'Apenas despesas rejeitadas podem ser resubmetidas.', code: 'EXPENSE_NOT_REJECTED' },
  NOT_PENDING: { message: 'Apenas despesas pendentes podem ser aprovadas ou rejeitadas.', code: 'EXPENSE_NOT_PENDING' },
  NOT_ALLOCATED: { message: 'Consultor não está alocado neste projeto.', code: 'EXPENSE_NOT_ALLOCATED' },
  COMMENT_REQUIRED: { message: 'Comentário é obrigatório ao rejeitar uma despesa.', code: 'EXPENSE_COMMENT_REQUIRED' },
  PROJECT_NOT_FOUND: { message: 'Projeto não encontrado ou inativo.', code: 'EXPENSE_PROJECT_NOT_FOUND' },
  CATEGORY_NOT_FOUND: { message: 'Categoria não encontrada ou inativa.', code: 'EXPENSE_CATEGORY_NOT_FOUND' },
  NOT_APPROVED_REIMBURSABLE: { message: 'Apenas despesas aprovadas com reembolso pendente podem ser marcadas como reembolsadas.', code: 'EXPENSE_NOT_APPROVED_REIMBURSABLE' },
  ALREADY_REIMBURSED: { message: 'Despesa já foi reembolsada.', code: 'EXPENSE_ALREADY_REIMBURSED' },
  NOT_REIMBURSED: { message: 'Despesa não está marcada como reembolsada.', code: 'EXPENSE_NOT_REIMBURSED' },
  PERIOD_NOT_OPEN: { message: 'Esta data não está em um período aberto para lançamento de despesas.', code: 'EXPENSE_PERIOD_NOT_OPEN' },
  KM_QUANTITY_REQUIRED: { message: 'Quantidade de KM é obrigatória para esta categoria.', code: 'EXPENSE_KM_QUANTITY_REQUIRED' },
  CATEGORY_NOT_IN_PROJECT: { message: 'Esta categoria não está disponível neste projeto.', code: 'EXPENSE_CATEGORY_NOT_IN_PROJECT' },
  RECEIPT_REQUIRED: { message: 'Esta categoria exige comprovante. Anexe um comprovante antes de salvar.', code: 'EXPENSE_RECEIPT_REQUIRED' },
  CANNOT_EDIT_REIMBURSEMENT: { message: 'Consultor não pode alterar a marcação de reembolso após a criação.', code: 'EXPENSE_CANNOT_EDIT_REIMBURSEMENT' },
  CONSULTANT_VIEW_FORBIDDEN: { message: 'Consultores não podem visualizar despesas de outros.', code: 'EXPENSE_CONSULTANT_VIEW_FORBIDDEN' },
  NO_PROJECT_ACCESS: { message: 'Sem acesso a este projeto.', code: 'EXPENSE_NO_PROJECT_ACCESS' },
  ONLY_GESTORS_CAN_REVERT: { message: 'Apenas gestores podem reverter despesas.', code: 'EXPENSE_ONLY_GESTORS_CAN_REVERT' },
  ONLY_APPROVED_CAN_REVERT: { message: 'Apenas despesas aprovadas podem ser revertidas.', code: 'EXPENSE_ONLY_APPROVED_CAN_REVERT' },
  REIMBURSED_CANNOT_REVERT: { message: 'Despesas reembolsadas não podem ser revertidas. Desfaça o reembolso antes.', code: 'EXPENSE_REIMBURSED_CANNOT_REVERT' },
  LINKED_PAYMENT_CONFIRMED: { message: 'Despesa vinculada a um pagamento confirmado/pago. Cancele o pagamento antes de reverter.', code: 'EXPENSE_LINKED_PAYMENT_CONFIRMED' },
  LINKED_INVOICE_ISSUED: { message: 'Despesa vinculada a uma fatura emitida/paga. Cancele a fatura antes de reverter.', code: 'EXPENSE_LINKED_INVOICE_ISSUED' },
  DATE_FILTER_INCOMPLETE: { message: 'Both year and month are required for date filtering', code: 'EXPENSE_DATE_FILTER_INCOMPLETE' },
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
  approvedAmount: expenses.approvedAmount,
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

export async function getExpenseById(id: string, requestUserId: string, requestUserRole: string) {
  const rows = await buildExpenseQuery()
    .where(eq(expenses.id, id))
    .limit(1);

  if (rows.length === 0) throw appError(MSG.NOT_FOUND, 404);

  const row = rows[0];

  // Access check
  if (requestUserRole === 'consultor') {
    if (row.createdByUserId !== requestUserId && row.consultantUserId !== requestUserId) {
      throw appError(MSG.NOT_FOUND, 404);
    }
  } else if (requestUserRole === 'gestor') {
    await assertUserHasProjectAccess(requestUserId, requestUserRole, row.projectId);
  }
  // super_admin and administrative can see all

  const { createdByMap, consultantMap, revertedByMap } = await fetchCreatedByNames([row]);
  const rejectionComments = await fetchRejectionComments([row.id]);

  return {
    ...row,
    createdByName: createdByMap[row.createdByUserId] ?? '',
    consultantName: row.consultantUserId ? (consultantMap[row.consultantUserId] ?? null) : null,
    revertedByName: row.revertedBy ? (revertedByMap[row.revertedBy] ?? null) : null,
    rejectionComment: rejectionComments[row.id] ?? null,
  };
}

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
      throw appError(MSG.CONSULTANT_VIEW_FORBIDDEN, 403);
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
      if (!alloc) throw appError(MSG.NO_PROJECT_ACCESS, 403);
    }
    conditions.push(eq(expenses.consultantUserId, consultantUserId));
    conditions.push(eq(expenses.projectId, projectId));
  } else if (consultantUserId) {
    // Consultant-scoped mode without project: all expenses for this consultant across projects
    if (userRole === 'consultor') {
      throw appError(MSG.CONSULTANT_VIEW_FORBIDDEN, 403);
    }
    if (userRole === 'gestor') {
      const gestorAllocations = await db
        .select({ projectId: projectAllocations.projectId })
        .from(projectAllocations)
        .where(eq(projectAllocations.userId, userId));
      const gestorProjectIds = gestorAllocations.map(r => r.projectId);
      if (gestorProjectIds.length === 0) {
        return { year, month, expenses: [], totalAmount: 0 };
      }
      conditions.push(inArray(expenses.projectId, gestorProjectIds));
    }
    conditions.push(eq(expenses.consultantUserId, consultantUserId));
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
  if (!project || !project.isActive) throw appError(MSG.PROJECT_NOT_FOUND, 400);

  // Validar acesso do gestor ao projeto
  await assertUserHasProjectAccess(requestUserId, requestUserRole, data.projectId);

  // V2: Validate date is in an open period
  const periodCheck = await isDateInOpenPeriod(data.projectId, data.date);
  if (!periodCheck.allowed) {
    throw appError(periodCheck.reason ? { message: periodCheck.reason, code: MSG.PERIOD_NOT_OPEN.code } : MSG.PERIOD_NOT_OPEN, 400);
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
    if (!allocation) throw appError(MSG.NOT_ALLOCATED, 400);
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

    if (!category || !category.isActive) throw appError(MSG.CATEGORY_NOT_FOUND, 400);
    if (category.projectId !== data.projectId) throw appError(MSG.CATEGORY_NOT_IN_PROJECT, 400);
    categoryData = { isKmCategory: category.isKmCategory, kmRate: category.kmRate, requiresReceipt: category.requiresReceipt };

    // Validate receipt is provided when category requires it
    if (category.requiresReceipt && !data.receiptFileId) {
      throw appError(MSG.RECEIPT_REQUIRED, 400);
    }
  }

  // V2: KM calculation
  let computedAmount = data.amount;
  let kmQuantity = data.kmQuantity ?? null;
  if (categoryData?.isKmCategory) {
    if (!kmQuantity) throw appError(MSG.KM_QUANTITY_REQUIRED, 400);
    if (categoryData.kmRate) {
      computedAmount = (Number(kmQuantity) * Number(categoryData.kmRate)).toFixed(2);
    }
  }

  const isGestorOrAdmin = requestUserRole === 'gestor' || requestUserRole === 'super_admin';

  // V2: requires_reimbursement defaults
  const defaultReimbursement = requestUserRole === 'consultor';

  // Update path
  if (data.id) {
    const [existing] = await db.select()
      .from(expenses)
      .where(eq(expenses.id, data.id))
      .limit(1);

    if (!existing) throw appError(MSG.NOT_FOUND, 404);

    // Ownership check: creator or gestor+
    if (existing.createdByUserId !== requestUserId && !isGestorOrAdmin) {
      throw appError(MSG.NOT_OWNER, 403);
    }
    if (existing.status === 'approved') {
      throw appError(MSG.NOT_CREATED_OR_REJECTED, 400);
    }

    // V2: Consultant cannot change reimbursement after creation
    if (requestUserRole === 'consultor' && data.requiresReimbursement !== undefined && data.requiresReimbursement !== existing.requiresReimbursement) {
      throw appError(MSG.CANNOT_EDIT_REIMBURSEMENT, 400);
    }

    const [updated] = await db.update(expenses).set({
      projectId: data.projectId,
      consultantUserId: consultantUserId,
      expenseCategoryId: data.expenseCategoryId ?? null,
      date: data.date,
      description: data.description ?? null,
      amount: computedAmount,
      kmQuantity,
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
    receiptFileId: data.receiptFileId ?? null,
    requiresReimbursement: data.requiresReimbursement ?? defaultReimbursement,
    templateId: data.templateId ?? null,
    status: initialStatus,
    ...(isCreatingForOther ? { approvedAt: new Date(), approvedBy: requestUserId } : {}),
  }).returning();

  // Auto-generate expense payment draft for auto-approved expenses
  if (isCreatingForOther && created.requiresReimbursement && consultantUserId) {
    try {
      await expensePaymentService.addExpenseToDraft(
        created.id,
        consultantUserId,
        requestUserId,
      );
    } catch (err) {
      console.warn(`Auto-geração de expense payment draft falhou para despesa ${created.id}:`, err);
    }
  }

  // Auto-generate expense invoice draft for auto-approved expenses (all approved, not just reimbursable)
  if (isCreatingForOther) {
    try {
      await expenseInvoiceService.addExpenseToInvoiceDraft(created.id, requestUserId);
    } catch (err) {
      console.warn(`Auto-geração de expense invoice draft falhou para despesa ${created.id}:`, err);
    }
  }

  return created;
}

export async function deleteExpense(id: string, requestUserId: string, requestUserRole: string) {
  const [entry] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
  if (!entry) throw appError(MSG.NOT_FOUND, 404);

  if (entry.createdByUserId !== requestUserId && requestUserRole !== 'gestor' && requestUserRole !== 'super_admin') {
    throw appError(MSG.NOT_OWNER, 403);
  }
  if (!['created', 'draft'].includes(entry.status)) throw appError(MSG.NOT_CREATED, 400);

  await db.delete(expenses).where(eq(expenses.id, id));
}

export async function resubmitExpense(id: string, requestUserId: string) {
  const [expense] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
  if (!expense) throw appError(MSG.NOT_FOUND, 404);
  if (expense.createdByUserId !== requestUserId) throw appError(MSG.NOT_OWNER, 403);
  if (expense.status !== 'rejected') throw appError(MSG.NOT_REJECTED, 400);

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
    throw appError(MSG.ONLY_GESTORS_CAN_REVERT, 403);
  }

  const [entry] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
  if (!entry) throw appError(MSG.NOT_FOUND, 404);
  if (entry.status !== 'approved') throw appError(MSG.ONLY_APPROVED_CAN_REVERT, 400);
  if (entry.reimbursedAt) throw appError(MSG.REIMBURSED_CANNOT_REVERT, 400);

  // Check if expense is linked to a payment
  const paymentLink = await expensePaymentService.checkExpensePaymentLink(id);
  let removeResult: { removed: boolean; paymentDeleted: boolean } | null = null;
  if (paymentLink.linked) {
    if (paymentLink.paymentStatus !== 'draft') {
      throw appError(MSG.LINKED_PAYMENT_CONFIRMED, 400);
    }
    removeResult = await expensePaymentService.removeExpenseFromDraft(id);
  }

  // Check if expense is linked to an invoice
  const invoiceLink = await expenseInvoiceService.checkExpenseInvoiceLink(id);
  let invoiceRemoveResult: { removed: boolean; invoiceDeleted: boolean } | null = null;
  if (invoiceLink.linked) {
    if (invoiceLink.invoiceStatus !== 'draft') {
      throw appError(MSG.LINKED_INVOICE_ISSUED, 400);
    }
    invoiceRemoveResult = await expenseInvoiceService.removeExpenseFromInvoiceDraft(id);
  }

  const now = new Date();
  const [updated] = await db.update(expenses).set({
    status: 'created',
    approvedAt: null,
    approvedBy: null,
    revertedBy: requestUserId,
    revertedAt: now,
    updatedAt: now,
  }).where(eq(expenses.id, id)).returning();

  return {
    ...updated,
    paymentWarning: paymentLink.linked
      ? removeResult?.paymentDeleted
        ? 'Despesa removida do pagamento. O pagamento foi excluído por estar vazio.'
        : 'Despesa removida do pagamento em rascunho.'
      : null,
    invoiceWarning: invoiceLink.linked
      ? invoiceRemoveResult?.invoiceDeleted
        ? 'Despesa removida da fatura. A fatura foi excluída por estar vazia.'
        : 'Despesa removida da fatura em rascunho.'
      : null,
  };
}

// --- Approval / Rejection (Phase 4) ---

export async function listPendingApprovals(params: PaginationParams & { consultantId?: string; projectId?: string; year?: number; month?: number; requestUserId: string; requestUserRole: string }) {
  const { page, limit, consultantId, projectId, year, month, requestUserId, requestUserRole } = params;
  const offset = (page - 1) * limit;

  const conditions = [inArray(expenses.status, ['created', 'submitted'])];
  if (consultantId) conditions.push(eq(expenses.consultantUserId, consultantId));
  if (projectId) conditions.push(eq(expenses.projectId, projectId));
  if ((year && !month) || (!year && month)) {
    throw appError(MSG.DATE_FILTER_INCOMPLETE, 400);
  }
  if (year && month) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
    conditions.push(gte(expenses.date, startDate));
    conditions.push(lt(expenses.date, endDate));
  }

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
  updates?: Record<string, { approvedAmount?: string }>,
) {
  const entries = await db
    .select({ id: expenses.id, status: expenses.status })
    .from(expenses)
    .where(inArray(expenses.id, ids));

  const notPending = entries.filter(e => !['created', 'submitted'].includes(e.status));
  if (notPending.length > 0) throw appError(MSG.NOT_PENDING, 400);

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
        if (ids.includes(expenseId) && data.approvedAmount) {
          await tx.update(expenses).set({
            approvedAmount: data.approvedAmount,
            updatedAt: now,
          }).where(eq(expenses.id, expenseId));
        }
      }
    }
  });

  // Auto-generate/aggregate expense payment drafts (best-effort)
  const approvedExpenses = await db.select({
    id: expenses.id,
    consultantUserId: expenses.consultantUserId,
    requiresReimbursement: expenses.requiresReimbursement,
  }).from(expenses).where(inArray(expenses.id, ids));

  for (const expense of approvedExpenses) {
    if (expense.requiresReimbursement && expense.consultantUserId) {
      try {
        await expensePaymentService.addExpenseToDraft(
          expense.id,
          expense.consultantUserId,
          approvedByUserId,
        );
      } catch (err) {
        console.warn(`Auto-geração de expense payment draft falhou para despesa ${expense.id}:`, err);
      }
    }
  }

  // Auto-generate/aggregate expense invoice drafts (best-effort, all approved expenses)
  for (const expense of approvedExpenses) {
    try {
      await expenseInvoiceService.addExpenseToInvoiceDraft(expense.id, approvedByUserId);
    } catch (err) {
      console.warn(`Auto-geração de expense invoice draft falhou para despesa ${expense.id}:`, err);
    }
  }

  return { approved: ids.length };
}

export async function rejectExpense(expenseId: string, rejectedByUserId: string, comment: string) {
  if (!comment.trim()) throw appError(MSG.COMMENT_REQUIRED, 400);

  const [expense] = await db.select().from(expenses).where(eq(expenses.id, expenseId)).limit(1);
  if (!expense) throw appError(MSG.NOT_FOUND, 404);
  if (!['created', 'submitted'].includes(expense.status)) throw appError(MSG.NOT_PENDING, 400);

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
  if (invalid.length > 0) throw appError(MSG.NOT_APPROVED_REIMBURSABLE, 400);

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
  if (!expense) throw appError(MSG.NOT_FOUND, 404);
  if (!expense.reimbursedAt) throw appError(MSG.NOT_REIMBURSED, 400);

  const [updated] = await db.update(expenses).set({
    reimbursedAt: null,
    reimbursedBy: null,
    updatedAt: new Date(),
  }).where(eq(expenses.id, id)).returning();

  return updated;
}
