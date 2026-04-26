import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { projectExpenseCategoryController } from '../controllers/project-expense-category.controller';

const router = Router({ mergeParams: true });

router.get('/:projectId/expense-categories', auth, authenticatedRateLimit, projectExpenseCategoryController.list);
router.post('/:projectId/expense-categories', auth, authorize('super_admin', 'gestor'), authenticatedRateLimit, projectExpenseCategoryController.importFromTemplate);
router.put('/:projectId/expense-categories/:id', auth, authorize('super_admin', 'gestor'), authenticatedRateLimit, projectExpenseCategoryController.update);
router.delete('/:projectId/expense-categories/:id', auth, authorize('super_admin', 'gestor'), authenticatedRateLimit, projectExpenseCategoryController.deactivate);

export { router as projectExpenseCategoryRoutes };
