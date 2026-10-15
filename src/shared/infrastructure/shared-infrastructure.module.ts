import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';

import { FileStorage, Mailer, SmsSender } from '../application/ports';
import { AuditService } from './audit/audit.service';
import { AppConfig } from './config/app-config';
import { ActorContext } from './context/actor-context';
import { GmailMailer } from './messaging/gmail-mailer';
import { LogSmsSender } from './messaging/log-sms-sender';
import { MailRenderer } from './messaging/mail-renderer';
import { OutboxService } from './outbox/outbox.service';
import { Database } from './prisma/database';
import { PrismaService } from './prisma/prisma.service';
import { QUEUES, redisConnection } from './queue/queues';
import { S3FileStorage } from './storage/s3-file-storage';

const config = new AppConfig();

/** Cross-cutting infrastructure shared by every context (database, audit, outbox, storage, messaging). */
@Global()
@Module({
  imports: [
    BullModule.forRoot({ connection: redisConnection(config.env.REDIS_URL) }),
    BullModule.registerQueue(...Object.values(QUEUES).map((name) => ({ name }))),
  ],
  providers: [
    { provide: AppConfig, useValue: config },
    PrismaService,
    Database,
    ActorContext,
    AuditService,
    OutboxService,
    { provide: FileStorage, useClass: S3FileStorage },
    MailRenderer,
    { provide: Mailer, useClass: GmailMailer },
    { provide: SmsSender, useClass: LogSmsSender },
  ],
  exports: [AppConfig, PrismaService, Database, ActorContext, AuditService, OutboxService, FileStorage, Mailer, SmsSender, BullModule],
})
export class SharedInfrastructureModule {}
