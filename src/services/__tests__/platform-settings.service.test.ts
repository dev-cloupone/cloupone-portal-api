import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createChain } from '../../__test-utils__/drizzle-chain';

// --- Mock db (hoisted) ---
const { mockDb } = vi.hoisted(() => {
  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
  };
  return { mockDb };
});

vi.mock('../../db', () => ({ db: mockDb }));
vi.mock('../../db/schema/platform-settings', () => ({
  platformSettings: { key: 'key', value: 'value', updatedBy: 'updatedBy', updatedAt: 'updatedAt' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
}));

import { getSettingsMap, getPublicSettings, upsertSettings } from '../platform-settings.service';

describe('getSettingsMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('converts settings array to key-value object', async () => {
    const rows = [
      { key: 'app_name', value: 'Cloupone' },
      { key: 'allow_self_registration', value: 'true' },
      { key: 'smtp_host', value: 'smtp.example.com' },
    ];
    const chain = createChain(rows);
    mockDb.select.mockReturnValueOnce(chain as any);

    const result = await getSettingsMap();

    expect(result).toEqual({
      app_name: 'Cloupone',
      allow_self_registration: 'true',
      smtp_host: 'smtp.example.com',
    });
  });
});

describe('getPublicSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns only public settings', async () => {
    const rows = [
      { key: 'allow_self_registration', value: 'false' },
      { key: 'app_name', value: 'Cloupone' },
      { key: 'smtp_host', value: 'smtp.example.com' },
    ];
    const chain = createChain(rows);
    mockDb.select.mockReturnValueOnce(chain as any);

    const result = await getPublicSettings();

    expect(result).toEqual({
      app_name: 'Cloupone',
      allow_self_registration: 'false',
    });
    expect(result).not.toHaveProperty('smtp_host');
  });
});

describe('upsertSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('performs batch upsert', async () => {
    const entries = [
      { key: 'app_name', value: 'NewName' },
      { key: 'smtp_host', value: 'new.smtp.com' },
    ];

    const upsertChain = createChain([]);
    mockDb.insert.mockReturnValue(upsertChain as any);

    // getAllSettings called at the end
    const allSettingsChain = createChain([
      { key: 'app_name', value: 'NewName' },
      { key: 'smtp_host', value: 'new.smtp.com' },
    ]);
    mockDb.select.mockReturnValueOnce(allSettingsChain as any);

    const result = await upsertSettings(entries, 'admin-1');

    expect(mockDb.insert).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
  });
});
