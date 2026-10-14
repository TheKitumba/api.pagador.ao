import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { paginationSchema } from '@/shared/application/pagination';
import { toCsv } from '@/shared/application/csv';
import { dateBound } from '@/shared/presentation/zod';

import { AuditLogService } from '../application/audit-log.service';

const range = { from: dateBound.optional(), to: dateBound.optional() };
class AuditQuery extends createZodDto(
  paginationSchema.extend({ action: z.string().optional().describe('Prefixo, ex.: payroll_run.'), entityType: z.string().optional(), entityId: z.string().optional(), actorUserId: z.uuid().optional(), ...range }),
) {}
class RangeQuery extends createZodDto(z.object(range)) {}

@ApiTags('Auditoria')
@ApiCookieAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditLogService) {}

  @Get()
  @ApiOperation({ summary: 'Registo de auditoria (só inserção)', description: 'Permissão `audit.read`. Dados sensíveis são redigidos.' })
  list(@Query() query: AuditQuery) {
    return this.audit.list(query);
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="auditoria.csv"')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Exportar auditoria (CSV)' })
  async export(@Query() query: RangeQuery) {
    return toCsv(await this.audit.exportRows(query));
  }

  @Get('verify')
  @ApiOperation({ summary: 'Verificar integridade', description: 'Recalcula o encadeamento de hashes; detecta registos alterados ou removidos.' })
  verify() {
    return this.audit.verify();
  }
}
