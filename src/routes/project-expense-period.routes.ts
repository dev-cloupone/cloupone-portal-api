import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { projectExpensePeriodController } from '../controllers/project-expense-period.controller';

const router = Router({ mergeParams: true });

router.get('/:projectId/expense-periods', auth, authenticatedRateLimit, projectExpensePeriodController.list);
router.post('/:projectId/expense-periods', auth, authorize('super_admin', 'gestor'), authenticatedRateLimit, projectExpensePeriodController.openPeriod);
router.post('/:projectId/expense-periods/:id/close', auth, authorize('super_admin', 'gestor'), authenticatedRateLimit, projectExpensePeriodController.closePeriod);
router.post('/:projectId/expense-periods/:id/reopen', auth, authorize('super_admin', 'gestor'), authenticatedRateLimit, projectExpensePeriodController.reopenPeriod);

export { router as projectExpensePeriodRoutes };
