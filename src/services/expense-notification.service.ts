import { eq, and, or, inArray } from 'drizzle-orm';
import { db } from '../db';
import { expenses, expenseCategories, users } from '../db/schema';
import { getEmailProvider } from '../providers/email';
import { buildExpensesSubmittedEmail } from '../emails/expenses-submitted';
import { buildExpenseApprovedEmail } from '../emails/expense-approved';
import { buildExpenseRejectedEmail } from '../emails/expense-rejected';
import { buildReimbursementPaidEmail } from '../emails/reimbursement-paid';
import { getSettingsMap } from './platform-settings.service';
import { env } from '../config/env';
import { logger } from '../utils/logger';

function getExpensesUrl(): string {
  return `${env.FRONTEND_URL}/expenses`;
}

function getExpenseApprovalsUrl(): string {
  return `${env.FRONTEND_URL}/expense-approvals`;
}

async function getAppName(): Promise<string> {
  const settings = await getSettingsMap();
  return settings['app_name'] || 'Template Base';
}

function formatCurrencyBR(value: number | string): string {
  return `R$ ${Number(value).toFixed(2).replace('.', ',')}`;
}

function formatDateBR(dateStr: string): string {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Notify managers that expenses have been submitted for approval.
 * Called from submitWeek() when there are non-auto-approved expenses.
 */
export async function notifyExpensesSubmitted(
  consultantUserId: string,
  weekStartDate: string,
  weekEndDate: string,
  expenseCount: number,
  totalAmount: number,
) {
  try {
    // Get consultant info
    const [consultant] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, consultantUserId))
      .limit(1);
    if (!consultant) return;

    // Get managers and super_admins
    const managers = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(and(
        or(eq(users.role, 'gestor'), eq(users.role, 'super_admin')),
        eq(users.isActive, true),
      ));

    if (managers.length === 0) return;

    const appName = await getAppName();
    const emailProvider = getEmailProvider();

    for (const manager of managers) {
      const emailData = buildExpensesSubmittedEmail({
        managerName: manager.name,
        consultantName: consultant.name,
        weekStart: formatDateBR(weekStartDate),
        weekEnd: formatDateBR(weekEndDate),
        expenseCount,
        totalAmount: formatCurrencyBR(totalAmount),
        approvalUrl: getExpenseApprovalsUrl(),
        appName,
      });

      await emailProvider.send({
        to: manager.email,
        subject: emailData.subject,
        text: emailData.text,
        html: emailData.html,
      });
    }

    logger.info({ consultantUserId, expenseCount }, 'Expenses submitted notification sent to managers');
  } catch (err) {
    logger.error({ err, consultantUserId }, 'Failed to send expenses submitted notification');
  }
}

/**
 * Notify consultant that their expenses have been approved.
 * Called from approveExpenses().
 */
export async function notifyExpenseApproved(expenseIds: string[], approvedByUserId: string) {
  try {
    // Get approved expenses grouped by creator
    const approvedExpenses = await db
      .select({
        id: expenses.id,
        amount: expenses.amount,
        createdByUserId: expenses.createdByUserId,
      })
      .from(expenses)
      .where(inArray(expenses.id, expenseIds));

    if (approvedExpenses.length === 0) return;

    // Group by user
    const byUser = new Map<string, { totalAmount: number; count: number }>();
    for (const exp of approvedExpenses) {
      const existing = byUser.get(exp.createdByUserId);
      if (existing) {
        existing.totalAmount += Number(exp.amount);
        existing.count += 1;
      } else {
        byUser.set(exp.createdByUserId, { totalAmount: Number(exp.amount), count: 1 });
      }
    }

    const appName = await getAppName();
    const emailProvider = getEmailProvider();

    for (const [userId, data] of byUser) {
      const [user] = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) continue;

      const emailData = buildExpenseApprovedEmail({
        consultantName: user.name,
        expenseCount: data.count,
        totalAmount: formatCurrencyBR(data.totalAmount),
        appName,
      });

      await emailProvider.send({
        to: user.email,
        subject: emailData.subject,
        text: emailData.text,
        html: emailData.html,
      });

      logger.info({ userId, expenseCount: data.count }, 'Expense approved notification sent');
    }
  } catch (err) {
    logger.error({ err, expenseIds }, 'Failed to send expense approved notifications');
  }
}

