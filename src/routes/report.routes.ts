import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { reportController } from '../controllers/report.controller';

const router = Router();

router.use(auth, authorize('super_admin', 'gestor'), authenticatedRateLimit);

router.get('/client/:clientId', reportController.clientData);
router.get('/client/:clientId/pdf', reportController.clientPdf);
router.get('/client/:clientId/excel', reportController.clientCsv);
router.get('/billing', reportController.billing);
router.get('/payroll', reportController.payroll);

// Consultant Report
router.get('/consultant/:consultantId', reportController.consultantData);
router.get('/consultant/:consultantId/pdf', reportController.consultantPdf);
router.get('/consultant/:consultantId/excel', reportController.consultantCsv);

// Enhanced Client Report
router.get('/client/:clientId/enhanced', reportController.enhancedClientData);
router.get('/client/:clientId/enhanced/pdf', reportController.enhancedClientPdf);
router.get('/client/:clientId/enhanced/excel', reportController.enhancedClientCsv);

export { router as reportRoutes };
