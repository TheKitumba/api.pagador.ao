import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { dateOnly, IdParam } from '@/shared/presentation/zod';

import { DisciplinaryService, SafetyService } from '../application/employee-relations.service';

class OpenCaseDto extends createZodDto(z.object({ employeeId: z.uuid(), instructorId: z.uuid().optional(), infraction: z.string().min(3), facts: z.string().min(10), incidentDate: dateOnly })) {}
class AdvanceCaseDto extends createZodDto(z.object({ stage: z.string().min(3).describe('Ex.: Nota de culpa, Resposta do trabalhador, Decisão'), deadline: dateOnly.nullable().optional(), decision: z.string().optional(), close: z.boolean().optional() })) {}
class ExamDto extends createZodDto(z.object({ employeeId: z.uuid(), kind: z.string().min(3).describe('Admissão, Periódico, Ocasional'), dueDate: dateOnly })) {}
class ExamResultDto extends createZodDto(z.object({ doneAt: dateOnly, result: z.string().optional() })) {}
class AccidentDto extends createZodDto(
  z.object({ employeeId: z.uuid(), date: dateOnly, location: z.string().min(2), severity: z.enum(['MINOR', 'MODERATE', 'SEVERE']), daysLost: z.number().int().min(0).optional(), description: z.string().min(10) }),
) {}

@ApiTags('Relações laborais')
@ApiCookieAuth()
@Controller()
export class EmployeeRelationsController {
  constructor(
    private readonly disciplinary: DisciplinaryService,
    private readonly safety: SafetyService,
  ) {}

  @Get('disciplinary-cases')
  @ApiOperation({ summary: 'Processos disciplinares', description: 'Permissão explícita `disciplinary.read`.' })
  cases() {
    return this.disciplinary.list();
  }

  @Post('disciplinary-cases')
  @ApiOperation({ summary: 'Abrir processo disciplinar' })
  open(@Body() body: OpenCaseDto) {
    return this.disciplinary.open(body);
  }

  @Patch('disciplinary-cases/:id')
  @ApiOperation({ summary: 'Avançar fase / decidir / encerrar' })
  advance(@Param() { id }: IdParam, @Body() body: AdvanceCaseDto) {
    return this.disciplinary.advance(id, body);
  }

  @Get('medical-exams')
  @ApiOperation({ summary: 'Exames médicos (agendados, em atraso, realizados)' })
  exams() {
    return this.safety.exams();
  }

  @Post('medical-exams')
  @ApiOperation({ summary: 'Agendar exame médico' })
  scheduleExam(@Body() body: ExamDto) {
    return this.safety.scheduleExam(body);
  }

  @Patch('medical-exams/:id')
  @ApiOperation({ summary: 'Registar realização do exame' })
  recordExam(@Param() { id }: IdParam, @Body() body: ExamResultDto) {
    return this.safety.recordExam(id, body);
  }

  @Get('accidents')
  @ApiOperation({ summary: 'Acidentes de trabalho e dias sem acidentes' })
  accidents() {
    return this.safety.accidents();
  }

  @Post('accidents')
  @ApiOperation({ summary: 'Registar acidente de trabalho' })
  report(@Body() body: AccidentDto) {
    return this.safety.reportAccident(body);
  }

  @Post('accidents/:id/reported')
  @ApiOperation({ summary: 'Marcar como participado à seguradora' })
  reported(@Param() { id }: IdParam) {
    return this.safety.markReported(id);
  }
}
