import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { dashboardController } from '../controllers/dashboard.controller';

const router = Router();

router.use(auth, authenticatedRateLimit);

router.get('/manager', authorize('super_admin', 'gestor'), dashboardController.manager);
router.get('/consultant', authorize('super_admin', 'gestor', 'consultor'), dashboardController.consultant);

export { router as dashboardRoutes };
