import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as companyInfoService from '../services/company-info.service';

const upsertSchema = z.object({
  companyName: z.string().min(2).max(255),
  cnpj: z.string().min(11).max(20),
  address: z.string().min(2).max(500),
  zipCode: z.string().min(5).max(15),
  cityState: z.string().min(2).max(255),
  phone: z.string().max(20).optional().or(z.literal('')),
  email: z.string().email().max(255).optional().or(z.literal('')),
});

const get: RequestHandler = async (_req, res, next) => {
  try {
    const data = await companyInfoService.getCompanyInfo();
    res.json(data);
  } catch (err) {
    next(err);
  }
};

const upsert: RequestHandler = async (req, res, next) => {
  try {
    const data = upsertSchema.parse(req.body);
    const result = await companyInfoService.upsertCompanyInfo(
      { ...data, phone: data.phone || undefined, email: data.email || undefined },
      req.userId!,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const companyInfoController = { get, upsert };
