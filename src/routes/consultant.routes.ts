import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { consultantController } from '../controllers/consultant.controller';

const router = Router();

// Consultant can list their own allocated projects
router.get('/:userId/projects', auth, authenticatedRateLimit, consultantController.listProjects);

// Read routes (super_admin + gestor)
router.get('/', auth, authorize('super_admin', 'gestor'), authenticatedRateLimit, consultantController.list);
router.get('/:userId', auth, authorize('super_admin', 'gestor'), authenticatedRateLimit, consultantController.getByUserId);

// Write routes (super_admin only)
router.post('/', auth, authorize('super_admin'), authenticatedRateLimit, consultantController.create);
router.patch('/:userId', auth, authorize('super_admin'), authenticatedRateLimit, consultantController.update);

export { router as consultantRoutes };
