import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { dateOnly, IdParam } from '@/shared/presentation/zod';

import { AttendanceQueries, CloseAttendancePeriodUseCase, ImportPunchesUseCase, PunchUseCase, RequestCorrectionUseCase } from '../application/attendance.use-cases';
import { AdjustLeaveBalanceUseCase, CancelLeaveUseCase, LeaveQueries, RequestLeaveUseCase } from '../application/leave.use-cases';
import { RegisterTimesheetUseCase, RequestOvertimeUseCase, SchedulesService, TimeRequestQueries } from '../application/requests.use-cases';

const requestStatus = z.enum(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED']);
const leaveType = z.enum(['VACATION', 'SICK', 'MARRIAGE', 'BEREAVEMENT', 'MATERNITY', 'PATERNITY', 'UNPAID', 'UNJUSTIFIED', 'OTHER_JUSTIFIED']);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).describe('HH:MM');
const currentYear = () => new Date().getUTCFullYear();

class PunchDto extends createZodDto(z.object({ latitude: z.number().optional(), longitude: z.number().optional(), idempotencyKey: z.string().max(100).optional().describe('Evita marcações duplicadas em re-envios') })) {}
class ImportPunchesDto extends createZodDto(
  z.object({
    records: z
      .array(z.object({ employeeId: z.uuid(), timestamp: z.iso.datetime({ offset: true }), type: z.enum(['IN', 'OUT']), source: z.enum(['KIOSK', 'BIOMETRIC', 'API', 'MANUAL']), idempotencyKey: z.string().max(100) }))
      .min(1)
      .max(5000),
  }),
) {}
class TodayDto extends createZodDto(z.object({ establishmentId: z.uuid().optional(), date: dateOnly.optional() })) {}
class CorrectionDto extends createZodDto(z.object({ employeeId: z.uuid().optional().describe('Omitir para o próprio'), date: dateOnly, type: z.enum(['IN', 'OUT']), time, reason: z.string().min(3) })) {}
class CorrectionsQuery extends createZodDto(z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() })) {}
class PeriodParam extends createZodDto(z.object({ year: z.coerce.number().int().min(2000).max(2100), month: z.coerce.number().int().min(1).max(12) })) {}

class LeaveDto extends createZodDto(
  z.object({ employeeId: z.uuid().optional().describe('Omitir para o próprio'), type: leaveType, startDate: dateOnly, endDate: dateOnly, reason: z.string().optional(), documentId: z.uuid().optional() }),
) {}
class LeaveQuery extends createZodDto(z.object({ status: requestStatus.optional(), employeeId: z.uuid().optional(), year: z.coerce.number().int().optional() })) {}
class CalendarYearQuery extends createZodDto(z.object({ year: z.coerce.number().int().min(2000).max(2100).default(currentYear) })) {}
class BalanceParam extends createZodDto(z.object({ employeeId: z.uuid(), year: z.coerce.number().int() })) {}
class AdjustBalanceDto extends createZodDto(z.object({ entitledDays: z.number().int().min(0), carriedOver: z.number().int().min(0), taken: z.number().int().min(0), scheduled: z.number().int().min(0) }).partial()) {}

class OvertimeDto extends createZodDto(
  z.object({ employeeId: z.uuid().optional(), date: dateOnly, minutes: z.number().int().min(15).max(720), kind: z.enum(['WEEKDAY', 'REST_DAY', 'HOLIDAY', 'NIGHT']), reason: z.string().min(3) }),
) {}
class OvertimeQuery extends createZodDto(z.object({ status: requestStatus.optional(), year: z.coerce.number().int().default(currentYear), month: z.coerce.number().int().min(1).max(12).default(() => new Date().getUTCMonth() + 1) })) {}
class TimesheetDto extends createZodDto(z.object({ employeeId: z.uuid().optional(), weekStart: dateOnly, project: z.string().min(2), hours: z.number().min(0.5).max(84), notes: z.string().optional() })) {}
class StatusQuery extends createZodDto(z.object({ status: requestStatus.optional() })) {}

