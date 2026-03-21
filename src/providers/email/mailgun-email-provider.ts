import type { EmailProvider, EmailOptions } from './email-provider';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

export class MailgunEmailProvider implements EmailProvider {
  private readonly apiKey: string;
  private readonly domain: string;
  private readonly baseUrl: string;
  private readonly from: string;

  constructor() {
    if (!env.MAILGUN_API_KEY) {
      throw new Error('MAILGUN_API_KEY is required when EMAIL_PROVIDER=mailgun');
    }
    if (!env.MAILGUN_DOMAIN) {
      throw new Error('MAILGUN_DOMAIN is required when EMAIL_PROVIDER=mailgun');
    }

    this.apiKey = env.MAILGUN_API_KEY;
    this.domain = env.MAILGUN_DOMAIN;
    this.from = env.EMAIL_FROM;

    const host = env.MAILGUN_REGION === 'eu'
      ? 'api.eu.mailgun.net'
      : 'api.mailgun.net';
    this.baseUrl = `https://${host}/v3/${this.domain}`;
  }

  async send(options: EmailOptions): Promise<void> {
    const form = new FormData();
    form.append('from', this.from);
    form.append('to', options.to);
    form.append('subject', options.subject);
    form.append('html', options.html);
    if (options.text) {
      form.append('text', options.text);
    }

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${this.apiKey}`).toString('base64')}`,
      },
      body: form,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Mailgun API error: ${response.status} ${response.statusText} — ${body}`,
      );
    }

    logger.info(
      { to: options.to, subject: options.subject },
      'Email sent via Mailgun',
    );
  }
}
