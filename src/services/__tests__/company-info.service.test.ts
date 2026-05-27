import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createChain } from '../../__test-utils__/drizzle-chain';
import { AppError } from '../../utils/app-error';

// --- Mock db (hoisted) ---
const { mockDb } = vi.hoisted(() => {
  const mockDb = {
    query: {
      companyInfo: { findFirst: vi.fn() },
    },
    update: vi.fn(),
    insert: vi.fn(),
  };
  return { mockDb };
});

vi.mock('../../db', () => ({ db: mockDb }));
vi.mock('../../db/schema', () => ({
  companyInfo: { id: 'id' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
}));

import { getCompanyInfo, upsertCompanyInfo } from '../company-info.service';

const sampleData = {
  companyName: 'Cloupone LTDA',
  cnpj: '12.345.678/0001-90',
  address: 'Rua Teste 123',
  zipCode: '01234-567',
  cityState: 'Sao Paulo - SP',
};

describe('getCompanyInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns company data', async () => {
    const companyData = { id: 'c1', ...sampleData };
    mockDb.query.companyInfo.findFirst.mockResolvedValueOnce(companyData);

    const result = await getCompanyInfo();

    expect(result).toEqual(companyData);
    expect(mockDb.query.companyInfo.findFirst).toHaveBeenCalled();
  });

  it('throws 404 when not configured', async () => {
    mockDb.query.companyInfo.findFirst.mockResolvedValueOnce(undefined);

    await expect(getCompanyInfo()).rejects.toThrow(AppError);
  });
});

describe('upsertCompanyInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates existing record', async () => {
    const existing = { id: 'c1', ...sampleData };
    mockDb.query.companyInfo.findFirst.mockResolvedValueOnce(existing);

    const updated = { id: 'c1', ...sampleData, companyName: 'Novo Nome' };
    const chain = createChain([updated]);
    mockDb.update.mockReturnValueOnce(chain as any);

    const result = await upsertCompanyInfo(sampleData, 'admin-1');

    expect(mockDb.update).toHaveBeenCalled();
    expect(result).toEqual(updated);
  });
});
