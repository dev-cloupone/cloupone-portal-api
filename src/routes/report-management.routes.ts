import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { reportManagementController } from '../controllers/report-management.controller';

const router = Router();

router.use(auth, authorize('super_admin', 'gestor'), authenticatedRateLimit);

// Listagem
router.get('/', reportManagementController.list);

// Expense report data & PDF (before /:slug to avoid param capture)
router.get('/expenses/data', reportManagementController.expenseData);
router.get('/expenses/pdf', reportManagementController.expensePdf);

// Detalhes por slug
router.get('/:slug', reportManagementController.getBySlug);

// Permissões (super_admin only)
router.get('/:reportId/permissions', authorize('super_admin'), reportManagementController.listPermissions);
router.put('/:reportId/permissions', authorize('super_admin'), reportManagementController.updatePermissions);

export { router as reportManagementRoutes };
