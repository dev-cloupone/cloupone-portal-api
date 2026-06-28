import type { RequestHandler } from 'express';
import * as fileService from '../services/file.service';
import { appError } from '../utils/app-error';
import { isValidUploadType } from '../constants/upload-types';

const MSG = {
  INVALID_UPLOAD_TYPE: { message: 'Tipo de upload inválido.', code: 'INVALID_UPLOAD_TYPE' },
  NO_FILE: { message: 'Nenhum arquivo enviado.', code: 'NO_FILE_UPLOADED' },
} as const;

const uploadFile: RequestHandler<{ type: string }> = async (req, res, next) => {
  try {
    if (!isValidUploadType(req.params.type)) {
      throw appError(MSG.INVALID_UPLOAD_TYPE, 400);
    }
    if (!req.file) {
      throw appError(MSG.NO_FILE, 400);
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
