/**
 * Auto enum migration utility.
 *
 * Postgres does not allow ALTER TYPE ... ADD VALUE inside a transaction,
 * and Drizzle Kit wraps migrations in transactions. This utility scans all
 * migration SQL files for ALTER TYPE ... ADD VALUE statements and executes
 * them outside a transaction before Drizzle's migrate() runs.
 *
 * Safe to run every time — uses IF NOT EXISTS (idempotent).
 *
 * Migration SQL files that contain ALTER TYPE ... ADD VALUE should replace
 * those statements with SELECT 1 (or wrap in DO $$ BEGIN ... EXCEPTION blocks)
 * so Drizzle's transactional migrator doesn't fail.
 */

import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { logger } from '../utils/logger';

const ALTER_ENUM_REGEX = /ALTER\s+TYPE\s+"?(\w+)"?\s*\.\s*"?(\w+)"?\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'/gi;
const ALTER_ENUM_NO_SCHEMA_REGEX = /ALTER\s+TYPE\s+"?(\w+)"?\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'/gi;

interface EnumAddValue {
  schema: string;
  typeName: string;
  value: string;
}

function extractEnumAddValues(sql: string): EnumAddValue[] {
  const results: EnumAddValue[] = [];

  // Match with schema: ALTER TYPE "public"."enum_name" ADD VALUE 'value'
  for (const match of sql.matchAll(ALTER_ENUM_REGEX)) {
    results.push({ schema: match[1], typeName: match[2], value: match[3] });
  }

  // Match without schema: ALTER TYPE "enum_name" ADD VALUE 'value'
  // Only add if not already captured by the schema regex
  for (const match of sql.matchAll(ALTER_ENUM_NO_SCHEMA_REGEX)) {
    const typeName = match[1];
    const value = match[2];
    // Skip if this looks like a schema name we already captured (e.g., "public")
    if (!results.some((r) => r.typeName === typeName && r.value === value)) {
      results.push({ schema: 'public', typeName, value });
    }
  }

  return results;
}

export async function migrateEnums(migrationsFolder: string, databaseUrl: string): Promise<void> {
  const sqlFiles = fs.readdirSync(migrationsFolder)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const allEnumValues: EnumAddValue[] = [];

  for (const file of sqlFiles) {
    const sql = fs.readFileSync(path.join(migrationsFolder, file), 'utf-8');
    const values = extractEnumAddValues(sql);
    allEnumValues.push(...values);
  }

  if (allEnumValues.length === 0) {
    return;
  }

  // Deduplicate
  const unique = allEnumValues.filter(
    (v, i, arr) => arr.findIndex((u) => u.schema === v.schema && u.typeName === v.typeName && u.value === v.value) === i,
  );

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    for (const { schema, typeName, value } of unique) {
      const query = `ALTER TYPE "${schema}"."${typeName}" ADD VALUE IF NOT EXISTS '${value}'`;
      try {
        await pool.query(query);
      } catch (err: unknown) {
        // Type doesn't exist yet — will be created by the migration
        const pgErr = err as { code?: string };
        if (pgErr.code === '42704') {
          // 42704 = undefined_object (type doesn't exist)
          continue;
        }
        throw err;
      }
    }
    logger.info(`Enum pre-migration: ${unique.length} value(s) ensured`);
  } finally {
    await pool.end();
  }
}
