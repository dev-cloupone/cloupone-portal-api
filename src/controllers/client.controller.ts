import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as clientService from '../services/client.service';
import { paginationSchema } from '../utils/pagination';
import { V } from '../utils/validation-messages';

const idSchema = z.string().uuid();

const createClientSchema = z.object({
  companyName: z.string().min(2, V.min('Razão Social', 2)).max(255, V.max('Razão Social', 255)),
  cnpj: z.string().max(18, V.max('CNPJ', 18)).optional(),
  contactName: z.string().max(200, V.max('Nome do Contato', 200)).optional(),
  contactEmail: z.string().email(V.emailInvalid).optional(),
  contactPhone: z.string().max(20, V.max('Telefone', 20)).optional(),
  notes: z.string().optional(),
});

const updateClientSchema = createClientSchema.partial();

const list: RequestHandler = async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const search = req.query.search as string | undefined;
    const result = await clientService.listClients({ page, limit, search });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const getById: RequestHandler = async (req, res, next) => {
  try {
    const client = await clientService.getClientById(idSchema.parse(req.params.id));
    res.json(client);
  } catch (err) {
    next(err);
  }
};

const create: RequestHandler = async (req, res, next) => {
  try {
    const data = createClientSchema.parse(req.body);
    const client = await clientService.createClient(data);
    res.status(201).json(client);
  } catch (err) {
    next(err);
  }
};

const update: RequestHandler = async (req, res, next) => {
  try {
    const data = updateClientSchema.parse(req.body);
    const client = await clientService.updateClient(idSchema.parse(req.params.id), data);
    res.json(client);
  } catch (err) {
    next(err);
  }
};

const deactivate: RequestHandler = async (req, res, next) => {
  try {
    const client = await clientService.deactivateClient(idSchema.parse(req.params.id));
    res.json(client);
  } catch (err) {
    next(err);
  }
};

export const clientController = { list, getById, create, update, deactivate };
