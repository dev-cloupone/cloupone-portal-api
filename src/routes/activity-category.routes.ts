import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { activityCategoryController } from '../controllers/activity-category.controller';

const router = Router();

// GET is accessible by any authenticated user (consultors need to see categories)
router.get('/', auth, authenticatedRateLimit, activityCategoryController.list);

// CUD operations are super_admin only
router.post('/', auth, authorize('super_admin'), authenticatedRateLimit, activityCategoryController.create);
router.patch('/:id', auth, authorize('super_admin'), authenticatedRateLimit, activityCategoryController.update);
router.delete('/:id', auth, authorize('super_admin'), authenticatedRateLimit, activityCategoryController.deactivate);

export { router as activityCategoryRoutes };
