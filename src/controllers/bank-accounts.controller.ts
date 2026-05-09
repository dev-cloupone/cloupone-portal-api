import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as bankAccountsService from '../services/bank-accounts.service';

const createSchema = z.object({
  label: z.string().min(2).max(100),
  holderName: z.string().min(2).max(255),
  bankName: z.string().min(2).max(255),
  agency: z.string().min(1).max(20),
  accountNumber: z.string().min(1).max(30),
  accountType: z.enum(['corrente', 'poupanca']),
  pixKey: z.string().max(255).optional().or(z.literal('')),
});

const updateSchema = createSchema.partial();

const list: RequestHandler = async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const data = await bankAccountsService.list(includeInactive);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

const listActive: RequestHandler = async (_req, res, next) => {
  try {
    const data = await bankAccountsService.listActive();
    res.json(data);
  } catch (err) {
    next(err);
  }
};

const create: RequestHandler = async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const result = await bankAccountsService.create(
      { ...data, pixKey: data.pixKey || undefined },
      req.userId!,
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

const update: RequestHandler = async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const data = updateSchema.parse(req.body);
    const result = await bankAccountsService.update(
      id,
      { ...data, pixKey: data.pixKey || undefined },
      req.userId!,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const toggleActive: RequestHandler = async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const result = await bankAccountsService.toggleActive(id, req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const bankAccountsController = { list, listActive, create, update, toggleActive };
