import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { IdParam } from '@/shared/presentation/zod';

import { OrganizationService } from '../application/organization.service';

class UpdateCompanyDto extends createZodDto(
  z.object({
    legalName: z.string().min(2).optional(),
    tradeName: z.string().min(2).optional(),
    nif: z.string().regex(/^\d{10}$/).optional(),
    socialSecurityNumber: z.string().nullable().optional().describe('N.º de contribuinte do INSS'),
    activityCode: z.string().nullable().optional().describe('CAE'),
    province: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    careersSlug: z.string().regex(/^[a-z0-9-]{3,60}$/).nullable().optional().describe('Endereço da página de carreiras'),
  }),
) {}

const establishmentSchema = z.object({
  name: z.string().min(2),
  province: z.string().optional(),
  address: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  geoPunch: z.boolean().optional().describe('Exigir geolocalização no ponto'),
});
class CreateEstablishmentDto extends createZodDto(establishmentSchema) {}
class UpdateEstablishmentDto extends createZodDto(establishmentSchema.partial()) {}

const orgUnitSchema = z.object({
  name: z.string().min(2),
  kind: z.enum(['DIRECTORATE', 'DEPARTMENT', 'SECTION']).optional(),
  parentId: z.uuid().optional(),
  headEmployeeId: z.uuid().optional(),
  costCenterId: z.uuid().optional(),
});
class CreateOrgUnitDto extends createZodDto(orgUnitSchema) {}
class UpdateOrgUnitDto extends createZodDto(orgUnitSchema.extend({ parentId: z.uuid().nullable(), headEmployeeId: z.uuid().nullable(), costCenterId: z.uuid().nullable() }).partial()) {}

const costCenterSchema = z.object({ code: z.string().min(1).max(20), name: z.string().min(2) });
class CreateCostCenterDto extends createZodDto(costCenterSchema) {}
class UpdateCostCenterDto extends createZodDto(costCenterSchema.partial()) {}

const positionSchema = z.object({ title: z.string().min(2), orgUnitId: z.uuid().optional(), grade: z.string().optional() });
class CreatePositionDto extends createZodDto(positionSchema) {}
class UpdatePositionDto extends createZodDto(positionSchema.extend({ orgUnitId: z.uuid().nullable(), grade: z.string().nullable() }).partial()) {}

@ApiTags('Organização')
@ApiCookieAuth()
@Controller()
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  @Get('companies')
  @ApiOperation({
    summary: 'Empresas da conta',
    description: 'As empresas que o utilizador pode abrir (`current` marca a da sessão). Mudar de empresa: `POST /v1/auth/company`.',
  })
  companies() {
    return this.organization.listCompanies();
  }

  @Get('company')
  @ApiOperation({ summary: 'Empresa actual' })
  company() {
    return this.organization.getCompany();
  }

  @Patch('company')
  @ApiOperation({ summary: 'Actualizar dados da entidade empregadora', description: 'Permissão: `settings.write`.' })
  updateCompany(@Body() body: UpdateCompanyDto) {
    return this.organization.updateCompany(body);
  }

  @Get('reference-data')
  @ApiOperation({ summary: 'Bancos e províncias/municípios' })
  reference() {
    return this.organization.referenceData();
  }

  @Get('establishments')
  @ApiOperation({ summary: 'Estabelecimentos' })
  establishments() {
    return this.organization.listEstablishments();
  }

  @Post('establishments')
  @ApiOperation({ summary: 'Criar estabelecimento' })
  createEstablishment(@Body() body: CreateEstablishmentDto) {
    return this.organization.createEstablishment(body);
  }

  @Patch('establishments/:id')
  @ApiOperation({ summary: 'Editar estabelecimento' })
  updateEstablishment(@Param() { id }: IdParam, @Body() body: UpdateEstablishmentDto) {
    return this.organization.updateEstablishment(id, body);
  }

  @Delete('establishments/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Arquivar estabelecimento' })
  @ApiNoContentResponse()
  async archiveEstablishment(@Param() { id }: IdParam) {
    await this.organization.archiveEstablishment(id);
  }

  @Get('org-units')
  @ApiOperation({ summary: 'Unidades orgânicas (direcções, departamentos, secções) com efectivo' })
  orgUnits() {
    return this.organization.listOrgUnits();
  }

  @Post('org-units')
  @ApiOperation({ summary: 'Criar unidade orgânica' })
  createOrgUnit(@Body() body: CreateOrgUnitDto) {
    return this.organization.createOrgUnit(body);
  }

  @Patch('org-units/:id')
  @ApiOperation({ summary: 'Editar unidade orgânica' })
  updateOrgUnit(@Param() { id }: IdParam, @Body() body: UpdateOrgUnitDto) {
    return this.organization.updateOrgUnit(id, body);
  }

  @Delete('org-units/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Arquivar unidade orgânica' })
  @ApiNoContentResponse()
  async archiveOrgUnit(@Param() { id }: IdParam) {
    await this.organization.archiveOrgUnit(id);
  }

  @Get('cost-centers')
  @ApiOperation({ summary: 'Centros de custo' })
  costCenters() {
    return this.organization.listCostCenters();
  }

  @Post('cost-centers')
  @ApiOperation({ summary: 'Criar centro de custo' })
  createCostCenter(@Body() body: CreateCostCenterDto) {
    return this.organization.createCostCenter(body);
  }

  @Patch('cost-centers/:id')
  @ApiOperation({ summary: 'Editar centro de custo' })
  updateCostCenter(@Param() { id }: IdParam, @Body() body: UpdateCostCenterDto) {
    return this.organization.updateCostCenter(id, body);
  }

  @Delete('cost-centers/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Arquivar centro de custo' })
  @ApiNoContentResponse()
  async archiveCostCenter(@Param() { id }: IdParam) {
    await this.organization.archiveCostCenter(id);
  }

  @Get('positions')
  @ApiOperation({ summary: 'Cargos com número de ocupantes' })
  positions() {
    return this.organization.listPositions();
  }

  @Post('positions')
  @ApiOperation({ summary: 'Criar cargo' })
  createPosition(@Body() body: CreatePositionDto) {
    return this.organization.createPosition(body);
  }

  @Patch('positions/:id')
  @ApiOperation({ summary: 'Editar cargo' })
  updatePosition(@Param() { id }: IdParam, @Body() body: UpdatePositionDto) {
    return this.organization.updatePosition(id, body);
  }

  @Delete('positions/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Arquivar cargo' })
  @ApiNoContentResponse()
  async archivePosition(@Param() { id }: IdParam) {
    await this.organization.archivePosition(id);
  }
}
