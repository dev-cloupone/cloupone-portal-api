import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as userService from '../services/user.service';
import * as loginHistoryService from '../services/login-history.service';
import { paginationSchema } from '../utils/pagination';
import { V } from '../utils/validation-messages';

const idSchema = z.string().uuid();

const createUserSchema = z.object({
  email: z.string().email(V.emailInvalid),
  name: z.string().min(1, V.required('Nome')).max(200, V.max('Nome', 200)),
  password: z.string().min(8, V.min('Senha', 8)),
  role: z.enum(['super_admin', 'gestor', 'consultor', 'client'], { message: V.enumInvalidFem('Função') }),
  clientId: z.string().uuid(V.uuidInvalid('Cliente')).nullable().optional(),
}).refine(
  (data) => data.role !== 'client' || (data.clientId != null && data.clientId !== ''),
  { message: 'Cliente é obrigatório para a função Cliente.', path: ['clientId'] },
);

const updateUserSchema = z.object({
  name: z.string().min(1, V.required('Nome')).max(200, V.max('Nome', 200)).optional(),
  email: z.string().email(V.emailInvalid).optional(),
  role: z.enum(['super_admin', 'gestor', 'consultor', 'client'], { message: V.enumInvalidFem('Função') }).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8, V.min('Senha', 8)).optional(),
  clientId: z.string().uuid(V.uuidInvalid('Cliente')).nullable().optional(),
}).refine(
  (data) => data.role !== 'client' || (data.clientId != null && data.clientId !== ''),
  { message: 'Cliente é obrigatório para a função Cliente.', path: ['clientId'] },
);

const listFiltersSchema = z.object({
  role: z.enum(['super_admin', 'gestor', 'consultor', 'client']).optional(),
  clientId: z.string().uuid().optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

const list: RequestHandler = async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const filters = listFiltersSchema.parse(req.query);
    const result = await userService.listUsers({ page, limit }, {
      role: filters.role,
      clientId: filters.clientId,
      isActive: filters.isActive,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const create: RequestHandler = async (req, res, next) => {
  try {
    const data = createUserSchema.parse(req.body);
    const user = await userService.createUser(data);
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
};

const update: RequestHandler = async (req, res, next) => {
  try {
    const data = updateUserSchema.parse(req.body);
    const user = await userService.updateUser(
      idSchema.parse(req.params.id),
      data,
    );
    res.json(user);
  } catch (err) {
    next(err);
  }
};

const deactivate: RequestHandler = async (req, res, next) => {
  try {
    const user = await userService.deactivateUser(
      idSchema.parse(req.params.id),
      req.userId!,
    );
    res.json(user);
  } catch (err) {
    next(err);
  }
};

const dashboard: RequestHandler = async (_req, res, next) => {
  try {
    const data = await userService.getDashboard();
    res.json(data);
  } catch (err) {
    next(err);
  }
};

const getLoginHistory: RequestHandler = async (req, res, next) => {
  try {
    const userId = idSchema.parse(req.params.id);
    const entries = await loginHistoryService.getByUserId(userId, 50);
    res.json({ data: entries });
  } catch (err) {
    next(err);
  }
};

export const usersController = { list, create, update, deactivate, dashboard, getLoginHistory };
