import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { consultantController } from '../controllers/consultant.controller';

const router = Router();

// Consultant can list their own allocated projects
router.get('/:userId/projects', auth, authenticatedRateLimit, consultantController.listProjects);

// All other routes require admin/gestor
router.use(auth, authorize('super_admin', 'gestor'), authenticatedRateLimit);

router.get('/', consultantController.list);
router.get('/:userId', consultantController.getByUserId);
router.post('/', consultantController.create);
router.patch('/:userId', consultantController.update);

export { router as consultantRoutes };
