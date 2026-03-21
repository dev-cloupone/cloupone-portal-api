import type { EmailProvider } from './email-provider';
import { ConsoleEmailProvider } from './console-email-provider';
import { MailgunEmailProvider } from './mailgun-email-provider';
import { env } from '../../config/env';

let emailProvider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (!emailProvider) {
    switch (env.EMAIL_PROVIDER) {
      case 'console':
        emailProvider = new ConsoleEmailProvider();
        break;
      case 'mailgun':
        emailProvider = new MailgunEmailProvider();
        break;
      default: {
        const _exhaustive: never = env.EMAIL_PROVIDER;
        throw new Error(`Unsupported email provider: ${_exhaustive}`);
      }
    }
  }
  return emailProvider;
}
