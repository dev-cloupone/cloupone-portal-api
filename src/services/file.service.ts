import { eq } from 'drizzle-orm';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { db } from '../db';
import { files } from '../db/schema';
import { getS3Client, isR2Configured } from '../config/s3';
import { getSetting } from './platform-settings.service';
import { AppError } from '../utils/app-error';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export async function uploadFile(
  file: Express.Multer.File,
  userId: string,
) {
  // Validate against platform settings
  const maxSizeMb = parseInt(await getSetting('max_upload_size_mb') || '5', 10);
  const allowedTypes = (await getSetting('allowed_file_types') || 'image/jpeg,image/png,image/webp,application/pdf').split(',');

  if (file.size > maxSizeMb * 1024 * 1024) {
    throw new AppError(`Arquivo excede o tamanho máximo de ${maxSizeMb}MB.`, 400);
  }

  if (!allowedTypes.includes(file.mimetype)) {
    throw new AppError('Tipo de arquivo não permitido.', 400);
  }

  const multerS3File = file as Express.Multer.File & { key?: string; location?: string };

  const storageKey = multerS3File.key || file.filename;
  const url = multerS3File.location || (env.R2_PUBLIC_URL
    ? `${env.R2_PUBLIC_URL}/${storageKey}`
    : `/tmp/${file.filename}`);

  const [record] = await db.insert(files).values({
    userId,
    filename: file.filename || storageKey,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    storageKey,
    url,
  }).returning();

  return record;
}

export async function deleteFile(fileId: string): Promise<void> {
  const record = await getFileById(fileId);
  if (!record) return;

  // Delete from S3/R2
  if (isR2Configured()) {
    try {
      const s3 = getS3Client()!;
      await s3.send(new DeleteObjectCommand({
        Bucket: env.R2_BUCKET_NAME!,
        Key: record.storageKey,
      }));
    } catch (err) {
      logger.error({ err, fileId }, 'Failed to delete file from S3/R2');
    }
  }

  // Delete from DB
  await db.delete(files).where(eq(files.id, fileId));
}

export async function getFileById(fileId: string) {
  return db.query.files.findFirst({
    where: eq(files.id, fileId),
  });
}
