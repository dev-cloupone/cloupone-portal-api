import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { invoiceController } from '../controllers/invoice.controller';

const router = Router();

router.get('/', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, invoiceController.list);
router.get('/my', auth, authorize('client'), authenticatedRateLimit, invoiceController.listMy);
router.get('/pending-approvals', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, invoiceController.pendingApprovals);
router.post('/', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, invoiceController.generate);
router.get('/:id', auth, authorize('super_admin', 'administrative', 'client'), authenticatedRateLimit, invoiceController.getById);
router.patch('/:id', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, invoiceController.update);
router.post('/:id/issue', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, invoiceController.issue);
router.post('/:id/pay', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, invoiceController.pay);
router.post('/:id/cancel', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, invoiceController.cancel);
router.delete('/:id', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, invoiceController.deleteInvoice);
router.get('/:id/pdf', auth, authorize('super_admin', 'administrative', 'client'), authenticatedRateLimit, invoiceController.getPdf);
router.post('/:id/lines', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, invoiceController.addCustomLine);
router.delete('/:id/lines/:lineId', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, invoiceController.removeCustomLine);

export { router as invoiceRoutes };
