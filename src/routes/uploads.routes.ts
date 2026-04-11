import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { upload } from '../middlewares/upload';
import { uploadsController } from '../controllers/uploads.controller';

const router = Router();

router.post('/:type', auth, authenticatedRateLimit, upload.single('file'), uploadsController.upload);
router.get('/download/:id', uploadsController.download);

export { router as uploadsRoutes };
