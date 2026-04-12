import { Router } from 'express';
import { auth } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { authenticatedRateLimit } from '../middlewares/rate-limit';
import { phaseController } from '../controllers/phase.controller';
import { subphaseConsultantController } from '../controllers/subphase-consultant.controller';

const router = Router();

router.use(auth, authenticatedRateLimit);

// Clone de Fases (super_admin + gestor) — antes das rotas com :phaseId
router.get('/projects/:projectId/phases/clonable-projects', authorize('super_admin', 'gestor'), phaseController.listClonableProjects);
router.post('/projects/:projectId/phases/clone', authorize('super_admin', 'gestor'), phaseController.clonePhases);

// Fases — CRUD (super_admin + gestor)
router.get('/projects/:projectId/phases', phaseController.listPhases);
router.post('/projects/:projectId/phases', authorize('super_admin', 'gestor'), phaseController.createPhase);
router.put('/phases/:phaseId', authorize('super_admin', 'gestor'), phaseController.updatePhase);
router.delete('/phases/:phaseId', authorize('super_admin', 'gestor'), phaseController.deactivatePhase);
router.put('/projects/:projectId/phases/reorder', authorize('super_admin', 'gestor'), phaseController.reorderPhases);

// Subfases — CRUD (super_admin + gestor)
router.get('/phases/:phaseId/subphases', phaseController.listSubphases);
router.post('/phases/:phaseId/subphases', authorize('super_admin', 'gestor'), phaseController.createSubphase);
router.put('/subphases/:subphaseId', authorize('super_admin', 'gestor'), phaseController.updateSubphase);
router.patch('/subphases/:subphaseId/status', authorize('super_admin', 'gestor'), phaseController.updateSubphaseStatus);
router.delete('/subphases/:subphaseId', authorize('super_admin', 'gestor'), phaseController.deactivateSubphase);
router.put('/phases/:phaseId/subphases/reorder', authorize('super_admin', 'gestor'), phaseController.reorderSubphases);

// Consultores na subfase (super_admin + gestor)
router.get('/subphases/:subphaseId/consultants', subphaseConsultantController.list);
router.post('/subphases/:subphaseId/consultants', authorize('super_admin', 'gestor'), subphaseConsultantController.add);
router.put('/subphases/:subphaseId/consultants/:userId', authorize('super_admin', 'gestor'), subphaseConsultantController.updateHours);
router.delete('/subphases/:subphaseId/consultants/:userId', authorize('super_admin', 'gestor'), subphaseConsultantController.remove);

// Carregar consultores em massa
router.post('/phases/:phaseId/load-consultants', authorize('super_admin', 'gestor'), subphaseConsultantController.loadConsultants);

// Apontamentos por fase/subfase (gestor + super_admin)
router.get('/subphases/:subphaseId/time-entries', authorize('super_admin', 'gestor'), phaseController.listSubphaseTimeEntries);
router.get('/phases/:phaseId/time-entries', authorize('super_admin', 'gestor'), phaseController.listPhaseTimeEntries);

// Subfases disponíveis para apontamento
router.get('/projects/:projectId/available-subphases', phaseController.listAvailableSubphases);

// Dashboard de fases (gestor + super_admin)
router.get('/dashboard/phases', authorize('super_admin', 'gestor'), phaseController.phasesDashboard);

export { router as phaseRoutes };
