import { eq, and, asc, sql, count as drizzleCount, inArray } from 'drizzle-orm';
import { db } from '../db';
import { projectInstallments, projects, clients } from '../db/schema';
import { AppError } from '../utils/app-error';
import type { DbTransaction } from '../utils/invoice-utils';

type DbOrTx = typeof db | DbTransaction;

const MSG = {
  NOT_FOUND: 'Parcela não encontrada.',
  NOT_FIXED_PRICE: 'Parcelas só podem ser gerenciadas em projetos de valor fixo.',
  NOT_PENDING: 'Apenas parcelas pendentes podem ser editadas ou excluídas.',
  PROJECT_NOT_FOUND: 'Projeto não encontrado.',
} as const;

async function assertFixedPriceProject(projectId: string, tx: DbOrTx = db) {
  const [project] = await tx.select({ billingType: projects.billingType })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) throw new AppError(MSG.PROJECT_NOT_FOUND, 404);
  if (project.billingType !== 'fixed_price') throw new AppError(MSG.NOT_FIXED_PRICE, 400);
}

export async function listByProject(projectId: string) {
  return db.select()
    .from(projectInstallments)
    .where(eq(projectInstallments.projectId, projectId))
    .orderBy(asc(projectInstallments.installmentNumber));
}

export async function create(projectId: string, data: { description?: string; amount: string; dueDate?: string }) {
  return await db.transaction(async (tx) => {
    await assertFixedPriceProject(projectId, tx);

    const existing = await tx.select({ installmentNumber: projectInstallments.installmentNumber })
      .from(projectInstallments)
      .where(eq(projectInstallments.projectId, projectId))
      .orderBy(asc(projectInstallments.installmentNumber));

    const nextNumber = existing.length > 0 ? existing[existing.length - 1].installmentNumber + 1 : 1;

    const [created] = await tx.insert(projectInstallments).values({
      projectId,
      installmentNumber: nextNumber,
      description: data.description || `Parcela ${nextNumber}`,
      amount: data.amount,
      dueDate: data.dueDate || null,
    }).returning();

    return created;
  });
}

export async function createBatch(projectId: string, data: { count: number; amount: string; startDate?: string }) {
  return await db.transaction(async (tx) => {
    await assertFixedPriceProject(projectId, tx);

    const existing = await tx.select({ installmentNumber: projectInstallments.installmentNumber })
      .from(projectInstallments)
      .where(eq(projectInstallments.projectId, projectId))
      .orderBy(asc(projectInstallments.installmentNumber));

    const startNumber = existing.length > 0 ? existing[existing.length - 1].installmentNumber + 1 : 1;

    const values = [];
    for (let i = 0; i < data.count; i++) {
      const num = startNumber + i;
      let dueDate: string | null = null;
      if (data.startDate) {
        const original = new Date(data.startDate + 'T12:00:00');
        const targetMonth = original.getMonth() + i;
        const d = new Date(original.getFullYear(), targetMonth, original.getDate());
        // Clamp: se o dia excedeu o mes alvo, usar ultimo dia do mes
        if (d.getMonth() !== targetMonth % 12) {
          d.setDate(0);
        }
        dueDate = d.toISOString().split('T')[0];
      }
      values.push({
        projectId,
        installmentNumber: num,
        description: `Parcela ${num}`,
        amount: data.amount,
        dueDate,
      });
    }

    const created = await tx.insert(projectInstallments).values(values).returning();
    return created;
  });
}

export async function update(projectId: string, id: string, data: Partial<{ description: string; amount: string; dueDate: string }>) {
  const [installment] = await db.select()
    .from(projectInstallments)
    .where(eq(projectInstallments.id, id))
    .limit(1);

  if (!installment) throw new AppError(MSG.NOT_FOUND, 404);
  if (installment.projectId !== projectId) throw new AppError(MSG.NOT_FOUND, 404);
  if (installment.status !== 'pending') throw new AppError(MSG.NOT_PENDING, 400);

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.description !== undefined) updateData.description = data.description;
  if (data.amount !== undefined) updateData.amount = data.amount;
  if (data.dueDate !== undefined) updateData.dueDate = data.dueDate || null;

  const [updated] = await db.update(projectInstallments)
    .set(updateData)
    .where(eq(projectInstallments.id, id))
    .returning();

  return updated;
}

