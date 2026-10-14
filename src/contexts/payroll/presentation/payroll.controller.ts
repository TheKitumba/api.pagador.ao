import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiNoContentResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { dateOnly, IdParam, moneyInput } from '@/shared/presentation/zod';

import { BenefitsService, ExpensesService, LoansService } from '../application/compensation.use-cases';
import { PayrollConfigService } from '../application/payroll-config.service';
import {
  CalculatePayrollRunUseCase,
  ClosePayrollRunUseCase,
  CreatePayrollRunUseCase,
  PayrollRunQueries,
  PayrollVariablesService,
  SubmitPayrollRunUseCase,
} from '../application/payroll-runs.use-cases';
import { PayslipsService } from '../application/payslips.service';

const runType = z.enum(['REGULAR', 'HOLIDAY_ALLOWANCE', 'CHRISTMAS_ALLOWANCE', 'BONUS', 'RETRO', 'SUPPLEMENTARY', 'FINAL_SETTLEMENT']);
const legalKind = z.enum(['IRT_GROUP_A', 'SOCIAL_SECURITY', 'MINIMUM_WAGE', 'IRT_EXEMPTIONS', 'OVERTIME_RATES', 'HOLIDAYS', 'CONTRACTOR_WITHHOLDING']);

class CreateRunDto extends createZodDto(z.object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12), runType: runType.default('REGULAR'), paymentDate: dateOnly.optional() })) {}
class VariablesDto extends createZodDto(
  z.object({
    entries: z
      .array(
        z
          .object({ employeeId: z.uuid(), payItemCode: z.string().describe('Ex.: R040 (prémio), R070 (retroactivos), D031 (quota sindical)'), quantity: z.number().optional(), amount: moneyInput.optional(), notes: z.string().optional() })
          .refine((entry) => entry.quantity !== undefined || entry.amount !== undefined, 'Indique quantidade ou valor'),
      )
      .min(1)
      .max(5000),
  }),
) {}
class VariableParam extends createZodDto(z.object({ id: z.uuid(), variableId: z.uuid() })) {}
class SearchQuery extends createZodDto(z.object({ q: z.string().optional() })) {}

const payItemSchema = z.object({
  code: z.string().regex(/^[RDE]\d{3}$/).describe('R = remuneração, D = desconto, E = encargo patronal'),
  name: z.string().min(2),
  kind: z.enum(['EARNING', 'DEDUCTION', 'EMPLOYER_CHARGE', 'INFORMATIVE']),
  nature: z.enum(['FIXED', 'VARIABLE', 'CALCULATED']),
  category: z.enum(['SALARY', 'ALLOWANCE', 'BENEFIT', 'INSURANCE', 'OVERTIME', 'BONUS', 'STATUTORY', 'ABSENCE', 'LOAN', 'OTHER']).optional(),
  formula: z.string().max(500).nullable().optional().describe('Linguagem de fórmulas (GET /v1/pay-items/formula-reference)'),
  irtSubject: z.boolean().optional(),
  irtExemptionLimit: z.number().min(0).nullable().optional(),
  ssSubject: z.boolean().optional(),
  holidayAllowance: z.boolean().optional(),
  christmasAllowance: z.boolean().optional(),
  proportional: z.boolean().optional(),
  accountingAccount: z.string().nullable().optional(),
  calculationOrder: z.number().int().optional(),
  visibleOnPayslip: z.boolean().optional(),
});
class PayItemDto extends createZodDto(payItemSchema) {}
class UpdatePayItemDto extends createZodDto(payItemSchema.partial()) {}
class LegalTableQuery extends createZodDto(z.object({ kind: legalKind.optional() })) {}
class LegalTableDto extends createZodDto(
  z.object({ kind: legalKind, version: z.string().min(2), effectiveFrom: dateOnly, legalReference: z.string().min(3).describe('Ex.: Lei n.º 28/20, de 22 de Julho'), data: z.record(z.string(), z.unknown()).describe('Ex.: { "brackets": [...] } ou { "employeeRate": 0.03, "employerRate": 0.08 }') }),
) {}

