import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { IdParam, ReasonDto } from '@/shared/presentation/zod';

import { ApprovalWorkflowsService, DecideApprovalUseCase, ListApprovalsQuery } from '../application/approvals.use-cases';

const approvalType = z.enum(['LEAVE', 'OVERTIME', 'ADVANCE', 'LOAN', 'EXPENSE', 'SALARY_CHANGE', 'PAYROLL_RUN', 'PAYMENT_BATCH', 'TERMINATION', 'ATTENDANCE_CORRECTION', 'TIMESHEET']);
const role = z.enum(['ACCOUNT_ADMIN', 'HR_MANAGER', 'HR_TECHNICIAN', 'PAYROLL_PROCESSOR', 'FINANCIAL_APPROVER', 'LINE_MANAGER', 'RECRUITER', 'EMPLOYEE', 'AUDITOR']);

class ListApprovalsDto extends createZodDto(
  z.object({
    scope: z.enum(['pending', 'mine', 'history']).default('pending').describe('pending = à espera da minha decisão; mine = pedidos que fiz; history = já decidi'),
    type: approvalType.optional(),
  }),
) {}

class TypeParam extends createZodDto(z.object({ type: approvalType })) {}

class UpdateWorkflowDto extends createZodDto(
  z.object({
    steps: z
      .array(z.object({ approver: role.describe('LINE_MANAGER = chefia directa do beneficiário'), slaHours: z.number().int().min(1).max(720).optional() }))
      .min(1)
      .max(6),
  }),
) {}

@ApiTags('Aprovações')
@ApiCookieAuth()
@Controller()
export class ApprovalsController {
  constructor(
    private readonly listApprovals: ListApprovalsQuery,
    private readonly decide: DecideApprovalUseCase,
    private readonly workflows: ApprovalWorkflowsService,
  ) {}

  @Get('approvals')
  @ApiOperation({ summary: 'Caixa de aprovações', description: 'Pedidos em que sou o aprovador do passo actual, excluindo os que criei ou que me beneficiam.' })
  list(@Query() query: ListApprovalsDto) {
    return this.listApprovals.execute(query);
  }

  @Post('approvals/:id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Aprovar o passo actual', description: 'O último passo aplica a decisão ao pedido (férias, folha, lote…).' })
  approve(@Param() { id }: IdParam) {
    return this.decide.execute(id, 'APPROVED');
  }

  @Post('approvals/:id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rejeitar (motivo obrigatório)' })
  reject(@Param() { id }: IdParam, @Body() body: ReasonDto) {
    return this.decide.execute(id, 'REJECTED', body.reason);
  }

  @Post('approvals/:id/return')
  @HttpCode(200)
  @ApiOperation({ summary: 'Devolver para correcção (motivo obrigatório)' })
  returnForCorrection(@Param() { id }: IdParam, @Body() body: ReasonDto) {
    return this.decide.execute(id, 'RETURNED', body.reason);
  }

  @Get('approval-workflows')
  @ApiOperation({ summary: 'Fluxos de aprovação configurados' })
  listWorkflows() {
    return this.workflows.list();
  }

  @Put('approval-workflows/:type')
  @ApiOperation({ summary: 'Configurar o fluxo de um tipo de pedido', description: 'Permissão: `settings.write`.' })
  updateWorkflow(@Param() { type }: TypeParam, @Body() body: UpdateWorkflowDto) {
    return this.workflows.update(type, body.steps);
  }
}
