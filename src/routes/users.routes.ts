import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { usersController } from '../controllers/users.controller';

const router = Router();

router.use(auth, authenticatedRateLimit);

router.get('/dashboard', authorize('super_admin'), usersController.dashboard);
router.get('/', authorize('super_admin', 'administrative'), usersController.list);
router.post('/', authorize('super_admin'), usersController.create);
router.patch('/:id', authorize('super_admin'), usersController.update);
router.delete('/:id', authorize('super_admin'), usersController.deactivate);
router.get('/:id/login-history', authorize('super_admin'), usersController.getLoginHistory);

export { router as usersRoutes };
