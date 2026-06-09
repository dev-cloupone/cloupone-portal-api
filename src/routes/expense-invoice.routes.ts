import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { expenseInvoiceController } from '../controllers/expense-invoice.controller';

const router = Router();

router.get('/', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, expenseInvoiceController.list);
router.get('/my', auth, authorize('client'), authenticatedRateLimit, expenseInvoiceController.listMy);
router.post('/', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, expenseInvoiceController.generate);
router.get('/:id', auth, authorize('super_admin', 'administrative', 'client'), authenticatedRateLimit, expenseInvoiceController.getById);
router.patch('/:id', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, expenseInvoiceController.update);
router.post('/:id/issue', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, expenseInvoiceController.issue);
router.post('/:id/pay', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, expenseInvoiceController.pay);
router.post('/:id/cancel', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, expenseInvoiceController.cancel);
router.post('/:id/revert-to-draft', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, expenseInvoiceController.revertToDraft);
router.post('/:id/revert-to-issued', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, expenseInvoiceController.revertToIssued);
router.delete('/:id', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, expenseInvoiceController.deleteInvoice);
router.get('/:id/pdf', auth, authorize('super_admin', 'administrative', 'client'), authenticatedRateLimit, expenseInvoiceController.getPdf);
router.get('/:id/receipts-zip', auth, authorize('super_admin', 'administrative', 'client'), authenticatedRateLimit, expenseInvoiceController.getReceiptsZip);
router.delete('/:id/items/:itemId', auth, authorize('super_admin', 'administrative'), authenticatedRateLimit, expenseInvoiceController.removeItem);

export { router as expenseInvoiceRoutes };
