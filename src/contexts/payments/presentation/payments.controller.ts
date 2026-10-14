import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { IdParam } from '@/shared/presentation/zod';

import { GeneratePaymentBatchesUseCase, PaymentBatchesService } from '../application/payments.use-cases';

class GeneratePaymentBatchDto extends createZodDto(z.object({ runId: z.uuid() })) {}
class ListQuery extends createZodDto(z.object({ runId: z.uuid().optional() })) {}
class ReconcileDto extends createZodDto(z.object({ rejections: z.array(z.object({ instructionId: z.uuid(), reason: z.string().min(2) })).default([]).describe('Pagamentos rejeitados pelo banco (os restantes ficam pagos)') })) {}

@ApiTags('Pagamentos')
@ApiCookieAuth()
@Controller('payment-batches')
export class PaymentsController {
  constructor(
    private readonly generate: GeneratePaymentBatchesUseCase,
    private readonly batches: PaymentBatchesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lotes de pagamento' })
  list(@Query() query: ListQuery) {
    return this.batches.list(query.runId);
  }

  @Post()
  @ApiOperation({
    summary: 'Gerar lotes a partir de uma folha aprovada',
    description: 'Um lote por banco, enviado para aprovação. Quem gera não aprova. Alerta para IBAN alterados nos 5 dias anteriores ao pagamento.',
  })
  create(@Body() body: GeneratePaymentBatchDto) {
    return this.generate.execute(body.runId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Lote com as instruções de pagamento (IBAN mascarado)' })
  get(@Param() { id }: IdParam) {
    return this.batches.get(id);
  }

  @Get(':id/file')
  @ApiProduces('text/plain', 'text/csv')
  @ApiOperation({ summary: 'Ficheiro bancário', description: 'Antes da aprovação é uma pré-visualização; depois, descarregar marca o lote como enviado.' })
  async file(@Param() { id }: IdParam, @Res({ passthrough: true }) response: Response) {
    const file = await this.batches.file(id);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    return file.content;
  }

  @Post(':id/reconcile')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reconciliar com a resposta do banco', description: 'Quando todos os lotes da folha estão reconciliados, a folha passa a paga.' })
  reconcile(@Param() { id }: IdParam, @Body() body: ReconcileDto) {
    return this.batches.reconcile(id, body.rejections);
  }
}