/**
 * Notify consultant that their expense has been rejected.
 * Called from rejectExpense().
 */
export async function notifyExpenseRejected(
  expenseId: string,
  rejectedByUserId: string,
  comment: string,
) {
  try {
    // Get expense details
    const [expense] = await db
      .select({
        date: expenses.date,
        amount: expenses.amount,
        description: expenses.description,
        createdByUserId: expenses.createdByUserId,
        expenseCategoryId: expenses.expenseCategoryId,
      })
      .from(expenses)
      .where(eq(expenses.id, expenseId))
      .limit(1);
    if (!expense) return;

    // Get consultant
    const [consultant] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, expense.createdByUserId))
      .limit(1);
    if (!consultant) return;

    // Get reviewer name
    const [reviewer] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, rejectedByUserId))
      .limit(1);

    // Get category name
    let categoryName = 'Sem categoria';
    if (expense.expenseCategoryId) {
      const [cat] = await db
        .select({ name: expenseCategories.name })
        .from(expenseCategories)
        .where(eq(expenseCategories.id, expense.expenseCategoryId))
        .limit(1);
      if (cat) categoryName = cat.name;
    }

    const appName = await getAppName();
    const emailProvider = getEmailProvider();

    const emailData = buildExpenseRejectedEmail({
      consultantName: consultant.name,
      date: formatDateBR(expense.date),
      categoryName,
      amount: formatCurrencyBR(expense.amount),
      description: expense.description.length > 100
        ? expense.description.substring(0, 100) + '...'
        : expense.description,
      comment,
      reviewerName: reviewer?.name || 'Gestor',
      appName,
      expensesUrl: getExpensesUrl(),
    });

    await emailProvider.send({
      to: consultant.email,
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html,
    });

    logger.info({ expenseId, userId: expense.createdByUserId }, 'Expense rejected notification sent');
  } catch (err) {
    logger.error({ err, expenseId }, 'Failed to send expense rejected notification');
  }
}

/**
 * Notify consultant(s) that their expenses have been reimbursed.
 * Called from markAsReimbursed().
 */
export async function notifyReimbursementPaid(expenseIds: string[], reimbursedByUserId: string) {
  try {
    // Get reimbursed expenses with category info
    const reimbursedExpenses = await db
      .select({
        id: expenses.id,
        date: expenses.date,
        amount: expenses.amount,
        createdByUserId: expenses.createdByUserId,
        expenseCategoryId: expenses.expenseCategoryId,
        categoryName: expenseCategories.name,
      })
      .from(expenses)
      .leftJoin(expenseCategories, eq(expenses.expenseCategoryId, expenseCategories.id))
      .where(inArray(expenses.id, expenseIds));

    if (reimbursedExpenses.length === 0) return;

    // Get who reimbursed
    const [reimburser] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, reimbursedByUserId))
      .limit(1);

    // Group by user
    const byUser = new Map<string, {
      items: { date: string; categoryName: string; amount: string }[];
      totalAmount: number;
    }>();

    for (const exp of reimbursedExpenses) {
      const userId = exp.createdByUserId;
      const existing = byUser.get(userId);
      const item = {
        date: formatDateBR(exp.date),
        categoryName: exp.categoryName || 'Sem categoria',
        amount: formatCurrencyBR(exp.amount),
      };

      if (existing) {
        existing.items.push(item);
        existing.totalAmount += Number(exp.amount);
      } else {
        byUser.set(userId, { items: [item], totalAmount: Number(exp.amount) });
      }
    }

    const appName = await getAppName();
    const emailProvider = getEmailProvider();

    for (const [userId, data] of byUser) {
      const [user] = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) continue;

      const emailData = buildReimbursementPaidEmail({
        consultantName: user.name,
        expenses: data.items,
        totalAmount: formatCurrencyBR(data.totalAmount),
        paidByName: reimburser?.name || 'Gestor',
        appName,
      });

      await emailProvider.send({
        to: user.email,
        subject: emailData.subject,
        text: emailData.text,
        html: emailData.html,
      });

      logger.info({ userId, expenseCount: data.items.length }, 'Reimbursement paid notification sent');
    }
  } catch (err) {
    logger.error({ err, expenseIds }, 'Failed to send reimbursement paid notifications');
  }
}
