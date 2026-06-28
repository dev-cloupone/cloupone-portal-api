import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as importService from '../services/time-entry-import.service';
import { appError } from '../utils/app-error';
import { db } from '../db';
import { projectAllocations } from '../db/schema';
import { eq, and } from 'drizzle-orm';

const MSG = {
  FILE_REQUIRED: { message: 'Arquivo é obrigatório.', code: 'FILE_REQUIRED' },
  INVALID_FORMAT: { message: 'Formato inválido. Use .xlsx ou .csv.', code: 'IMPORT_INVALID_FORMAT' },
  CONSULTANT_REQUIRED: { message: 'Consultor é obrigatório.', code: 'CONSULTANT_REQUIRED' },
  SELF_IMPORT_ONLY: { message: 'Consultor só pode importar para si mesmo.', code: 'IMPORT_SELF_ONLY' },
  NO_PERMISSION: { message: 'Sem permissão.', code: 'IMPORT_NO_PERMISSION' },
  NO_SHARED_PROJECTS: { message: 'Consultor não compartilha projetos com você.', code: 'IMPORT_NO_SHARED_PROJECTS' },
} as const;

const confirmSchema = z.object({
  consultantId: z.string().uuid(),
  rows: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    projectId: z.string().uuid(),
    subphaseId: z.string().uuid(),
    ticketId: z.string().uuid().nullable(),
    description: z.string().max(500).nullable(),
  })).min(1).max(500),
  includeDuplicates: z.boolean(),
});

async function validateGestorPermission(gestorId: string, consultantId: string): Promise<void> {
  // Check if gestor shares at least one project with the consultant
  const gestorProjects = await db.select({ projectId: projectAllocations.projectId })
    .from(projectAllocations)
    .where(eq(projectAllocations.userId, gestorId));

  if (gestorProjects.length === 0) {
    throw appError(MSG.NO_SHARED_PROJECTS, 403);
  }

  const gestorProjectIds = gestorProjects.map(p => p.projectId);

  const consultantProjects = await db.select({ projectId: projectAllocations.projectId })
    .from(projectAllocations)
    .where(eq(projectAllocations.userId, consultantId));

  const commonProject = consultantProjects.some(cp => gestorProjectIds.includes(cp.projectId));
  if (!commonProject) {
    throw appError(MSG.NO_SHARED_PROJECTS, 403);
  }
}

const validate: RequestHandler = async (req, res, next) => {
  try {
    if (!req.file) throw appError(MSG.FILE_REQUIRED, 400);

    const filename = req.file.originalname;
    const ext = filename.split('.').pop()?.toLowerCase();
    if (!ext || !['xlsx', 'csv'].includes(ext)) {
      throw appError(MSG.INVALID_FORMAT, 400);
    }

    // consultantId: from body (admin/gestor) or from token (consultor)
    let consultantId = req.body.consultantId;
    if (req.userRole === 'consultor') {
      consultantId = req.userId;
    }
    if (!consultantId) {
      throw appError(MSG.CONSULTANT_REQUIRED, 400);
    }

    // Permission checks
    if (req.userRole === 'consultor' && consultantId !== req.userId) {
      throw appError(MSG.SELF_IMPORT_ONLY, 403);
    }
    if (req.userRole === 'client') {
      throw appError(MSG.NO_PERMISSION, 403);
    }
    if (req.userRole === 'gestor') {
      await validateGestorPermission(req.userId!, consultantId);
    }

    const rows = importService.parseFile(req.file.buffer, filename);
    const result = await importService.validateImport(
      rows,
      consultantId,
      req.userId!,
      req.userRole!,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const confirm: RequestHandler = async (req, res, next) => {
  try {
    const data = confirmSchema.parse(req.body);

    if (req.userRole === 'consultor' && data.consultantId !== req.userId) {
      throw appError(MSG.SELF_IMPORT_ONLY, 403);
    }
    if (req.userRole === 'client') {
      throw appError(MSG.NO_PERMISSION, 403);
    }
    if (req.userRole === 'gestor') {
      await validateGestorPermission(req.userId!, data.consultantId);
    }

    const result = await importService.confirmImport(
      data,
      req.userId!,
      req.userRole!,
      'import',
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const timeEntryImportController = { validate, confirm };
