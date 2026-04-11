import type { RequestHandler } from 'express';
import * as fileService from '../services/file.service';
import { AppError } from '../utils/app-error';
import { isValidUploadType } from '../constants/upload-types';

const uploadFile: RequestHandler<{ type: string }> = async (req, res, next) => {
  try {
    if (!isValidUploadType(req.params.type)) {
      throw new AppError('Tipo de upload inválido.', 400);
    }
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

const download: RequestHandler<{ id: string }> = async (req, res, next) => {
  try {
    const url = await fileService.getPresignedUrl(req.params.id);
    res.redirect(url);
  } catch (err) {
    next(err);
  }
};

export const uploadsController = { upload: uploadFile, download };
