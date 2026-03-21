import { Router } from 'express';
import { publicSettingsController } from '../controllers/public-settings.controller';

const router = Router();

router.get('/', publicSettingsController.getSettings);

export { router as publicSettingsRoutes };
