import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { projectTimesheetLockController } from '../controllers/project-timesheet-lock.controller';

const router = Router({ mergeParams: true });

router.get('/:projectId/timesheet-lock', auth, authorize('super_admin'), authenticatedRateLimit, projectTimesheetLockController.getConfig);
router.patch('/:projectId/timesheet-lock', auth, authorize('super_admin'), authenticatedRateLimit, projectTimesheetLockController.setLockDays);

export { router as projectTimesheetLockRoutes };
