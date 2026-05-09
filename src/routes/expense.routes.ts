import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { expenseController } from '../controllers/expense.controller';

const router = Router();

router.use(auth, authenticatedRateLimit);

// Consultor endpoints (any authenticated user)
router.get('/month', expenseController.getMonthExpenses);
router.get('/week', expenseController.getWeekExpenses);
router.post('/', expenseController.upsert);
router.post('/:id/resubmit', expenseController.resubmit);
router.delete('/:id', expenseController.remove);

// Admin endpoints (Phase 4: Approvals)
router.get('/pending', authorize('super_admin'), expenseController.listPending);
router.post('/approve', authorize('super_admin'), expenseController.approve);
router.post('/:id/reject', authorize('super_admin'), expenseController.reject);
router.post('/:id/revert', authorize('super_admin'), expenseController.revert);

// Admin endpoints (Phase 5: Reimbursements)
router.get('/reimbursements', authorize('super_admin'), expenseController.listReimbursements);
router.post('/reimburse', authorize('super_admin'), expenseController.markAsReimbursed);
router.post('/:id/unreimburse', authorize('super_admin'), expenseController.unmarkReimbursement);

export { router as expenseRoutes };
