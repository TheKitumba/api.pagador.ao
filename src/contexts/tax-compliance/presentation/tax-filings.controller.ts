import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { IdParam } from '@/shared/presentation/zod';

import { GenerateTaxFilingsUseCase, TaxFilingsService } from '../application/tax-filings.use-cases';

class GenerateTaxFilingsDto extends createZodDto(z.object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12) })) {}
class TaxYearQuery extends createZodDto(z.object({ year: z.coerce.number().int().optional() })) {}

@ApiTags('Obrigações fiscais')
@ApiCookieAuth()
@Controller('tax-filings')
export class TaxFilingsController {
  constructor(
    private readonly generate: GenerateTaxFilingsUseCase,
    private readonly filings: TaxFilingsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Obrigações fiscais e contributivas', description: 'O estado OVERDUE é calculado quando o prazo passou sem pagamento.' })
  list(@Query() query: TaxYearQuery) {
    return this.filings.list(query.year);
  }

  @Get('calendar')
  @ApiOperation({ summary: 'Calendário fiscal', description: 'Próximos prazos AGT e INSS com dias em falta (prazos por omissão da lei, parametrizáveis).' })
  calendar() {
    return this.filings.calendar();
  }

  @Post('generate')
  @ApiOperation({ summary: 'Gerar mapas do mês', description: 'Mapa de IRT (AGT), folha de remunerações (INSS) e retenções de prestadores, a partir das folhas aprovadas.' })
  create(@Body() body: GenerateTaxFilingsDto) {
    return this.generate.execute(body.year, body.month);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obrigação com as linhas por trabalhador/fornecedor' })
  get(@Param() { id }: IdParam) {
    return this.filings.get(id);
  }

  @Get(':id/file')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Ficheiro para submissão (CSV)' })
  async file(@Param() { id }: IdParam, @Res({ passthrough: true }) response: Response) {
    const file = await this.filings.file(id);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    return file.content;
  }

  @Post(':id/submit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marcar como submetida no portal' })
  submit(@Param() { id }: IdParam) {
    return this.filings.transition(id, 'SUBMITTED');
  }

  @Post(':id/pay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marcar como paga' })
  pay(@Param() { id }: IdParam) {
    return this.filings.transition(id, 'PAID');
  }
}
