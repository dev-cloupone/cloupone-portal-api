import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { expenseCategoryController } from '../controllers/expense-category.controller';

const router = Router();

router.get('/', auth, authenticatedRateLimit, expenseCategoryController.list);
router.get('/:id', auth, authenticatedRateLimit, expenseCategoryController.getById);
router.post('/', auth, authorize('super_admin', 'gestor'), authenticatedRateLimit, expenseCategoryController.create);
router.put('/:id', auth, authorize('super_admin', 'gestor'), authenticatedRateLimit, expenseCategoryController.update);
router.delete('/:id', auth, authorize('super_admin', 'gestor'), authenticatedRateLimit, expenseCategoryController.deactivate);

export { router as expenseCategoryRoutes };
