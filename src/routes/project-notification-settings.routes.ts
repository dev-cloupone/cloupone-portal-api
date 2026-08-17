import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { projectNotificationSettingsController as ctrl } from '../controllers/project-notification-settings.controller';

const router = Router({ mergeParams: true });

router.get('/notification-settings', auth, authorize('super_admin'), authenticatedRateLimit, ctrl.getSettings);
router.put('/notification-settings', auth, authorize('super_admin'), authenticatedRateLimit, ctrl.upsertSettings);
router.get('/notification-emails', auth, authorize('super_admin'), authenticatedRateLimit, ctrl.getEmails);
router.post('/notification-emails', auth, authorize('super_admin'), authenticatedRateLimit, ctrl.addEmail);
router.delete('/notification-emails/:id', auth, authorize('super_admin'), authenticatedRateLimit, ctrl.removeEmail);

export { router as projectNotificationSettingsRoutes };
