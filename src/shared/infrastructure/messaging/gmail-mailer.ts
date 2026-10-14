import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

import { Mailer, type MailMessage } from '../../application/ports';
import { AppConfig } from '../config/app-config';

/**
 * Nodemailer with Gmail SMTP (requires a Google app password). Without credentials, e-mails are
 * logged instead of sent, so development works offline.
 */
@Injectable()
export class GmailMailer extends Mailer {
  private readonly logger = new Logger(GmailMailer.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(config: AppConfig) {
    super();
    const { GMAIL_USER, GMAIL_APP_PASSWORD, MAIL_FROM } = config.env;
    this.from = MAIL_FROM;
    this.transporter =
      GMAIL_USER && GMAIL_APP_PASSWORD
        ? nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } })
        : null;
    if (!this.transporter) this.logger.warn('GMAIL_USER/GMAIL_APP_PASSWORD não definidos: os e-mails são apenas registados no log.');
  }

  async send(message: MailMessage) {
    if (!this.transporter) {
      this.logger.log(`[e-mail] para ${message.to} — ${message.subject}${message.attachments?.length ? ` (${message.attachments.length} anexo(s))` : ''}\n${message.text}`);
      return;
    }
    await this.transporter.sendMail({ from: this.from, ...message });
  }
}
