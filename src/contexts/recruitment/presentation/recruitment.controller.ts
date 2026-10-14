
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { Public } from '@/shared/presentation/decorators';
import { IdParam } from '@/shared/presentation/zod';

import { type CvFile, RecruitmentService } from '../application/recruitment.service';

const jobSchema = z.object({
  title: z.string().min(2),
  orgUnitId: z.uuid().optional(),
  establishmentId: z.uuid().optional(),
  location: z.string().min(2),
  workRegime: z.string().describe('Tempo inteiro, Tempo parcial, Estágio…'),
  openings: z.number().int().min(1).optional(),
  description: z.string().min(10),
  publish: z.boolean().optional().describe('Publicar na página de carreiras (omissão: sim)'),
});
class JobDto extends createZodDto(jobSchema) {}
class UpdateJobDto extends createZodDto(jobSchema.omit({ publish: true }).extend({ status: z.enum(['DRAFT', 'OPEN', 'PAUSED', 'CLOSED']) }).partial()) {}
class JobsQuery extends createZodDto(z.object({ status: z.enum(['DRAFT', 'OPEN', 'PAUSED', 'CLOSED']).optional() })) {}
class CandidatesQuery extends createZodDto(z.object({ jobId: z.uuid().optional() })) {}
class UpdateCandidateDto extends createZodDto(
  z.object({
    stage: z.enum(['APPLIED', 'SCREENING', 'INTERVIEW', 'TEST', 'OFFER', 'HIRED', 'REJECTED']).optional(),
    score: z.number().int().min(1).max(5).optional(),
    notes: z.string().optional(),
    interviewAt: z.iso.datetime({ offset: true }).optional(),
    reason: z.string().optional().describe('Obrigatório ao rejeitar (interno)'),
  }),
) {}
class SlugParam extends createZodDto(z.object({ slug: z.string().min(3) })) {}
class ApplyParam extends createZodDto(z.object({ slug: z.string().min(3), jobId: z.uuid() })) {}
class ApplyDto extends createZodDto(
  z.object({
    name: z.string().min(3),
    email: z.email(),
    phone: z.string().optional(),
    consent: z.union([z.boolean(), z.enum(['true', 'false'])]).transform((value) => value === true || value === 'true').describe('Autorização de tratamento de dados (Lei n.º 22/11)'),
  }),
) {}

@ApiTags('Recrutamento')
@ApiCookieAuth()
@Controller()
export class RecruitmentController {
  constructor(private readonly recruitment: RecruitmentService) {}

  @Get('jobs')
  @ApiOperation({ summary: 'Vagas com número de candidatos' })
  jobs(@Query() query: JobsQuery) {
    return this.recruitment.jobs(query.status);
  }

  @Post('jobs')
  @ApiOperation({ summary: 'Criar vaga' })
  createJob(@Body() body: JobDto) {
    return this.recruitment.createJob(body);
  }

  @Patch('jobs/:id')
  @ApiOperation({ summary: 'Editar vaga / alterar estado' })
  updateJob(@Param() { id }: IdParam, @Body() body: UpdateJobDto) {
    return this.recruitment.updateJob(id, body);
  }

  @Get('candidates')
  @ApiOperation({ summary: 'Candidatos (quadro por fase)' })
  candidates(@Query() query: CandidatesQuery) {
    return this.recruitment.candidates(query.jobId);
  }

  @Patch('candidates/:id')
  @ApiOperation({ summary: 'Mover de fase, avaliar, agendar entrevista ou rejeitar', description: 'Rejeitar ou agendar entrevista envia e-mail ao candidato.' })
  updateCandidate(@Param() { id }: IdParam, @Body() body: UpdateCandidateDto) {
    return this.recruitment.updateCandidate(id, body);
  }

  @Get('candidates/:id/cv')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Currículo do candidato' })
  async cv(@Param() { id }: IdParam) {
    const file = await this.recruitment.cv(id);
    return new StreamableFile(file.body, { type: file.contentType, disposition: `attachment; filename="${file.fileName}"` });
  }
}

@ApiTags('Público')
@Controller('public/careers')
export class CareersController {
  constructor(private readonly recruitment: RecruitmentService) {}

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Página de carreiras: vagas abertas da empresa' })
  jobs(@Param() { slug }: SlugParam) {
    return this.recruitment.publicJobs(slug);
  }

  @Public()
  @Post(':slug/jobs/:jobId/applications')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('cv', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['name', 'email', 'consent', 'cv'], properties: { name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, consent: { type: 'boolean' }, cv: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Candidatar-me', description: 'Currículo em PDF (até 5 MB) e consentimento obrigatórios.' })
  apply(@Param() params: ApplyParam, @Body() body: ApplyDto, @UploadedFile() cv?: CvFile) {
    return this.recruitment.apply(params.slug, params.jobId, body, cv);
  }
}
