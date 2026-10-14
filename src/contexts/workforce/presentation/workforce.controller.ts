import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Put, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiNoContentResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';

import { toCsv } from '@/shared/application/csv';
import { IdParam } from '@/shared/presentation/zod';

import { ContractorInvoicesService } from '../application/contractor-invoices.service';
import { ConfirmProbationUseCase, ContractQueries, CreateContractUseCase, RenewContractUseCase } from '../application/contracts.use-cases';
import { EmployeeDocumentsService, type UploadedFile as File } from '../application/documents.service';
import { ChangeBankAccountUseCase, EmployeeQueries, HireEmployeeUseCase, UpdateEmployeeUseCase } from '../application/employees.use-cases';
import { ImportEmployeesUseCase } from '../application/import-employees.use-case';
import { NotRenewContractUseCase, StartTerminationUseCase, TerminationQueries } from '../application/terminations.use-cases';
import {
  BankAccountDto,
  ConfirmProbationDto,
  ContractAlertsDto,
  CreateContractDto,
  CreateInvoiceDto,
  HireEmployeeDto,
  ImportQueryDto,
  InvoiceStatusQuery,
  ListEmployeesDto,
  NonRenewalDto,
  RenewContractDto,
  StartTerminationDto,
  UpdateEmployeeDto,
  UploadDocumentDto,
} from './dto';

const fileBody = (extra: Record<string, object> = {}) => ({
  schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, ...extra } },
});

@ApiTags('Trabalhadores')
@ApiCookieAuth()
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly queries: EmployeeQueries,
    private readonly hire: HireEmployeeUseCase,
    private readonly update: UpdateEmployeeUseCase,
    private readonly bankAccount: ChangeBankAccountUseCase,
    private readonly documents: EmployeeDocumentsService,
    private readonly importer: ImportEmployeesUseCase,
    private readonly contracts: ContractQueries,
    private readonly createContract: CreateContractUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar trabalhadores', description: 'Gestor/Técnico de RH vêem a empresa; a chefia directa vê apenas a equipa. O vencimento só é devolvido com `employees.sensitive`.' })
  list(@Query() query: ListEmployeesDto) {
    return this.queries.list(query);
  }

  @Post()
  @ApiOperation({ summary: 'Admitir trabalhador', description: 'Cria o trabalhador, o contrato, a conta bancária e o saldo de férias. Valida BI, NIF, telemóvel e IBAN. Evento `employee.created`.' })
  create(@Body() body: HireEmployeeDto) {
    return this.hire.execute(body);
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="trabalhadores.csv"')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Exportar trabalhadores (CSV)' })
  async export() {
    return toCsv(await this.queries.exportRows());
  }

  @Get('import/template.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="modelo-trabalhadores.csv"')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Modelo de importação (CSV)' })
  template() {
    return `﻿${this.importer.template()}`;
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileBody())
  @ApiOperation({ summary: 'Importar trabalhadores (CSV)', description: 'Com `dryRun=true` (omissão) apenas valida e devolve os erros por linha.' })
  import(@UploadedFile() file: File | undefined, @Query() query: ImportQueryDto) {
    return this.importer.execute(file?.buffer.toString('utf8') ?? '', query.dryRun === 'true');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ficha do trabalhador' })
  get(@Param() { id }: IdParam) {
    return this.queries.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar dados do trabalhador', description: 'Registado na auditoria. Evento `employee.updated`.' })
  patch(@Param() { id }: IdParam, @Body() body: UpdateEmployeeDto) {
    return this.update.execute(id, body);
  }

  @Put(':id/bank-account')
  @ApiOperation({ summary: 'Alterar conta bancária', description: 'Permissão `employees.sensitive`. Alterações perto do pagamento geram alerta ao aprovador financeiro.' })
  changeBank(@Param() { id }: IdParam, @Body() body: BankAccountDto) {
    return this.bankAccount.execute(id, body);
  }

  @Get(':id/contracts')
  @ApiOperation({ summary: 'Contratos do trabalhador' })
  employeeContracts(@Param() { id }: IdParam) {
    return this.contracts.forEmployee(id);
  }

  @Post(':id/contracts')
  @ApiOperation({ summary: 'Novo contrato ou adenda', description: 'Termina o contrato vigente no dia anterior ao início do novo.' })
  newContract(@Param() { id }: IdParam, @Body() body: CreateContractDto) {
    return this.createContract.execute(id, body);
  }

  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileBody({ category: { type: 'string' }, expiresAt: { type: 'string', format: 'date' } }))
  @ApiOperation({ summary: 'Carregar documento', description: 'PDF, JPG, PNG ou WEBP até 10 MB. Guardado no MinIO.' })
  upload(@Param() { id }: IdParam, @UploadedFile() file: File | undefined, @Body() body: UploadDocumentDto) {
    return this.documents.upload(id, file, body);
  }
}

