import type { RequestHandler } from 'express';
import * as fileService from '../services/file.service';
import { AppError } from '../utils/app-error';

const uploadFile: RequestHandler = async (req, res, next) => {
  try {
    if (!req.file) {
      throw new AppError('Nenhum arquivo enviado.', 400);
    }

    const record = await fileService.uploadFile(req.file, req.userId!);

    res.status(201).json({
      id: record.id,
      url: record.url,
      filename: record.filename,
      mimeType: record.mimeType,
      size: record.size,
      createdAt: record.createdAt,
    });
  } catch (err) {
    next(err);
  }
};

export const uploadsController = { upload: uploadFile };
