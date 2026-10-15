import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { CandidateStage, JobStatus } from '@prisma/client';

import { authorize } from '@/shared/application/permissions';
import { FileStorage, Mailer } from '@/shared/application/ports';
import { BusinessRuleViolation, NotFoundError, ValidationError } from '@/shared/domain/errors';
import { AuditService } from '@/shared/infrastructure/audit/audit.service';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { OutboxService } from '@/shared/infrastructure/outbox/outbox.service';
import { Database } from '@/shared/infrastructure/prisma/database';
import { isoDate } from '@/shared/application/formatting';

const STAGE_LABEL: Record<CandidateStage, string> = { APPLIED: 'Candidatura', SCREENING: 'Triagem', INTERVIEW: 'Entrevista', TEST: 'Teste', OFFER: 'Proposta', HIRED: 'Contratado', REJECTED: 'Rejeitado' };

export interface CvFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

/** Job openings and candidate pipeline (docs/03, M03). */
@Injectable()
export class RecruitmentService {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly storage: FileStorage,
    private readonly mailer: Mailer,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async jobs(status?: JobStatus) {
    const actor = this.actors.current;
    authorize(actor, 'recruitment.read');
    const [jobs, counts] = await Promise.all([
      this.db.tx.jobOpening.findMany({ where: { companyId: actor.companyId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' } }),
      this.db.tx.candidate.groupBy({ by: ['jobId'], _count: true }),
    ]);
    const byJob = new Map(counts.map((row) => [row.jobId, row._count]));
    return jobs.map((job) => ({ ...job, candidates: byJob.get(job.id) ?? 0 }));
  }

  async createJob(input: { title: string; orgUnitId?: string; establishmentId?: string; location: string; workRegime: string; openings?: number; description: string; publish?: boolean }) {
    const actor = this.actors.current;
    authorize(actor, 'recruitment.write');
    const { publish, ...data } = input;
    const job = await this.db.tx.jobOpening.create({ data: { ...data, tenantId: actor.tenantId, companyId: actor.companyId, status: publish === false ? 'DRAFT' : 'OPEN', publishedAt: publish === false ? null : new Date() } });
    await this.audit.record({ action: 'job.create', entityType: 'job_opening', entityId: job.id, after: { title: job.title } });
    return job;
  }

  async updateJob(id: string, input: Partial<{ title: string; location: string; workRegime: string; openings: number; description: string; status: JobStatus }>) {
    const actor = this.actors.current;
    authorize(actor, 'recruitment.write');
    const job = await this.db.tx.jobOpening.findFirst({ where: { id, companyId: actor.companyId } });
    if (!job) throw new NotFoundError('Vaga', id);
    return this.db.tx.jobOpening.update({ where: { id }, data: { ...input, ...(input.status === 'OPEN' && !job.publishedAt ? { publishedAt: new Date() } : {}) } });
  }

  async candidates(jobId?: string) {
    const actor = this.actors.current;
    authorize(actor, 'recruitment.read');
    const candidates = await this.db.tx.candidate.findMany({ where: jobId ? { jobId } : {}, orderBy: { createdAt: 'desc' } });
    const jobs = await this.db.tx.jobOpening.findMany({ where: { id: { in: candidates.map((c) => c.jobId) } }, select: { id: true, title: true } });
    const titles = new Map(jobs.map((job) => [job.id, job.title]));
    return candidates.map((candidate) => ({ ...candidate, cvKey: undefined, hasCv: Boolean(candidate.cvKey), job: { id: candidate.jobId, title: titles.get(candidate.jobId) ?? null }, stageLabel: STAGE_LABEL[candidate.stage] }));
  }

  /** Job title and employer name for candidate e-mails. */
  private async jobForMail(jobId: string) {
    const job = await this.db.tx.jobOpening.findUniqueOrThrow({ where: { id: jobId }, select: { title: true, companyId: true } });
    const company = await this.db.tx.company.findUniqueOrThrow({ where: { id: job.companyId }, select: { tradeName: true } });
    return { jobTitle: job.title, companyName: company.tradeName };
  }

  async updateCandidate(id: string, input: { stage?: CandidateStage; score?: number; notes?: string; interviewAt?: string; reason?: string }) {
    const actor = this.actors.current;
    authorize(actor, 'recruitment.write');
    const candidate = await this.db.tx.candidate.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundError('Candidato', id);
    if (input.stage === 'REJECTED' && !input.reason) throw new ValidationError('Indique o motivo da rejeição', { reason: ['Obrigatório'] });
    const updated = await this.db.tx.candidate.update({
      where: { id },
      data: { stage: input.stage, score: input.score, notes: input.reason ? [candidate.notes, `Rejeição: ${input.reason}`].filter(Boolean).join('\n') : input.notes, interviewAt: input.interviewAt ? new Date(input.interviewAt) : undefined },
    });
    if (input.stage && input.stage !== candidate.stage) {
      await this.audit.record({ action: 'candidate.stage', entityType: 'candidate', entityId: id, before: { stage: candidate.stage }, after: { stage: input.stage } });
      if (input.stage === 'REJECTED') {
        const job = await this.jobForMail(candidate.jobId);
        await this.mailer.send({ to: candidate.email, subject: 'A sua candidatura', template: 'application-rejected', data: { name: candidate.name, ...job } });
      }
      if (input.stage === 'INTERVIEW' && input.interviewAt) {
        const job = await this.jobForMail(candidate.jobId);
        const interviewAt = new Date(input.interviewAt).toLocaleString('pt-AO', { timeZone: 'Africa/Luanda', dateStyle: 'full', timeStyle: 'short' });
        await this.mailer.send({ to: candidate.email, subject: 'Convite para entrevista', template: 'interview-invitation', data: { name: candidate.name, ...job, interviewAt } });
      }
    }
    return updated;
  }

  async cv(id: string) {
    authorize(this.actors.current, 'recruitment.read');
    const candidate = await this.db.tx.candidate.findUnique({ where: { id } });
    if (!candidate?.cvKey) throw new NotFoundError('Currículo', id);
    return { ...(await this.storage.get(candidate.cvKey)), fileName: `cv-${candidate.name.replace(/\s+/g, '-').toLowerCase()}.pdf` };
  }

  // Public careers page (no authentication) — explicit cross-tenant lookup by slug.

  async publicJobs(slug: string) {
    return this.db.runAsSystem(async (tx) => {
      const company = await tx.company.findUnique({ where: { careersSlug: slug } });
      if (!company) throw new NotFoundError('Página de carreiras', slug);
      const jobs = await tx.jobOpening.findMany({ where: { companyId: company.id, status: 'OPEN' }, orderBy: { publishedAt: 'desc' } });
      return {
        company: { name: company.tradeName, slug },
        jobs: jobs.map((job) => ({ id: job.id, title: job.title, location: job.location, workRegime: job.workRegime, description: job.description, publishedAt: isoDate(job.publishedAt) })),
      };
    });
  }

  async apply(slug: string, jobId: string, input: { name: string; email: string; phone?: string; consent: boolean }, cv?: CvFile) {
    if (!input.consent) throw new ValidationError('É necessário autorizar o tratamento de dados (Lei n.º 22/11)', { consent: ['Obrigatório'] });
    if (!cv) throw new ValidationError('Anexe o currículo', { cv: ['Obrigatório (PDF até 5 MB)'] });
    if (cv.mimetype !== 'application/pdf' || cv.size > 5 * 1024 * 1024) throw new ValidationError('Currículo inválido', { cv: ['PDF até 5 MB'] });

    const target = await this.db.runAsSystem(async (tx) => {
      const company = await tx.company.findUnique({ where: { careersSlug: slug } });
      const job = company ? await tx.jobOpening.findFirst({ where: { id: jobId, companyId: company.id, status: 'OPEN' } }) : null;
      if (!company || !job) throw new NotFoundError('Vaga', jobId);
      return { tenantId: company.tenantId, companyName: company.tradeName, job };
    });

    const key = `${target.tenantId}/recruitment/${randomUUID()}.pdf`;
    await this.storage.put(key, cv.buffer, cv.mimetype);
    return this.db.runAsTenant(target.tenantId, async (tx) => {
      const duplicate = await tx.candidate.findFirst({ where: { jobId, email: input.email.toLowerCase() } });
      if (duplicate) throw new BusinessRuleViolation('Já recebemos uma candidatura sua para esta vaga', 'duplicate_application');
      const candidate = await tx.candidate.create({ data: { tenantId: target.tenantId, jobId, name: input.name, email: input.email.toLowerCase(), phone: input.phone, cvKey: key, consentAt: new Date() } });
      await this.outbox.publish('candidate.applied', { candidateId: candidate.id, jobTitle: target.job.title, name: input.name });
      await this.mailer.send({
        to: input.email,
        subject: `Candidatura recebida — ${target.job.title}`,
        template: 'application-received',
        data: { name: input.name, jobTitle: target.job.title, companyName: target.companyName },
      });
      return { id: candidate.id, status: 'received' };
    });
  }
}
