import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { consultantPaymentController } from '../controllers/consultant-payment.controller';

const router = Router();

router.get('/', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, consultantPaymentController.list);
router.get('/pending-approvals', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, consultantPaymentController.pendingApprovals);
router.get('/my', auth, authorize('consultor', 'gestor'), authenticatedRateLimit, consultantPaymentController.listMy);
router.post('/', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, consultantPaymentController.generate);
router.get('/:id', auth, authorize('super_admin', 'administrative', 'consultor', 'gestor'), authenticatedRateLimit, consultantPaymentController.getById);
router.patch('/:id', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, consultantPaymentController.update);
router.post('/:id/confirm', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, consultantPaymentController.confirmPayment);
router.post('/:id/pay', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, consultantPaymentController.payPayment);
router.post('/:id/cancel', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, consultantPaymentController.cancelPayment);
router.post('/:id/revert', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, consultantPaymentController.revertPayment);
router.delete('/:id', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, consultantPaymentController.deletePayment);
router.get('/:id/receipt', auth, authorize('super_admin', 'administrative', 'consultor', 'gestor'), authenticatedRateLimit, consultantPaymentController.getReceipt);

export { router as consultantPaymentRoutes };
