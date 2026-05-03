import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { env } from './config/env';
import { db } from './db';
import { errorHandler } from './middlewares/error-handler';
import { authRoutes } from './routes/auth.routes';
import { usersRoutes } from './routes/users.routes';

import { adminSettingsRoutes } from './routes/admin-settings.routes';
import { publicSettingsRoutes } from './routes/public-settings.routes';
import { uploadsRoutes } from './routes/uploads.routes';
import { clientRoutes } from './routes/client.routes';
import { projectRoutes } from './routes/project.routes';
import { consultantRoutes } from './routes/consultant.routes';
import { timeEntryRoutes } from './routes/time-entry.routes';
import { dashboardRoutes } from './routes/dashboard.routes';
import { reportManagementRoutes } from './routes/report-management.routes';

import { ticketRoutes } from './routes/ticket.routes';
import { expenseCategoryRoutes } from './routes/expense-category.routes';
import { projectExpenseCategoryRoutes } from './routes/project-expense-category.routes';
import { projectExpensePeriodRoutes } from './routes/project-expense-period.routes';
import { expenseRoutes } from './routes/expense.routes';
import { expenseTemplateRoutes } from './routes/expense-template.routes';
import { monthlyTimesheetRoutes } from './routes/monthly-timesheet.routes';
import { phaseRoutes } from './routes/phase.routes';
import { globalRateLimit } from './middlewares/rate-limit';
import { logger } from './utils/logger';

const app = express();

app.set('trust proxy', 1);

// Redirect HTTP → HTTPS in production
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] !== 'https' && env.NODE_ENV === 'production') {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
}));

app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true,
}));

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

app.use(globalRateLimit);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);

app.use('/api/admin/settings', adminSettingsRoutes);
app.use('/api/settings/public', publicSettingsRoutes);
app.use('/api/uploads', uploadsRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api', phaseRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/consultants', consultantRoutes);
app.use('/api/time-entries', timeEntryRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportManagementRoutes);

app.use('/api/tickets', ticketRoutes);
app.use('/api/expense-category-templates', expenseCategoryRoutes);
app.use('/api/projects', projectExpenseCategoryRoutes);
app.use('/api/projects', projectExpensePeriodRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/expense-templates', expenseTemplateRoutes);
app.use('/api/monthly-timesheets', monthlyTimesheetRoutes);

app.use(errorHandler);

async function start() {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, 'db/migrations') });
  logger.info('Database migrations applied');

  app.listen(env.PORT, '0.0.0.0', () => {
    logger.info({ port: env.PORT }, 'Server started on 0.0.0.0');
  });
}

start().catch((err) => {
  logger.fatal(err, 'Failed to start server');
  process.exit(1);
});
