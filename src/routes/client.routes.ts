import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { clientController } from '../controllers/client.controller';

const router = Router();

router.use(auth, authorize('super_admin'), authenticatedRateLimit);

router.get('/', clientController.list);
router.get('/:id', clientController.getById);
router.post('/', clientController.create);
router.patch('/:id', clientController.update);
router.delete('/:id', clientController.deactivate);

export { router as clientRoutes };
