import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createChain } from '../../__test-utils__/drizzle-chain';
import { AppError } from '../../utils/app-error';

// --- Mock db (hoisted) ---
const { mockDb } = vi.hoisted(() => {
  const mockDb = {
    select: vi.fn(),
    query: {} as Record<string, unknown>,
  };
  return { mockDb };
});

vi.mock('../../db', () => ({ db: mockDb }));
vi.mock('../../db/schema', () => ({
  timeEntries: { userId: 'userId', hours: 'hours', date: 'date', projectId: 'projectId' },
  projects: { id: 'id', name: 'name', isActive: 'isActive', budgetHours: 'budgetHours' },
  clients: {},
  users: { id: 'id', name: 'name' },
  consultantProfiles: {},
  monthlyTimesheets: { status: 'status', year: 'year', month: 'month' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  between: vi.fn((...args: unknown[]) => args),
  sql: Object.assign(vi.fn((...args: unknown[]) => args), { raw: vi.fn() }),
  sum: vi.fn((col: unknown) => col),
  count: vi.fn(() => 'count'),
}));

import { getManagerDashboard, getConsultantDashboard } from '../dashboard.service';

describe('getManagerDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns total hours for the current month', async () => {
    const totalChain = createChain([{ total: '160' }]);
    const approvedChain = createChain([{ total: '100' }]);
    const pendingChain = createChain([{ total: 2 }]);
    const emptyChain = createChain([]);

    mockDb.select
      .mockReturnValueOnce(totalChain as any)
      .mockReturnValueOnce(approvedChain as any)
      .mockReturnValueOnce(pendingChain as any)
      .mockReturnValueOnce(emptyChain as any)
      .mockReturnValueOnce(emptyChain as any)
      .mockReturnValueOnce(emptyChain as any)
      .mockReturnValueOnce(emptyChain as any);

    const result = await getManagerDashboard();

    expect(result.totalHoursThisMonth).toBe(160);
    expect(result.totalHoursApproved).toBe(100);
    expect(result.totalHoursPending).toBe(60);
  });

  it('returns pending approval count', async () => {
    const totalChain = createChain([{ total: '80' }]);
    const approvedChain = createChain([{ total: '80' }]);
    const pendingChain = createChain([{ total: 5 }]);
    const emptyChain = createChain([]);

    mockDb.select
      .mockReturnValueOnce(totalChain as any)
      .mockReturnValueOnce(approvedChain as any)
      .mockReturnValueOnce(pendingChain as any)
      .mockReturnValueOnce(emptyChain as any)
      .mockReturnValueOnce(emptyChain as any)
      .mockReturnValueOnce(emptyChain as any)
      .mockReturnValueOnce(emptyChain as any);

    const result = await getManagerDashboard();

    expect(result.pendingApprovalCount).toBe(5);
  });
});

describe('getConsultantDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns weekly and monthly hours', async () => {
    const weekChain = createChain([{ total: '32' }]);
    const monthChain = createChain([{ total: '120' }]);
    const breakdownChain = createChain([]);
    const historyChain = createChain([]);

    mockDb.select
      .mockReturnValueOnce(weekChain as any)
      .mockReturnValueOnce(monthChain as any)
      .mockReturnValueOnce(breakdownChain as any)
      .mockReturnValueOnce(historyChain as any);

    const result = await getConsultantDashboard('user-1');

    expect(result.hoursThisWeek).toBe(32);
    expect(result.hoursThisMonth).toBe(120);
    expect(result.weeklyTarget).toBe(40);
  });

  it('returns breakdown by project', async () => {
    const weekChain = createChain([{ total: '10' }]);
    const monthChain = createChain([{ total: '40' }]);
    const breakdownChain = createChain([
      { projectName: 'Projeto A', hours: '25' },
      { projectName: 'Projeto B', hours: '15' },
    ]);
    const historyChain = createChain([]);

    mockDb.select
      .mockReturnValueOnce(weekChain as any)
      .mockReturnValueOnce(monthChain as any)
      .mockReturnValueOnce(breakdownChain as any)
      .mockReturnValueOnce(historyChain as any);

    const result = await getConsultantDashboard('user-1');

    expect(result.projectBreakdown).toEqual([
      { projectName: 'Projeto A', hours: 25 },
      { projectName: 'Projeto B', hours: 15 },
    ]);
  });
});
