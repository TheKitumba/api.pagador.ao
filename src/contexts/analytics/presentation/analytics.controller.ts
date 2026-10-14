import { Body, Controller, Get, Header, Param, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { toCsv } from '@/shared/application/csv';
import { toDate } from '@/shared/application/formatting';
import { dateOnly } from '@/shared/presentation/zod';

import { AnalyticsService } from '../application/analytics.service';

class CodeParam extends createZodDto(z.object({ code: z.string() })) {}
class SaveReportDto extends createZodDto(z.object({ name: z.string().min(3), source: z.string(), groupBy: z.string().optional(), schedule: z.string().optional() })) {}
class CalendarQuery extends createZodDto(z.object({ from: dateOnly, to: dateOnly })) {}

@ApiTags('Relatórios')
@ApiCookieAuth()
@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Indicadores do início', description: 'Efectivo, folha actual, absentismo, contratos a terminar, aprovações pendentes, prazos legais e aniversários.' })
  dashboard() {
    return this.analytics.dashboard();
  }

  @Get('reports')
  @ApiOperation({ summary: 'Catálogo de relatórios' })
  catalog() {
    return this.analytics.catalog();
  }

  @Get('reports/saved')
  @ApiOperation({ summary: 'Relatórios guardados' })
  saved() {
    return this.analytics.savedReports();
  }

  @Post('reports/saved')
  @ApiOperation({ summary: 'Guardar relatório (com envio agendado opcional)' })
  save(@Body() body: SaveReportDto) {
    return this.analytics.saveReport(body);
  }

  @Get('reports/:code')
  @ApiOperation({ summary: 'Executar relatório' })
  run(@Param() { code }: CodeParam) {
    return this.analytics.run(code);
  }

  @Get('reports/:code/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Exportar relatório (CSV)' })
  async export(@Param() { code }: CodeParam) {
    return toCsv((await this.analytics.run(code)).rows);
  }

  @Get('calendar')
  @ApiTags('Comunicação')
  @ApiOperation({ summary: 'Calendário', description: 'Feriados, férias, pagamentos, prazos fiscais, formações e entrevistas, conforme as permissões.' })
  calendar(@Query() query: CalendarQuery) {
    return this.analytics.calendar(toDate(query.from), toDate(query.to));
  }
}
