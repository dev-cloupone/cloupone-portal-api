import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { consultantRateController } from '../controllers/consultant-rate.controller';

const router = Router();

router.get('/:id/consultant-rates', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, consultantRateController.list);
router.put('/:id/consultant-rates/:userId', auth, authorize('super_admin'), authenticatedRateLimit, consultantRateController.upsert);

export { router as consultantRateRoutes };
