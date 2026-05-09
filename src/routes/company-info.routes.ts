import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { companyInfoController } from '../controllers/company-info.controller';

const router = Router();

router.use(auth, authorize('super_admin'), authenticatedRateLimit);

router.get('/', companyInfoController.get);
router.put('/', companyInfoController.upsert);

export { router as companyInfoRoutes };
