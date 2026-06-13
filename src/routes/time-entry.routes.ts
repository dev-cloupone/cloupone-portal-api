import { Router } from 'express';
import multer from 'multer';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { timeEntryController } from '../controllers/time-entry.controller';
import { timeEntryImportController } from '../controllers/time-entry-import.controller';

const router = Router();

router.use(auth, authenticatedRateLimit);

// Import routes (before parameterized routes)
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
}).single('file');

router.post('/import/validate', memoryUpload, timeEntryImportController.validate);
router.post('/import/confirm', timeEntryImportController.confirm);

// Consultor endpoints (any authenticated user with entries)
router.get('/month', timeEntryController.getMonthEntries);
router.get('/week', timeEntryController.getWeekEntries);
router.get('/list', timeEntryController.listView);
router.post('/', timeEntryController.upsert);
router.delete('/:id', timeEntryController.remove);

// General listing (for reports)
router.get('/', authorize('super_admin'), timeEntryController.list);

export { router as timeEntryRoutes };
