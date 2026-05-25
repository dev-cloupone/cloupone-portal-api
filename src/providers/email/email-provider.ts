export interface EmailOptions {
  to: string;
  cc?: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailProvider {
  send(options: EmailOptions): Promise<void>;
}