const scheduleSchema = z.object({
  name: z.string().min(2),
  type: z.enum(['FIXED', 'FLEXIBLE', 'SHIFT', 'ROTATION']).optional(),
  weeklyHours: z.number().min(1).max(60),
  startTime: time.optional(),
  endTime: time.optional(),
  days: z.array(z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])).optional(),
  toleranceMinutes: z.number().int().min(0).max(60).optional(),
});
class ScheduleDto extends createZodDto(scheduleSchema) {}
class UpdateScheduleDto extends createZodDto(scheduleSchema.partial()) {}
class RosterQuery extends createZodDto(z.object({ weekStart: dateOnly.describe('Segunda-feira da semana'), establishmentId: z.uuid().optional() })) {}
class AssignShiftsDto extends createZodDto(z.object({ assignments: z.array(z.object({ employeeId: z.uuid(), date: dateOnly, shift: z.enum(['MORNING', 'AFTERNOON', 'NIGHT', 'OFF']) })).min(1).max(1000) })) {}

@ApiTags('Assiduidade')
@ApiCookieAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly punch: PunchUseCase,
    private readonly importPunches: ImportPunchesUseCase,
    private readonly queries: AttendanceQueries,
    private readonly correction: RequestCorrectionUseCase,
    private readonly closePeriod: CloseAttendancePeriodUseCase,
  ) {}

  @Post('punch')
  @ApiOperation({ summary: 'Marcar entrada/saída (próprio)', description: 'Alterna entre entrada e saída no dia. Idempotente com `idempotencyKey`.' })
  clock(@Body() body: PunchDto, @Req() request: Request) {
    return this.punch.execute(body, request.headers['user-agent']);
  }

  @Post('records')
  @ApiOperation({ summary: 'Importar marcações (biométrico, quiosque, API)', description: 'Até 5000 por pedido; duplicados (mesma `idempotencyKey`) são ignorados.' })
  records(@Body() body: ImportPunchesDto) {
    return this.importPunches.execute(body.records);
  }

  @Get('today')
  @ApiOperation({ summary: 'Painel do dia', description: 'Presentes, atrasos (com tolerância do horário), ausentes e de licença.' })
  today(@Query() query: TodayDto) {
    return this.queries.today(query);
  }

  @Get('me')
  @ApiOperation({ summary: 'As minhas marcações (30 dias)' })
  mine() {
    return this.queries.myHistory();
  }

  @Get('corrections')
  @ApiOperation({ summary: 'Pedidos de correcção de ponto' })
  corrections(@Query() query: CorrectionsQuery) {
    return this.queries.corrections(query.status);
  }

  @Post('corrections')
  @ApiOperation({ summary: 'Pedir correcção de ponto', description: 'Segue o fluxo de aprovação; ao aprovar cria a marcação manual.' })
  requestCorrection(@Body() body: CorrectionDto) {
    return this.correction.execute(body);
  }

  @Get('periods/:year/:month')
  @ApiOperation({ summary: 'Estado do período de assiduidade' })
  period(@Param() params: PeriodParam) {
    return this.queries.period(params.year, params.month);
  }

  @Post('periods/:year/:month/close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Fechar o período', description: 'Bloqueia novas correcções e envia faltas e horas extra para a folha. Recusa se houver correcções pendentes.' })
  close(@Param() params: PeriodParam) {
    return this.closePeriod.execute(params.year, params.month);
  }
}

@ApiTags('Férias e faltas')
@ApiCookieAuth()
@Controller()
export class LeaveController {
  constructor(
    private readonly request: RequestLeaveUseCase,
    private readonly cancel: CancelLeaveUseCase,
    private readonly queries: LeaveQueries,
    private readonly adjust: AdjustLeaveBalanceUseCase,
  ) {}

