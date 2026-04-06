import { Router } from 'express';
import { authSensitiveRateLimit, authGeneralRateLimit, authenticatedRateLimit } from '../middlewares/rate-limit';
import { auth } from '../middlewares/auth';
import { authController } from '../controllers/auth.controller';
import { passwordResetController } from '../controllers/password-reset.controller';
const router = Router();

router.post('/login', authSensitiveRateLimit, authController.login);
router.post('/register', authSensitiveRateLimit, authController.register);
router.post('/refresh', authGeneralRateLimit, authController.refresh);
router.post('/logout', authGeneralRateLimit, authController.logout);

// Password Reset
router.post('/forgot-password', authSensitiveRateLimit, passwordResetController.forgotPassword);
router.post('/reset-password', authSensitiveRateLimit, passwordResetController.resetPassword);

// Profile (authenticated)
router.get('/me', auth, authenticatedRateLimit, authController.getMe);
router.patch('/me', auth, authenticatedRateLimit, authController.updateMe);
router.patch('/me/password', auth, authSensitiveRateLimit, authController.changePassword);

// Login history
router.get('/me/login-history', auth, authenticatedRateLimit, authController.getMyLoginHistory);

// Force change password
router.post('/force-change-password', auth, authSensitiveRateLimit, authController.forceChangePassword);

export { router as authRoutes };
