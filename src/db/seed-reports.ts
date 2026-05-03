import { db } from './index';
import { reports } from './schema';
import { logger } from '../utils/logger';

async function seedReports() {
  logger.info('Seeding reports...');

  await db.insert(reports).values({
    name: 'Relatório de Despesas',
    slug: 'expenses',
    description: 'Relatório detalhado de despesas por projeto, semana e consultor.',
    isActive: true,
  }).onConflictDoNothing();

  logger.info('Reports seeded');
  process.exit(0);
}

seedReports().catch((err) => {
  logger.fatal({ err }, 'Seed reports failed');
  process.exit(1);
});
