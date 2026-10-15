import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

import { Mailer, type MailMessage } from '../../application/ports';
import { AppConfig } from '../config/app-config';
import { MailRenderer } from './mail-renderer';

/**
 * Nodemailer with Gmail SMTP (requires a Google app password). Without credentials, e-mails are
 * logged instead of sent, so development works offline.
 */
@Injectable()
export class GmailMailer extends Mailer {
  private readonly logger = new Logger(GmailMailer.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(
    config: AppConfig,
    private readonly renderer: MailRenderer,
  ) {
    super();
    const { GMAIL_USER, GMAIL_APP_PASSWORD, MAIL_FROM } = config.env;
    this.from = MAIL_FROM;
    this.transporter =
      GMAIL_USER && GMAIL_APP_PASSWORD
        ? nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } })
        : null;
    if (!this.transporter) this.logger.warn('GMAIL_USER/GMAIL_APP_PASSWORD não definidos: os e-mails são apenas registados no log.');
  }

  async send({ to, subject, template, data, attachments }: MailMessage) {
    const { html, text } = this.renderer.render(template, data, subject);
    if (!this.transporter) {
      this.logger.log(`[e-mail ${template}] para ${to} — ${subject}${attachments?.length ? ` (${attachments.length} anexo(s))` : ''}\n${text}`);
      return;
    }
    await this.transporter.sendMail({ from: this.from, to, subject, html, text, attachments });
  }
}