  @Get('leave-requests')
  @ApiOperation({ summary: 'Pedidos de férias, faltas e licenças', description: 'RH vê a empresa; a chefia vê a equipa; o trabalhador vê os seus.' })
  list(@Query() query: LeaveQuery) {
    return this.queries.requests(query);
  }

  @Post('leave-requests')
  @ApiOperation({ summary: 'Registar ausência', description: 'Conta dias úteis (sem fins-de-semana e feriados), valida saldo e sobreposições e envia para aprovação.' })
  create(@Body() body: LeaveDto) {
    return this.request.execute(body);
  }

  @Delete('leave-requests/:id')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiOperation({ summary: 'Cancelar pedido pendente' })
  async remove(@Param() { id }: IdParam) {
    await this.cancel.execute(id);
  }

  @Get('leave-balances')
  @ApiOperation({ summary: 'Saldos de férias do ano' })
  balances(@Query() query: CalendarYearQuery) {
    return this.queries.balances(query.year);
  }

  @Patch('leave-balances/:employeeId/:year')
  @ApiOperation({ summary: 'Ajustar saldo de férias', description: 'Registado na auditoria.' })
  adjustBalance(@Param() params: BalanceParam, @Body() body: AdjustBalanceDto) {
    return this.adjust.execute(params.employeeId, params.year, body);
  }

  @Get('leave-map')
  @ApiOperation({ summary: 'Mapa de férias (meses com férias aprovadas por trabalhador)' })
  map(@Query() query: CalendarYearQuery) {
    return this.queries.map(query.year);
  }
}

@ApiTags('Horas extra')
@ApiCookieAuth()
@Controller('overtime')
export class OvertimeController {
  constructor(
    private readonly request: RequestOvertimeUseCase,
    private readonly queries: TimeRequestQueries,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Horas extra do mês com total por trabalhador e limite legal' })
  list(@Query() query: OvertimeQuery) {
    return this.queries.overtime(query);
  }

  @Post()
  @ApiOperation({ summary: 'Registar horas extra', description: 'Indica se o total do mês excede o limite da tabela legal `OVERTIME_RATES`.' })
  create(@Body() body: OvertimeDto) {
    return this.request.execute(body);
  }
}

@ApiTags('Folhas de horas')
@ApiCookieAuth()
@Controller('timesheets')
export class TimesheetsController {
  constructor(
    private readonly register: RegisterTimesheetUseCase,
    private readonly queries: TimeRequestQueries,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Folhas de horas' })
  list(@Query() query: StatusQuery) {
    return this.queries.timesheets(query.status);
  }

  @Post()
  @ApiOperation({ summary: 'Submeter folha de horas' })
  create(@Body() body: TimesheetDto) {
    return this.register.execute(body);
  }
}

@ApiTags('Escalas')
@ApiCookieAuth()
@Controller()
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get('schedules')
  @ApiOperation({ summary: 'Horários de trabalho' })
  list() {
    return this.schedules.list();
  }

  @Post('schedules')
  @ApiOperation({ summary: 'Criar horário' })
  create(@Body() body: ScheduleDto) {
    return this.schedules.create(body);
  }

  @Patch('schedules/:id')
  @ApiOperation({ summary: 'Editar horário' })
  update(@Param() { id }: IdParam, @Body() body: UpdateScheduleDto) {
    return this.schedules.update(id, body);
  }

  @Delete('schedules/:id')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiOperation({ summary: 'Arquivar horário' })
  async archive(@Param() { id }: IdParam) {
    await this.schedules.archive(id);
  }

  @Get('shifts')
  @ApiOperation({ summary: 'Escala semanal de turnos' })
  roster(@Query() query: RosterQuery) {
    return this.schedules.roster(query.weekStart, query.establishmentId);
  }

  @Put('shifts')
  @ApiOperation({ summary: 'Atribuir turnos', description: 'Cria ou substitui o turno de cada trabalhador em cada dia.' })
  assign(@Body() body: AssignShiftsDto) {
    return this.schedules.assign(body.assignments);
  }
}
