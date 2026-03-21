import bcrypt from 'bcrypt';
import { db } from './index';
import { users, platformSettings, activityCategories } from './schema';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger';

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'admin@template.com';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'Admin@123456';
const SUPER_ADMIN_NAME = process.env.SUPER_ADMIN_NAME || 'Super Admin';

async function seed() {
  logger.info('Seeding database');

  const existing = await db.query.users.findFirst({
    where: eq(users.email, SUPER_ADMIN_EMAIL),
  });

  if (existing) {
    logger.info({ email: SUPER_ADMIN_EMAIL }, 'Super admin already exists');
  } else {
    const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12);

    const [superAdmin] = await db.insert(users).values({
      email: SUPER_ADMIN_EMAIL,
      passwordHash,
      name: SUPER_ADMIN_NAME,
      role: 'super_admin',
      isActive: true,
    }).returning();

    logger.info({ id: superAdmin.id, email: superAdmin.email, name: superAdmin.name, role: superAdmin.role }, 'Super admin created');
  }

  // Seed platform settings
  await db.insert(platformSettings).values([
    { key: 'app_name', value: 'Template Base' },
    { key: 'app_description', value: 'Template Base Application' },
    { key: 'password_reset_expiry_minutes', value: '60' },
    { key: 'allow_self_registration', value: 'false' },
    { key: 'must_change_password_on_create', value: 'true' },
    { key: 'login_history_retention_days', value: '90' },
    { key: 'max_upload_size_mb', value: '5' },
    { key: 'allowed_file_types', value: 'image/jpeg,image/png,image/webp,application/pdf' },
  ]).onConflictDoNothing();
  logger.info('Platform settings seeded');

  // Seed activity categories
  const defaultCategories = [
    { name: 'Desenvolvimento', description: 'Codificação e implementação', isBillable: true, sortOrder: 1 },
    { name: 'Reunião', description: 'Reuniões com cliente ou internas', isBillable: true, sortOrder: 2 },
    { name: 'Análise', description: 'Análise de requisitos e documentação', isBillable: true, sortOrder: 3 },
    { name: 'Suporte', description: 'Suporte técnico e troubleshooting', isBillable: true, sortOrder: 4 },
    { name: 'Documentação', description: 'Criação e atualização de documentação', isBillable: true, sortOrder: 5 },
    { name: 'Code Review', description: 'Revisão de código', isBillable: true, sortOrder: 6 },
    { name: 'Treinamento', description: 'Treinamento e capacitação', isBillable: false, sortOrder: 7 },
    { name: 'Administrativo', description: 'Tarefas administrativas internas', isBillable: false, sortOrder: 8 },
  ];

  for (const cat of defaultCategories) {
    await db.insert(activityCategories).values(cat).onConflictDoNothing();
  }
  logger.info('Activity categories seeded');

  process.exit(0);
}

seed().catch((err) => {
  logger.fatal({ err }, 'Seed failed');
  process.exit(1);
});
