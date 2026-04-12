import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { clientController } from '../controllers/client.controller';

const router = Router();

router.use(auth, authenticatedRateLimit);

router.get('/', authorize('super_admin', 'gestor'), clientController.list);
router.get('/:id', authorize('super_admin', 'gestor'), clientController.getById);
router.post('/', authorize('super_admin'), clientController.create);
router.patch('/:id', authorize('super_admin'), clientController.update);
router.delete('/:id', authorize('super_admin'), clientController.deactivate);

export { router as clientRoutes };
