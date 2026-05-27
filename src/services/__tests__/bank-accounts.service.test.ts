import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createChain } from '../../__test-utils__/drizzle-chain';
import { AppError } from '../../utils/app-error';

// --- Mock db (hoisted) ---
const { mockDb } = vi.hoisted(() => {
  const mockDb = {
    query: {
      bankAccounts: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn(),
    update: vi.fn(),
  };
  return { mockDb };
});

vi.mock('../../db', () => ({ db: mockDb }));
vi.mock('../../db/schema', () => ({
  bankAccounts: { id: 'id', isActive: 'isActive' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
}));

import { list, create, toggleActive, getById } from '../bank-accounts.service';

const sampleAccount = {
  id: 'ba-1',
  label: 'Conta Principal',
  holderName: 'Cloupone LTDA',
  bankName: 'Banco do Brasil',
  agency: '1234',
  accountNumber: '56789-0',
  accountType: 'corrente' as const,
  pixKey: '12345678000190',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  updatedBy: 'admin-1',
};

describe('list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all accounts', async () => {
    const accounts = [sampleAccount, { ...sampleAccount, id: 'ba-2', label: 'Conta Secundaria' }];
    mockDb.query.bankAccounts.findMany.mockResolvedValueOnce(accounts);

    const result = await list();

    expect(result).toEqual(accounts);
    expect(mockDb.query.bankAccounts.findMany).toHaveBeenCalled();
  });
});

describe('create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates account with audit userId', async () => {
    const { id, isActive, createdAt, updatedAt, updatedBy, ...inputData } = sampleAccount;
    const created = { ...sampleAccount };
    const chain = createChain([created]);
    mockDb.insert.mockReturnValueOnce(chain as any);

    const result = await create(inputData, 'admin-1');

    expect(mockDb.insert).toHaveBeenCalled();
    expect(result).toEqual(created);
  });
});

describe('toggleActive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('toggles isActive state', async () => {
    mockDb.query.bankAccounts.findFirst.mockResolvedValueOnce({ ...sampleAccount, isActive: true });

    const toggled = { ...sampleAccount, isActive: false };
    const chain = createChain([toggled]);
    mockDb.update.mockReturnValueOnce(chain as any);

    const result = await toggleActive('ba-1', 'admin-1');

    expect(mockDb.update).toHaveBeenCalled();
    expect(result).toEqual(toggled);
  });
});

describe('getById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws 404 for non-existent account', async () => {
    mockDb.query.bankAccounts.findFirst.mockResolvedValueOnce(undefined);

    await expect(getById('nao-existe')).rejects.toThrow(AppError);
  });
});
