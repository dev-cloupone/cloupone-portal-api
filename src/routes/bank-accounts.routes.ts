import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { bankAccountsController } from '../controllers/bank-accounts.controller';

const router = Router();

// Admin routes (super_admin only)
const adminRouter = Router();
adminRouter.use(auth, authorize('super_admin'), authenticatedRateLimit);
adminRouter.get('/', bankAccountsController.list);
adminRouter.post('/', bankAccountsController.create);
adminRouter.put('/:id', bankAccountsController.update);
adminRouter.delete('/:id', bankAccountsController.toggleActive);

// Public route (super_admin + gestor) — only active accounts (id + label)
const publicRouter = Router();
publicRouter.use(auth, authorize('super_admin', 'gestor'), authenticatedRateLimit);
publicRouter.get('/active', bankAccountsController.listActive);

export { adminRouter as bankAccountsAdminRoutes, publicRouter as bankAccountsPublicRoutes };
