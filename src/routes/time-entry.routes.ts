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
router.post('/submit-week', timeEntryController.submitWeek);
router.post('/:id/resubmit', timeEntryController.resubmit);
router.delete('/:id', timeEntryController.remove);

// Gestor/Admin endpoints
router.get('/pending', authorize('super_admin', 'gestor'), timeEntryController.listPending);
router.post('/approve', authorize('super_admin', 'gestor'), timeEntryController.approve);
router.post('/:id/reject', authorize('super_admin', 'gestor'), timeEntryController.reject);

// General listing (for reports)
router.get('/', authorize('super_admin', 'gestor'), timeEntryController.list);

export { router as timeEntryRoutes };
