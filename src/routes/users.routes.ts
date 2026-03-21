import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { usersController } from '../controllers/users.controller';

const router = Router();

router.use(auth, authorize('super_admin'), authenticatedRateLimit);

router.get('/dashboard', usersController.dashboard);
router.get('/', usersController.list);
router.post('/', usersController.create);
router.patch('/:id', usersController.update);
router.delete('/:id', usersController.deactivate);
router.get('/:id/login-history', usersController.getLoginHistory);

export { router as usersRoutes };
