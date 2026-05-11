import { eq } from 'drizzle-orm';
import { db } from '../db';
import { companyInfo } from '../db/schema';
import { AppError } from '../utils/app-error';

export async function getCompanyInfo() {
  const result = await db.query.companyInfo.findFirst();
  if (!result) {
    throw new AppError('Dados da empresa nao configurados. Acesse Configuracoes > Dados da Empresa.', 404);
  }
  return result;
}

export async function upsertCompanyInfo(data: {
  companyName: string;
  cnpj: string;
  address: string;
  zipCode: string;
  cityState: string;
  phone?: string;
  email?: string;
}, userId: string) {
  const existing = await db.query.companyInfo.findFirst();

  if (existing) {
    const [updated] = await db.update(companyInfo)
      .set({ ...data, updatedAt: new Date(), updatedBy: userId })
      .where(eq(companyInfo.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db.insert(companyInfo)
    .values({ ...data, updatedBy: userId })
    .returning();
  return created;
}
