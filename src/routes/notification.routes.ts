import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { notificationController } from '../controllers/notification.controller';

const router = Router();

router.use(auth, authenticatedRateLimit);

// Manual triggers — super_admin only
router.post('/daily-reminders', authorize('super_admin'), notificationController.sendDailyReminders);
router.post('/monthly-reminders', authorize('super_admin'), notificationController.sendMonthlyReminders);

export { router as notificationRoutes };
