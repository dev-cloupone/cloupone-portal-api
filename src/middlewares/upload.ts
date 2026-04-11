import multer from 'multer';
import multerS3 from 'multer-s3';
import crypto from 'crypto';
import path from 'path';
import { getS3Client, isR2Configured } from '../config/s3';
import { env } from '../config/env';
import { isValidUploadType } from '../constants/upload-types';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB fallback max

function buildStorage(): multer.StorageEngine {
  if (isR2Configured()) {
    const s3 = getS3Client()!;
    return multerS3({
      s3,
      bucket: env.R2_BUCKET_NAME!,
      key: (req, file, cb) => {
        const type = (req as unknown as { params?: { type?: string } }).params?.type;
        if (!type || !isValidUploadType(type)) {
          cb(new Error(`Tipo de upload inválido: ${type}`));
          return;
        }
        const id = crypto.randomUUID();
        cb(null, `uploads/${type}/${id}/${file.originalname}`);
      },
      contentType: multerS3.AUTO_CONTENT_TYPE,
    });
  }

  // Fallback: disk storage for local dev
  return multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, '/tmp');
    },
    filename: (_req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    },
  });
}

export const upload = multer({
  storage: buildStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
});