class LoanDto extends createZodDto(
  z.object({ employeeId: z.uuid().optional().describe('Omitir para pedido próprio'), type: z.enum(['ADVANCE', 'LOAN', 'GARNISHMENT']), principal: moneyInput, installments: z.number().int().min(1).max(120), firstMonth: dateOnly, notes: z.string().optional() }),
) {}
class ExpenseDto extends createZodDto(
  z.object({ employeeId: z.uuid().optional(), category: z.enum(['TRAVEL', 'PER_DIEM', 'FUEL', 'MATERIAL', 'REPRESENTATION', 'OTHER']), description: z.string().min(3), amount: moneyInput, date: dateOnly }),
) {}
class ExpenseQuery extends createZodDto(z.object({ status: z.enum(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED']).optional() })) {}
class AssignBenefitDto extends createZodDto(z.object({ employeeIds: z.array(z.uuid()).min(1), amount: moneyInput })) {}
class UnassignParam extends createZodDto(z.object({ id: z.uuid(), employeeId: z.uuid() })) {}

@ApiTags('Folha de pagamento')
@ApiCookieAuth()
@Controller('payroll')
export class PayrollRunsController {
  constructor(
    private readonly queries: PayrollRunQueries,
    private readonly create: CreatePayrollRunUseCase,
    private readonly calculate: CalculatePayrollRunUseCase,
    private readonly submit: SubmitPayrollRunUseCase,
    private readonly closing: ClosePayrollRunUseCase,
    private readonly variables: PayrollVariablesService,
    private readonly payslips: PayslipsService,
  ) {}

  @Get('periods')
  @ApiOperation({ summary: 'Períodos de processamento' })
  periods() {
    return this.queries.periods();
  }

  @Get('trend')
  @ApiOperation({ summary: 'Evolução do ilíquido, líquido e custo (últimos 6 meses)' })
  trend() {
    return this.queries.trend();
  }

  @Get('runs')
  @ApiOperation({ summary: 'Processamentos' })
  list() {
    return this.queries.list();
  }

  @Post('runs')
  @ApiOperation({ summary: 'Criar processamento', description: 'Cria o período se necessário. Tipos: normal, subsídios de férias/Natal, prémios, retroactivos, complementar, acertos.' })
  createRun(@Body() body: CreateRunDto) {
    return this.create.execute(body);
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'Processamento com totais, alertas e comparação com o anterior' })
  get(@Param() { id }: IdParam) {
    return this.queries.get(id);
  }

  @Get('runs/:id/alerts')
  @ApiOperation({ summary: 'Alertas da pré-folha (bloqueantes, avisos e informativos — docs/04 4.7)' })
  alerts(@Param() { id }: IdParam) {
    return this.queries.alerts(id);
  }

  @Get('runs/:id/variables')
  @ApiOperation({ summary: 'Lançamentos variáveis do período' })
  listVariables(@Param() { id }: IdParam) {
    return this.variables.list(id);
  }

  @Post('runs/:id/variables')
  @ApiOperation({ summary: 'Lançar variáveis em massa', description: 'Prémios, comissões, retroactivos, quotas… Alterar uma folha calculada devolve-a a rascunho.' })
  addVariables(@Param() { id }: IdParam, @Body() body: VariablesDto) {
    return this.variables.add(id, body.entries);
  }

  @Delete('runs/:id/variables/:variableId')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiOperation({ summary: 'Apagar lançamento variável' })
  async removeVariable(@Param() params: VariableParam) {
    await this.variables.remove(params.id, params.variableId);
  }

  @Post('runs/:id/calculate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Calcular (pré-folha ou definitivo)', description: 'Até 50 trabalhadores calcula de imediato; acima disso enfileira no worker (estado QUEUED) e notifica ao terminar.' })
  calculateRun(@Param() { id }: IdParam) {
    return this.calculate.execute(id);
  }

  @Post('runs/:id/submit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submeter para aprovação', description: 'Recusa com alertas bloqueantes. Quem calculou não pode aprovar.' })
  submitRun(@Param() { id }: IdParam) {
    return this.submit.execute(id);
  }

  @Post('runs/:id/mark-paid')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marcar como paga', description: 'Normalmente automático quando os lotes de pagamento são reconciliados.' })
  markPaid(@Param() { id }: IdParam) {
    return this.closing.markPaid(id);
  }

  @Post('runs/:id/close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Fechar processamento', description: 'Uma folha fechada nunca é reaberta; correcções vão para uma folha complementar.' })
  close(@Param() { id }: IdParam) {
    return this.closing.close(id);
  }

  @Get('runs/:id/payslips')
  @ApiOperation({ summary: 'Recibos do processamento' })
  runPayslips(@Param() { id }: IdParam, @Query() query: SearchQuery) {
    return this.payslips.listForRun(id, query.q);
  }
}

@ApiTags('Folha de pagamento')
@ApiCookieAuth()
@Controller('payslips')
export class PayslipsController {
  constructor(private readonly payslips: PayslipsService) {}

  @Get('mine')
  @ApiTags('Portal')
  @ApiOperation({ summary: 'Os meus recibos (folhas aprovadas)' })
  mine() {
    return this.payslips.mine();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Recibo com linhas e rasto de cálculo' })
  get(@Param() { id }: IdParam) {
    return this.payslips.get(id);
  }

  @Get(':id/pdf')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Recibo em PDF' })
  async pdf(@Param() { id }: IdParam) {
    const { buffer, fileName } = await this.payslips.pdf(id);
    return new StreamableFile(buffer, { type: 'application/pdf', disposition: `inline; filename="${fileName}"` });
  }

  @Post(':id/send')
  @HttpCode(200)
  @ApiOperation({ summary: 'Enviar recibo por e-mail (PDF em anexo)' })
  send(@Param() { id }: IdParam) {
    return this.payslips.send(id);
  }
}

@ApiTags('Folha de pagamento')
@ApiCookieAuth()
@Controller()
export class PayrollConfigController {
  constructor(private readonly config: PayrollConfigService) {}

