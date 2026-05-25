import type { EmailProvider, EmailOptions } from './email-provider';
import { logger } from '../../utils/logger';

export class ConsoleEmailProvider implements EmailProvider {
  async send(options: EmailOptions): Promise<void> {
    logger.info(
      { to: options.to, cc: options.cc, subject: options.subject },
      '📧 [EMAIL] Email sent (console provider)',
    );

    if (options.text) {
      logger.debug(`📧 [EMAIL] Content:\n${options.text}`);
    }
  }
}
