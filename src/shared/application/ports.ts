import type { Readable } from 'node:stream';

/** Object storage for documents, receipts, CVs and generated files (MinIO / S3). */
export abstract class FileStorage {
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
  abstract get(key: string): Promise<{ body: Readable; contentType: string; size?: number }>;
  abstract remove(key: string): Promise<void>;
}

/**
 * Transactional e-mails: template name → the data it renders. The Handlebars templates live in
 * templates/emails at the project root (one `<name>.hbs` per entry).
 */
export interface MailTemplates {
  'password-reset': { name: string; resetUrl: string; validMinutes: number };
  invitation: { inviterName: string; companyName: string; roles: string[]; acceptUrl: string; validDays: number };
  payslip: { name: string; companyName: string; period: string; paymentDate: string | null; portalUrl: string };
  announcement: { title: string; body: string; companyName: string; authorName: string; messagesUrl: string };
  'approval-pending': { title: string; stepLabel: string; approvalsUrl: string };
  'application-received': { name: string; jobTitle: string; companyName: string };
  'application-rejected': { name: string; jobTitle: string; companyName: string };
  'interview-invitation': { name: string; jobTitle: string; companyName: string; interviewAt: string };
}

export type MailTemplateName = keyof MailTemplates;

export type MailMessage = {
  [T in MailTemplateName]: {
    to: string;
    subject: string;
    template: T;
    data: MailTemplates[T];
    attachments?: { filename: string; content: Buffer; contentType?: string }[];
  };
}[MailTemplateName];

export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}

export abstract class SmsSender {
  abstract send(phone: string, text: string): Promise<void>;
}
