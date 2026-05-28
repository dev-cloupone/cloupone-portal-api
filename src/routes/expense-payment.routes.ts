import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { expensePaymentController } from '../controllers/expense-payment.controller';

const router = Router();

router.get('/', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, expensePaymentController.list);
router.get('/my', auth, authorize('consultor', 'gestor'), authenticatedRateLimit, expensePaymentController.listMy);
router.get('/available-periods', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, expensePaymentController.getAvailablePeriods);
router.post('/', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, expensePaymentController.generate);
router.get('/:id', auth, authorize('super_admin', 'administrative', 'consultor', 'gestor'), authenticatedRateLimit, expensePaymentController.getById);
router.patch('/:id', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, expensePaymentController.update);
router.post('/:id/confirm', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, expensePaymentController.confirmPayment);
router.post('/:id/pay', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, expensePaymentController.payPayment);
router.post('/:id/cancel', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, expensePaymentController.cancelPayment);
router.post('/:id/revert', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, expensePaymentController.revertPayment);
router.delete('/:id', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, expensePaymentController.deletePayment);
router.get('/:id/receipt', auth, authorize('super_admin', 'administrative', 'consultor', 'gestor'), authenticatedRateLimit, expensePaymentController.getReceipt);

export { router as expensePaymentRoutes };
