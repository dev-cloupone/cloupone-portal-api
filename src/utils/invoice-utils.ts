import { sql } from 'drizzle-orm';
import { db } from '../db';

/** Reusable Drizzle transaction context type */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Get next sequential invoice number from shared sequence (used by both hours and expense invoices) */
export async function getNextInvoiceNumber(tx: DbTransaction): Promise<number> {
  const result = await tx.execute(sql`SELECT nextval('invoice_number_seq') as nextval`);
  const rows = result as unknown as { nextval: string }[];
  return Number(rows[0].nextval);
}
