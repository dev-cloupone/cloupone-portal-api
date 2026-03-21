import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { ticketController } from '../controllers/ticket.controller';

const router = Router();

router.use(auth, authenticatedRateLimit);

// CRUD principal
router.post('/', ticketController.create);
router.get('/', ticketController.list);
router.get('/stats', ticketController.getStats);
router.get('/:id', ticketController.getById);
router.patch('/:id', ticketController.update);

// Comentarios
router.post('/:id/comments', ticketController.addComment);
router.get('/:id/comments', ticketController.listComments);

// Historico
router.get('/:id/history', ticketController.listHistory);

// Anexos
router.post('/:id/attachments', ticketController.addAttachment);
router.delete('/:id/attachments/:attachmentId', ticketController.removeAttachment);

// Horas vinculadas
router.get('/:id/time-entries', ticketController.listTimeEntries);

export { router as ticketRoutes };
