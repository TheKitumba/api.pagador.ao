import type { Readable } from 'node:stream';

/** Object storage for documents, receipts, CVs and generated files (MinIO / S3). */
export abstract class FileStorage {
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
  abstract get(key: string): Promise<{ body: Readable; contentType: string; size?: number }>;
  abstract remove(key: string): Promise<void>;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}

export abstract class SmsSender {
  abstract send(phone: string, text: string): Promise<void>;
}