  @Get('pay-items')
  @ApiOperation({ summary: 'Rubricas' })
  payItems() {
    return this.config.listPayItems();
  }

  @Get('pay-items/formula-reference')
  @ApiOperation({ summary: 'Variáveis e funções disponíveis nas fórmulas' })
  formulaReference() {
    return this.config.formulaReference();
  }

  @Post('pay-items')
  @ApiOperation({ summary: 'Criar rubrica', description: 'A fórmula é validada na gravação.' })
  createPayItem(@Body() body: PayItemDto) {
    return this.config.createPayItem(body);
  }

  @Patch('pay-items/:id')
  @ApiOperation({ summary: 'Editar rubrica' })
  updatePayItem(@Param() { id }: IdParam, @Body() body: UpdatePayItemDto) {
    return this.config.updatePayItem(id, body);
  }

  @Delete('pay-items/:id')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiOperation({ summary: 'Arquivar rubrica' })
  async archivePayItem(@Param() { id }: IdParam) {
    await this.config.archivePayItem(id);
  }

  @Get('legal-tables')
  @ApiOperation({ summary: 'Tabelas legais versionadas (IRT, Segurança Social, salário mínimo, feriados…)' })
  legalTables(@Query() query: LegalTableQuery) {
    return this.config.listLegalTables(query.kind);
  }

  @Post('legal-tables')
  @ApiOperation({ summary: 'Publicar nova versão de tabela legal (da empresa)', description: 'A versão anterior termina na véspera. Cada processamento guarda as versões usadas.' })
  publishLegalTable(@Body() body: LegalTableDto) {
    return this.config.publishLegalTable(body);
  }
}

@ApiTags('Compensação')
@ApiCookieAuth()
@Controller()
export class CompensationController {
  constructor(
    private readonly loans: LoansService,
    private readonly expenses: ExpensesService,
    private readonly benefits: BenefitsService,
  ) {}

  @Get('loans')
  @ApiOperation({ summary: 'Adiantamentos, empréstimos e penhoras', description: 'Sem `compensation.read` devolve apenas os do próprio.' })
  listLoans() {
    return this.loans.list();
  }

  @Post('loans')
  @ApiOperation({ summary: 'Pedir adiantamento/empréstimo ou registar penhora', description: 'Penhoras entram activas; os restantes seguem o fluxo de aprovação. As prestações respeitam o limite impenhorável.' })
  createLoan(@Body() body: LoanDto) {
    return this.loans.create(body);
  }

  @Get('expense-claims')
  @ApiOperation({ summary: 'Pedidos de reembolso' })
  listExpenses(@Query() query: ExpenseQuery) {
    return this.expenses.list(query.status);
  }

  @Post('expense-claims')
  @UseInterceptors(FileInterceptor('receipt', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ schema: { type: 'object', properties: { receipt: { type: 'string', format: 'binary' }, category: { type: 'string' }, description: { type: 'string' }, amount: { type: 'string' }, date: { type: 'string', format: 'date' } } } })
  @ApiOperation({ summary: 'Pedir reembolso (com comprovativo)', description: 'Aprovados, são pagos na folha seguinte (rubrica R051, não tributável).' })
  createExpense(@Body() body: ExpenseDto, @UploadedFile() receipt?: { buffer: Buffer; mimetype: string; originalname: string }) {
    return this.expenses.create(body, receipt);
  }

  @Get('expense-claims/:id/receipt')
  @ApiProduces('application/octet-stream')
  @ApiOperation({ summary: 'Descarregar comprovativo' })
  async receipt(@Param() { id }: IdParam) {
    const file = await this.expenses.receipt(id);
    return new StreamableFile(file.body, { type: file.contentType, disposition: `attachment; filename="${file.fileName}"` });
  }

  @Get('benefits')
  @ApiOperation({ summary: 'Benefícios e subsídios com número de abrangidos' })
  listBenefits() {
    return this.benefits.list();
  }

  @Post('benefits/:id/assign')
  @HttpCode(200)
  @ApiOperation({ summary: 'Atribuir benefício a trabalhadores', description: 'Cria ou actualiza a rubrica fixa no contrato vigente.' })
  assign(@Param() { id }: IdParam, @Body() body: AssignBenefitDto) {
    return this.benefits.assign(id, body);
  }

  @Delete('benefits/:id/employees/:employeeId')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiOperation({ summary: 'Retirar benefício a um trabalhador' })
  async unassign(@Param() params: UnassignParam) {
    await this.benefits.unassign(params.id, params.employeeId);
  }
}