export async function remove(projectId: string, id: string) {
  return await db.transaction(async (tx) => {
    const [installment] = await tx.select()
      .from(projectInstallments)
      .where(eq(projectInstallments.id, id))
      .limit(1);

    if (!installment) throw new AppError(MSG.NOT_FOUND, 404);
    if (installment.projectId !== projectId) throw new AppError(MSG.NOT_FOUND, 404);
    if (installment.status !== 'pending') throw new AppError(MSG.NOT_PENDING, 400);

    await tx.delete(projectInstallments).where(eq(projectInstallments.id, id));

    // Reorder remaining installments
    await reorder(installment.projectId, tx);
  });
}

async function reorder(projectId: string, tx: DbOrTx = db) {
  const all = await tx.select({ id: projectInstallments.id })
    .from(projectInstallments)
    .where(eq(projectInstallments.projectId, projectId))
    .orderBy(asc(projectInstallments.installmentNumber));

  for (let i = 0; i < all.length; i++) {
    await tx.update(projectInstallments)
      .set({ installmentNumber: i + 1, updatedAt: new Date() })
      .where(eq(projectInstallments.id, all[i].id));
  }
}

export async function getPendingInstallmentsWarning() {
  const now = new Date();
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const lastDayStr = lastDayOfMonth.toISOString().split('T')[0];

  const results = await db.select({
    projectId: projectInstallments.projectId,
    projectName: projects.name,
    count: drizzleCount(),
  })
    .from(projectInstallments)
    .innerJoin(projects, eq(projectInstallments.projectId, projects.id))
    .where(and(
      eq(projectInstallments.status, 'pending'),
      sql`${projectInstallments.dueDate} <= ${lastDayStr}`,
    ))
    .groupBy(projectInstallments.projectId, projects.name);

  const totalCount = results.reduce((sum, r) => sum + Number(r.count), 0);

  return {
    count: totalCount,
    projects: results.map(r => ({
      projectId: r.projectId,
      projectName: r.projectName,
      count: Number(r.count),
    })),
  };
}

export async function getPendingInstallmentsDetailed(year: number, month: number) {
  const lastDay = new Date(year, month, 0); // ultimo dia do mes informado

  const rows = await db
    .select({
      id: projectInstallments.id,
      installmentNumber: projectInstallments.installmentNumber,
      description: projectInstallments.description,
      amount: projectInstallments.amount,
      dueDate: projectInstallments.dueDate,
      projectId: projects.id,
      projectName: projects.name,
      clientName: clients.companyName,
      fixedPriceTotal: projects.fixedPriceTotal,
    })
    .from(projectInstallments)
    .innerJoin(projects, eq(projectInstallments.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(
        eq(projectInstallments.status, 'pending'),
        sql`${projectInstallments.dueDate} <= ${lastDay.toISOString().split('T')[0]}`,
      ),
    )
    .orderBy(asc(projects.name), asc(projectInstallments.installmentNumber));

  // Buscar total de parcelas por projeto (todas, nao so pendentes)
  const projectIds = [...new Set(rows.map(r => r.projectId))];

  const totalCounts = projectIds.length > 0
    ? await db
        .select({
          projectId: projectInstallments.projectId,
          total: drizzleCount(),
        })
        .from(projectInstallments)
        .where(inArray(projectInstallments.projectId, projectIds))
        .groupBy(projectInstallments.projectId)
    : [];

  const totalMap = new Map(totalCounts.map(t => [t.projectId, Number(t.total)]));

  // Agrupar por projeto
  const projectMap = new Map<string, {
    projectId: string;
    projectName: string;
    clientName: string;
    fixedPriceTotal: string;
    totalInstallments: number;
    installments: { id: string; installmentNumber: number; description: string | null; amount: string; dueDate: string | null }[];
  }>();

  for (const row of rows) {
    if (!projectMap.has(row.projectId)) {
      projectMap.set(row.projectId, {
        projectId: row.projectId,
        projectName: row.projectName,
        clientName: row.clientName,
        fixedPriceTotal: String(row.fixedPriceTotal),
        totalInstallments: totalMap.get(row.projectId) ?? 0,
        installments: [],
      });
    }
    projectMap.get(row.projectId)!.installments.push({
      id: row.id,
      installmentNumber: row.installmentNumber,
      description: row.description,
      amount: String(row.amount),
      dueDate: row.dueDate ? String(row.dueDate) : null,
    });
  }

  return { projects: Array.from(projectMap.values()) };
}
