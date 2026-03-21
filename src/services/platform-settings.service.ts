import { eq } from 'drizzle-orm';
import { db } from '../db';
import { platformSettings } from '../db/schema/platform-settings';

const PUBLIC_SETTING_KEYS = ['app_name', 'allow_self_registration'];

export async function getAllSettings() {
  return db.select().from(platformSettings).orderBy(platformSettings.key);
}

export async function getSettingsMap(): Promise<Record<string, string>> {
  const rows = await getAllSettings();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function getPublicSettings(): Promise<Record<string, string>> {
  const allSettings = await getSettingsMap();
  const result: Record<string, string> = {};
  for (const key of PUBLIC_SETTING_KEYS) {
    if (key in allSettings) {
      result[key] = allSettings[key];
    }
  }
  return result;
}

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, key))
    .limit(1);
  return row[0]?.value ?? null;
}

export async function upsertSettings(
  entries: { key: string; value: string }[],
  updatedBy: string,
) {
  for (const entry of entries) {
    await db
      .insert(platformSettings)
      .values({ key: entry.key, value: entry.value, updatedBy, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: entry.value, updatedBy, updatedAt: new Date() },
      });
  }
  return getAllSettings();
}
