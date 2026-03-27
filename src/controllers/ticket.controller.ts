import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as ticketService from '../services/ticket.service';
import { paginationSchema } from '../utils/pagination';
import { V } from '../utils/validation-messages';
import { getUserClientId } from '../services/user.service';

const idSchema = z.string().uuid();

const createTicketSchema = z.object({
  projectId: z.string().uuid(V.uuidInvalid('Projeto')),
  type: z.enum(['bug', 'improvement', 'initiative'], { message: V.enumInvalid('Tipo') }),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  title: z.string().min(3, V.min('Titulo', 3)).max(255, V.max('Titulo', 255)),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  isVisibleToClient: z.boolean().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, V.dateInvalid).nullable().optional(),
  estimatedHours: z.number().positive().nullable().optional(),
});

const updateTicketSchema = z.object({
  status: z.enum(['open', 'in_analysis', 'in_progress', 'in_review', 'resolved', 'closed', 'reopened', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  isVisibleToClient: z.boolean().optional(),
  title: z.string().min(3).max(255).optional(),
  description: z.string().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  estimatedHours: z.number().positive().nullable().optional(),
});

const listTicketsSchema = z.object({
  projectId: z.string().uuid().optional(),
  status: z.string().optional(),
  type: z.enum(['bug', 'improvement', 'initiative']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  assignedTo: z.string().uuid().optional(),
  createdBy: z.string().uuid().optional(),
  search: z.string().optional(),
  sort: z.enum(['created_at', 'updated_at', 'priority', 'status']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
}).merge(paginationSchema);

const createCommentSchema = z.object({
  content: z.string().min(1, V.required('Conteudo')).max(10000),
  isInternal: z.boolean().optional(),
});

const create: RequestHandler = async (req, res, next) => {
  try {
    const data = createTicketSchema.parse(req.body);
    const userClientId = await getUserClientId(req.userId!, req.userRole!);
    const ticket = await ticketService.createTicket({
      ...data,
      createdBy: req.userId!,
      createdByRole: req.userRole!,
      createdByClientId: userClientId,
    });
    res.status(201).json(ticket);
  } catch (err) {
    next(err);
  }
};

const list: RequestHandler = async (req, res, next) => {
  try {
    const params = listTicketsSchema.parse(req.query);
    const userClientId = await getUserClientId(req.userId!, req.userRole!);
    const result = await ticketService.listTickets({
      ...params,
      userId: req.userId!,
      userRole: req.userRole!,
      userClientId,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const getById: RequestHandler = async (req, res, next) => {
  try {
    const userClientId = await getUserClientId(req.userId!, req.userRole!);
    const ticket = await ticketService.getTicketById(
      idSchema.parse(req.params.id),
      req.userId!,
      req.userRole!,
      userClientId,
    );
    res.json(ticket);
  } catch (err) {
    next(err);
  }
};

const update: RequestHandler = async (req, res, next) => {
  try {
    const data = updateTicketSchema.parse(req.body);
    const userClientId = await getUserClientId(req.userId!, req.userRole!);
    const ticket = await ticketService.updateTicket(
      idSchema.parse(req.params.id),
      req.userId!,
      req.userRole!,
      userClientId,
      data,
    );
    res.json(ticket);
  } catch (err) {
    next(err);
  }
};

const getStats: RequestHandler = async (req, res, next) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    const userClientId = await getUserClientId(req.userId!, req.userRole!);
    const stats = await ticketService.getTicketStats({
      userId: req.userId!,
      userRole: req.userRole!,
      userClientId,
      projectId,
    });
    res.json(stats);
  } catch (err) {
    next(err);
  }
};

// --- Comments ---

const addComment: RequestHandler = async (req, res, next) => {
  try {
    const data = createCommentSchema.parse(req.body);
    const userClientId = await getUserClientId(req.userId!, req.userRole!);
    const comment = await ticketService.addComment({
      ticketId: idSchema.parse(req.params.id),
      userId: req.userId!,
      userRole: req.userRole!,
      userClientId,
      ...data,
    });
    res.status(201).json(comment);
  } catch (err) {
    next(err);
  }
};

const listComments: RequestHandler = async (req, res, next) => {
  try {
    const userClientId = await getUserClientId(req.userId!, req.userRole!);
    const comments = await ticketService.listComments(
      idSchema.parse(req.params.id),
      req.userId!,
      req.userRole!,
      userClientId,
    );
    res.json(comments);
  } catch (err) {
    next(err);
  }
};

// --- History ---

const listHistory: RequestHandler = async (req, res, next) => {
  try {
    const userClientId = await getUserClientId(req.userId!, req.userRole!);
    const history = await ticketService.listHistory(
      idSchema.parse(req.params.id),
      req.userId!,
      req.userRole!,
      userClientId,
    );
    res.json(history);
  } catch (err) {
    next(err);
  }
};

// --- Attachments ---

const addAttachment: RequestHandler = async (req, res, next) => {
  try {
    const ticketId = idSchema.parse(req.params.id);
    const fileId = req.body.fileId as string;
    if (!fileId) {
      res.status(400).json({ error: 'fileId é obrigatório.' });
      return;
    }
    const userClientId = await getUserClientId(req.userId!, req.userRole!);
    const attachment = await ticketService.addAttachment({
      ticketId,
      fileId,
      uploadedBy: req.userId!,
      userRole: req.userRole!,
      userClientId,
    });
    res.status(201).json(attachment);
  } catch (err) {
    next(err);
  }
};

const listAttachments: RequestHandler = async (req, res, next) => {
  try {
    const ticketId = idSchema.parse(req.params.id);
    const attachments = await ticketService.listAttachments(ticketId);
    res.json(attachments);
  } catch (err) {
    next(err);
  }
};

const removeAttachment: RequestHandler = async (req, res, next) => {
  try {
    const ticketId = idSchema.parse(req.params.id);
    const attachmentId = idSchema.parse(req.params.attachmentId);
    await ticketService.removeAttachment(ticketId, attachmentId, req.userId!, req.userRole!);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

// --- Time Entries ---

const listTimeEntries: RequestHandler = async (req, res, next) => {
  try {
    const userClientId = await getUserClientId(req.userId!, req.userRole!);
    const entries = await ticketService.listTicketTimeEntries(
      idSchema.parse(req.params.id),
      req.userId!,
      req.userRole!,
      userClientId,
    );
    res.json(entries);
  } catch (err) {
    next(err);
  }
};

export const ticketController = {
  create,
  list,
  getById,
  update,
  getStats,
  addComment,
  listComments,
  listHistory,
  addAttachment,
  listAttachments,
  removeAttachment,
  listTimeEntries,
};
