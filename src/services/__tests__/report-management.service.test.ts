import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createChain } from '../../__test-utils__/drizzle-chain';
import { AppError } from '../../utils/app-error';

// --- Mock db (hoisted) ---
const { mockDb, mockTx } = vi.hoisted(() => {
  const mockTx = {
    delete: vi.fn(() => ({ where: vi.fn() })),
    insert: vi.fn(() => ({ values: vi.fn() })),
  };
  const mockDb = {
    select: vi.fn(),
    query: {
      reports: { findFirst: vi.fn() },
      reportPermissions: { findFirst: vi.fn() },
    },
    transaction: vi.fn(async (cb: (tx: typeof mockTx) => Promise<void>) => cb(mockTx)),
  };
  return { mockDb, mockTx };
});

vi.mock('../../db', () => ({ db: mockDb }));
vi.mock('../../db/schema', () => ({
  reports: { id: 'id', slug: 'slug', isActive: 'isActive' },
  reportPermissions: { reportId: 'reportId', userId: 'userId' },
  users: { id: 'id', name: 'name', email: 'email', role: 'role', isActive: 'isActive' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
}));

import { listReports, getReportBySlug, updatePermissions } from '../report-management.service';

describe('listReports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('super_admin sees all reports', async () => {
    const allReports = [
      { id: 'r1', name: 'Report 1', isActive: true },
      { id: 'r2', name: 'Report 2', isActive: true },
    ];
    const chain = createChain(allReports);
    mockDb.select.mockReturnValueOnce(chain as any);

    const result = await listReports('admin-1', 'super_admin');

    expect(result).toEqual(allReports);
    expect(result).toHaveLength(2);
  });
});

describe('getReportBySlug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns report by slug', async () => {
    const report = { id: 'r1', slug: 'hours-by-project', isActive: true };
    mockDb.query.reports.findFirst.mockResolvedValueOnce(report);

    const result = await getReportBySlug('hours-by-project', 'admin-1', 'super_admin');

    expect(result).toEqual(report);
    expect(mockDb.query.reports.findFirst).toHaveBeenCalled();
  });

  it('throws 404 for non-existent slug', async () => {
    mockDb.query.reports.findFirst.mockResolvedValueOnce(undefined);

    await expect(getReportBySlug('nao-existe', 'user-1', 'gestor')).rejects.toThrow(AppError);
  });
});

describe('updatePermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('replaces existing permissions with new ones', async () => {
    const report = { id: 'r1', slug: 'test', isActive: true };
    mockDb.query.reports.findFirst.mockResolvedValueOnce(report);

    await updatePermissions('r1', ['user-1', 'user-2'], 'admin-1');

    expect(mockDb.transaction).toHaveBeenCalled();
    expect(mockTx.delete).toHaveBeenCalled();
    expect(mockTx.insert).toHaveBeenCalled();
  });
});
