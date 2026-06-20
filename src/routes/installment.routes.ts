import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { installmentController } from '../controllers/installment.controller';

const router = Router({ mergeParams: true });

router.get('/', auth, authorize('super_admin'), authenticatedRateLimit, installmentController.list);
router.post('/', auth, authorize('super_admin'), authenticatedRateLimit, installmentController.create);
router.post('/batch', auth, authorize('super_admin'), authenticatedRateLimit, installmentController.createBatch);
router.patch('/:id', auth, authorize('super_admin'), authenticatedRateLimit, installmentController.update);
router.delete('/:id', auth, authorize('super_admin'), authenticatedRateLimit, installmentController.remove);

export { router as installmentRoutes };
