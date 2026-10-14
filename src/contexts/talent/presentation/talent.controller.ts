import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { dateOnly, IdParam } from '@/shared/presentation/zod';

import { PerformanceService, TrainingService } from '../application/talent.service';

class CycleDto extends createZodDto(z.object({ name: z.string().min(3), startDate: dateOnly, endDate: dateOnly, orgUnitId: z.uuid().optional().describe('Omitir para toda a empresa'), selfAssessment: z.boolean().optional() })) {}
class CycleStatusDto extends createZodDto(z.object({ status: z.enum(['SCHEDULED', 'ACTIVE', 'CLOSED']) })) {}
class ReviewDto extends createZodDto(z.object({ performance: z.number().int().min(1).max(3), potential: z.number().int().min(1).max(3), comments: z.string().optional() })) {}
class GoalDto extends createZodDto(z.object({ employeeId: z.uuid(), title: z.string().min(3), dueDate: dateOnly })) {}
class GoalProgressDto extends createZodDto(z.object({ progress: z.number().int().min(0).max(100) })) {}
class GoalsQuery extends createZodDto(z.object({ employeeId: z.uuid().optional() })) {}
class FeedbackDto extends createZodDto(z.object({ toEmployeeId: z.uuid(), kind: z.enum(['Reconhecimento', 'Sugestão']), value: z.string().optional(), message: z.string().min(3).max(2000), isPublic: z.boolean().optional() })) {}
class TrainingDto extends createZodDto(z.object({ title: z.string().min(3), provider: z.string().min(2), date: dateOnly, hours: z.number().int().min(1), seats: z.number().int().min(1), mandatory: z.boolean().optional() })) {}
class EnrollDto extends createZodDto(z.object({ employeeIds: z.array(z.uuid()).min(1) })) {}
class AttendanceDto extends createZodDto(z.object({ attended: z.boolean(), certificateExpiresAt: dateOnly.nullable().optional() })) {}

@ApiTags('Desempenho')
@ApiCookieAuth()
@Controller()
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Get('review-cycles')
  @ApiOperation({ summary: 'Ciclos de avaliação com progresso' })
  cycles() {
    return this.performance.cycles();
  }

  @Post('review-cycles')
  @ApiOperation({ summary: 'Criar ciclo', description: 'Cria uma avaliação por participante, atribuída à chefia directa.' })
  createCycle(@Body() body: CycleDto) {
    return this.performance.createCycle(body);
  }

  @Put('review-cycles/:id/status')
  @ApiOperation({ summary: 'Abrir ou fechar ciclo' })
  status(@Param() { id }: IdParam, @Body() body: CycleStatusDto) {
    return this.performance.setCycleStatus(id, body.status);
  }

  @Get('review-cycles/:id/reviews')
  @ApiOperation({ summary: 'Avaliações do ciclo (a chefia vê as que lhe cabem)' })
  reviews(@Param() { id }: IdParam) {
    return this.performance.reviews(id);
  }

  @Get('review-cycles/:id/nine-box')
  @ApiOperation({ summary: 'Matriz 9-box (desempenho × potencial)' })
  nineBox(@Param() { id }: IdParam) {
    return this.performance.nineBox(id);
  }

  @Put('reviews/:id')
  @ApiOperation({ summary: 'Registar avaliação (desempenho e potencial de 1 a 3)' })
  review(@Param() { id }: IdParam, @Body() body: ReviewDto) {
    return this.performance.submitReview(id, body);
  }

  @Get('goals')
  @ApiOperation({ summary: 'Objectivos' })
  goals(@Query() query: GoalsQuery) {
    return this.performance.goals(query.employeeId);
  }

  @Post('goals')
  @ApiOperation({ summary: 'Definir objectivo (chefia ou RH)' })
  createGoal(@Body() body: GoalDto) {
    return this.performance.createGoal(body);
  }

  @Patch('goals/:id')
  @ApiOperation({ summary: 'Actualizar progresso do objectivo' })
  progress(@Param() { id }: IdParam, @Body() body: GoalProgressDto) {
    return this.performance.updateGoalProgress(id, body.progress);
  }

  @Get('feedback')
  @ApiOperation({ summary: 'Feedback e reconhecimento' })
  feedback() {
    return this.performance.feedback();
  }

  @Post('feedback')
  @ApiOperation({ summary: 'Dar feedback' })
  give(@Body() body: FeedbackDto) {
    return this.performance.giveFeedback(body);
  }
}

@ApiTags('Formação')
@ApiCookieAuth()
@Controller('trainings')
export class TrainingController {
  constructor(private readonly training: TrainingService) {}

  @Get()
  @ApiOperation({ summary: 'Acções de formação' })
  list() {
    return this.training.list();
  }

  @Post()
  @ApiOperation({ summary: 'Criar acção de formação' })
  create(@Body() body: TrainingDto) {
    return this.training.create(body);
  }

  @Get('certificates/expiring')
  @ApiOperation({ summary: 'Certificados a expirar (90 dias)' })
  expiring() {
    return this.training.expiringCertificates();
  }

  @Get(':id/enrollments')
  @ApiOperation({ summary: 'Inscritos' })
  enrollments(@Param() { id }: IdParam) {
    return this.training.enrollments(id);
  }

  @Post(':id/enrollments')
  @ApiOperation({ summary: 'Inscrever trabalhadores', description: 'Acima das vagas ficam em lista de espera.' })
  enroll(@Param() { id }: IdParam, @Body() body: EnrollDto) {
    return this.training.enroll(id, body.employeeIds);
  }

  @Patch('enrollments/:id')
  @ApiOperation({ summary: 'Registar presença e validade do certificado' })
  attendance(@Param() { id }: IdParam, @Body() body: AttendanceDto) {
    return this.training.recordAttendance(id, body);
  }
}
