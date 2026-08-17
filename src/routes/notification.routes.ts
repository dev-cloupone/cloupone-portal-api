import { Router } from 'express';
import { auth, sseAuth } from '../middlewares/auth';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { notificationController as ctrl } from '../controllers/notification.controller';

const router = Router();

router.get('/', auth, authenticatedRateLimit, ctrl.list);
router.get('/unread-count', auth, authenticatedRateLimit, ctrl.getUnreadCount);
router.get('/stream', sseAuth, ctrl.stream);
router.patch('/:id/read', auth, authenticatedRateLimit, ctrl.markAsRead);
router.patch('/read-all', auth, authenticatedRateLimit, ctrl.markAllAsRead);

export { router as notificationRoutes };
