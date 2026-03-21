import { purgeOldEntries } from '../services/login-history.service';
import { logger } from '../utils/logger';

async function main() {
  const deleted = await purgeOldEntries();
  logger.info({ deleted }, 'Purged old login history entries');
  process.exit(0);
}

main().catch((err) => {
  logger.fatal(err, 'Failed to purge login history');
  process.exit(1);
});
