import { Module } from '@nestjs/common';

import { AuditLogService } from './application/audit-log.service';
import { AuditController } from './presentation/audit.controller';

@Module({ controllers: [AuditController], providers: [AuditLogService] })
export class AuditModule {}
