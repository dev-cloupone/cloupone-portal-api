import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { monthlyTimesheetController } from '../controllers/monthly-timesheet.controller';

const router = Router();

router.use(auth, authenticatedRateLimit);

// Consultor (próprio)
router.get('/pending', monthlyTimesheetController.getPending);

// Admin
router.get('/', authorize('super_admin'), monthlyTimesheetController.list);
router.get('/:userId/:year/:month', monthlyTimesheetController.getDetail);

// Aprovação (consultor próprio + admin)
router.post('/:userId/:year/:month/approve', monthlyTimesheetController.approve);

// Reabertura (admin)
router.post('/:userId/:year/:month/reopen', authorize('super_admin'), monthlyTimesheetController.reopen);

// Escalonamento (admin — chamado por scheduler externo)
router.post('/escalate', authorize('super_admin'), monthlyTimesheetController.escalate);

export { router as monthlyTimesheetRoutes };
