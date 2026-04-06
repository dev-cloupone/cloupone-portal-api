import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { projectController } from '../controllers/project.controller';

const router = Router();

// GET / is accessible to all authenticated users (clients see only their projects)
router.get('/', auth, authenticatedRateLimit, projectController.list);

// Allocations listing accessible to consultors, gestors and super_admins
router.get('/:id/allocations', auth, authorize('consultor', 'gestor', 'super_admin'), authenticatedRateLimit, projectController.listAllocations);

// All other routes require super_admin or gestor
router.use(auth, authorize('super_admin', 'gestor'), authenticatedRateLimit);
router.get('/:id', projectController.getById);
router.post('/', projectController.create);
router.patch('/:id', projectController.update);
router.delete('/:id', projectController.deactivate);
router.post('/:id/allocations', projectController.addAllocation);
router.delete('/:id/allocations/:userId', projectController.removeAllocation);

export { router as projectRoutes };
