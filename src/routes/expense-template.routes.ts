import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { expenseTemplateController } from '../controllers/expense-template.controller';

const router = Router();

router.use(auth, authenticatedRateLimit);

router.get('/', expenseTemplateController.list);
router.post('/', expenseTemplateController.create);
router.put('/:id', expenseTemplateController.update);
router.delete('/:id', expenseTemplateController.remove);

export { router as expenseTemplateRoutes };
