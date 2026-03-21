import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import * as adminSettingsController from '../controllers/admin-settings.controller';

const router = Router();

router.use(auth, authorize('super_admin'), authenticatedRateLimit);

router.get('/', adminSettingsController.list);
router.put('/', adminSettingsController.update);

export { router as adminSettingsRoutes };
