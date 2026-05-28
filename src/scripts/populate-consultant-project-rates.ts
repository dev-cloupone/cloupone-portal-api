import { eq } from 'drizzle-orm';
import { db } from '../db';
import { projectAllocations, consultantProfiles, projects, consultantProjectRates } from '../db/schema';
import { logger } from '../utils/logger';

async function main() {
  const allocations = await db.select({
    userId: projectAllocations.userId,
    projectId: projectAllocations.projectId,
    costRate: consultantProfiles.hourlyRate,
    billingRate: projects.billingRate,
  })
    .from(projectAllocations)
    .innerJoin(consultantProfiles, eq(projectAllocations.userId, consultantProfiles.userId))
    .innerJoin(projects, eq(projectAllocations.projectId, projects.id));

  let inserted = 0;
  for (const alloc of allocations) {
    const result = await db.insert(consultantProjectRates)
      .values({
        userId: alloc.userId,
        projectId: alloc.projectId,
        costRate: alloc.costRate,
        billingRate: alloc.billingRate,
      })
      .onConflictDoNothing();

    if (result.rowCount && result.rowCount > 0) inserted++;
  }

  logger.info({ total: allocations.length, inserted }, 'Populated consultant project rates');
  process.exit(0);
}

main().catch((err) => {
  logger.fatal(err, 'Failed to populate consultant project rates');
  process.exit(1);
});
