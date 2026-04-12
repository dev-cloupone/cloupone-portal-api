import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { timeEntryController } from '../controllers/time-entry.controller';

const router = Router();

router.use(auth, authenticatedRateLimit);

// Consultor endpoints (any authenticated user with entries)
router.get('/month', timeEntryController.getMonthEntries);
router.get('/week', timeEntryController.getWeekEntries);
router.post('/', timeEntryController.upsert);
router.delete('/:id', timeEntryController.remove);

// General listing (for reports)
router.get('/', authorize('super_admin'), timeEntryController.list);

export { router as timeEntryRoutes };