@ApiTags('Trabalhadores')
@ApiCookieAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: EmployeeDocumentsService) {}

  @Get(':id/download')
  @ApiProduces('application/octet-stream')
  @ApiOperation({ summary: 'Descarregar documento' })
  async download(@Param() { id }: IdParam) {
    const file = await this.documents.download(id);
    return new StreamableFile(file.body, { type: file.contentType, disposition: `attachment; filename="${encodeURIComponent(file.fileName)}"` });
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiOperation({ summary: 'Apagar documento' })
  async remove(@Param() { id }: IdParam) {
    await this.documents.remove(id);
  }
}

@ApiTags('Contratos')
@ApiCookieAuth()
@Controller('contracts')
export class ContractsController {
  constructor(
    private readonly queries: ContractQueries,
    private readonly renew: RenewContractUseCase,
    private readonly confirmProbation: ConfirmProbationUseCase,
    private readonly notRenew: NotRenewContractUseCase,
  ) {}

  @Get('alerts')
  @ApiOperation({ summary: 'Contratos a terminar e períodos experimentais', description: 'Nos próximos `days` dias (45 por omissão).' })
  alerts(@Query() query: ContractAlertsDto) {
    return this.queries.alerts(query.days);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Contratos vigentes por tipo' })
  summary() {
    return this.queries.summary();
  }

  @Post(':id/renew')
  @HttpCode(200)
  @ApiOperation({ summary: 'Renovar contrato a termo', description: 'Acima do limite de renovações converte-se em contrato por tempo indeterminado.' })
  renewContract(@Param() { id }: IdParam, @Body() body: RenewContractDto) {
    return this.renew.execute(id, body);
  }

  @Post(':id/confirm-probation')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirmar admissão no fim do período experimental' })
  confirm(@Param() { id }: IdParam, @Body() body: ConfirmProbationDto) {
    return this.confirmProbation.execute(id, body);
  }

  @Post(':id/non-renewal')
  @HttpCode(200)
  @ApiOperation({ summary: 'Não renovar (caducidade)', description: 'Inicia a cessação por caducidade com acerto final de contas e envia para aprovação.' })
  nonRenewal(@Param() { id }: IdParam, @Body() body: NonRenewalDto) {
    return this.notRenew.execute(id, body);
  }
}

@ApiTags('Cessações')
@ApiCookieAuth()
@Controller('terminations')
export class TerminationsController {
  constructor(
    private readonly start: StartTerminationUseCase,
    private readonly queries: TerminationQueries,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Cessações' })
  list() {
    return this.queries.list();
  }

  @Post()
  @ApiOperation({ summary: 'Iniciar cessação', description: 'Calcula o acerto final (dias trabalhados, férias não gozadas, proporcionais, indemnização, aviso prévio, empréstimos) e envia para aprovação.' })
  create(@Body() body: StartTerminationDto) {
    return this.start.execute(body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe da cessação com o acerto de contas' })
  get(@Param() { id }: IdParam) {
    return this.queries.get(id);
  }
}

@ApiTags('Prestadores')
@ApiCookieAuth()
@Controller('contractor-invoices')
export class ContractorInvoicesController {
  constructor(private readonly invoices: ContractorInvoicesService) {}

  @Get()
  @ApiOperation({ summary: 'Facturas de prestadores' })
  list(@Query() query: InvoiceStatusQuery) {
    return this.invoices.list(query.status);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody(fileBody({ supplier: { type: 'string' }, number: { type: 'string' }, dueDate: { type: 'string', format: 'date' }, amount: { type: 'string' }, withholding: { type: 'boolean' } }))
  @ApiOperation({ summary: 'Registar factura', description: 'Calcula a retenção na fonte (IRT Grupo B, tabela legal `CONTRACTOR_WITHHOLDING`).' })
  create(@Body() body: CreateInvoiceDto, @UploadedFile() file?: File) {
    return this.invoices.create(body, file);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Aprovar factura' })
  approve(@Param() { id }: IdParam) {
    return this.invoices.transition(id, 'APPROVED');
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rejeitar factura' })
  reject(@Param() { id }: IdParam) {
    return this.invoices.transition(id, 'REJECTED');
  }

  @Post(':id/pay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marcar factura como paga' })
  pay(@Param() { id }: IdParam) {
    return this.invoices.transition(id, 'PAID');
  }

  @Get(':id/file')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Descarregar a factura' })
  async file(@Param() { id }: IdParam) {
    const file = await this.invoices.file(id);
    return new StreamableFile(file.body, { type: file.contentType, disposition: `attachment; filename="${file.fileName}"` });
  }
}

