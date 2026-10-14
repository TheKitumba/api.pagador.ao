import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { ClsService } from 'nestjs-cls';

import { NotificationsService } from '@/contexts/communication/application/notifications.service';
import { PayrollRunCalculation } from '@/contexts/payroll/application/payroll-runs.use-cases';
import { Database } from '@/shared/infrastructure/prisma/database';
import { JOBS, QUEUES } from '@/shared/infrastructure/queue/queues';

import { type IntegrationEvent, NotificationProjector } from './notification-projector';

const OUTBOX_BATCH = 100;
const OUTBOX_MAX_ATTEMPTS = 10;
const ALERT_HORIZON_DAYS = 30;

/** Registers the repeatable jobs (idempotent: job schedulers are upserted by id). */
@Injectable()
export class JobSchedules implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(QUEUES.outbox) private readonly outbox: Queue,
    @InjectQueue(QUEUES.scheduled) private readonly scheduled: Queue,
  ) {}

  async onApplicationBootstrap() {
    await this.outbox.upsertJobScheduler('outbox-relay', { every: 2_000 }, { name: JOBS.outboxPublish });
    await this.scheduled.upsertJobScheduler('daily-alerts', { pattern: '0 7 * * *', tz: 'Africa/Luanda' }, { name: JOBS.alertsDaily });
  }
}

/** Relays unpublished outbox events, each projected in its own tenant transaction (docs/09, 9.4.2). */
@Processor(QUEUES.outbox, { concurrency: 1 })
export class OutboxRelayProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboxRelayProcessor.name);

  constructor(
    private readonly db: Database,
    private readonly cls: ClsService,
    private readonly projector: NotificationProjector,
  ) {
    super();
  }

  async process() {
    const events = await this.cls.run(() =>
      this.db.runAsSystem((tx) => tx.outboxEvent.findMany({ where: { publishedAt: null, attempts: { lt: OUTBOX_MAX_ATTEMPTS } }, orderBy: { occurredAt: 'asc' }, take: OUTBOX_BATCH })),
    );

    for (const event of events) {
      try {
        await this.cls.run(() =>
          this.db.runAsTenant(event.tenantId, async (tx) => {
            await this.projector.project({ ...event, payload: (event.payload ?? {}) as IntegrationEvent['payload'] });
            await tx.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: new Date(), attempts: { increment: 1 } } });
          }),
        );
      } catch (error) {
        this.logger.error(`Evento ${event.type} (${event.id}) falhou: ${String(error)}`);
        await this.cls.run(() => this.db.runAsSystem((tx) => tx.outboxEvent.update({ where: { id: event.id }, data: { attempts: { increment: 1 } } })));
      }
    }
    return { relayed: events.length };
  }
}

/** Large payroll runs are calculated here instead of inside the HTTP request (docs/04, 4.5). */
@Processor(QUEUES.payroll, { concurrency: 2 })
export class PayrollCalculationProcessor extends WorkerHost {
  private readonly logger = new Logger(PayrollCalculationProcessor.name);

  constructor(
    private readonly db: Database,
    private readonly cls: ClsService,
    private readonly calculation: PayrollRunCalculation,
  ) {
    super();
  }

  async process(job: Job<{ tenantId: string; runId: string; userId: string }>) {
    const { tenantId, runId, userId } = job.data;
    return this.cls.run(() => this.db.runAsTenant(tenantId, () => this.calculation.run(runId, userId)));
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job) {
    this.logger.error(`Cálculo do processamento ${job.data.runId} falhou (tentativa ${job.attemptsMade}): ${job.failedReason}`);
  }
}

/** Daily digest of upcoming deadlines for HR and payroll, per tenant (docs/03 M19). */
@Processor(QUEUES.scheduled)
export class DailyAlertsProcessor extends WorkerHost {
  constructor(
    private readonly db: Database,
    private readonly cls: ClsService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process() {
    const tenants = await this.cls.run(() => this.db.runAsSystem((tx) => tx.tenant.findMany({ select: { id: true } })));
    const today = new Date(new Date().toISOString().slice(0, 10));
    const horizon = new Date(today.getTime() + ALERT_HORIZON_DAYS * 86_400_000);

    for (const tenant of tenants) {
      await this.cls.run(() =>
        this.db.runAsTenant(tenant.id, async (tx) => {
          const [contracts, documents, exams, filings] = await Promise.all([
            tx.employmentContract.count({ where: { status: 'ACTIVE', endDate: { gte: today, lte: horizon } } }),
            tx.employeeDocument.count({ where: { expiresAt: { gte: today, lte: horizon } } }),
            tx.medicalExam.count({ where: { doneAt: null, dueDate: { lte: horizon } } }),
            tx.taxFiling.findMany({ where: { status: { in: ['READY', 'SUBMITTED'] }, dueDate: { lte: new Date(today.getTime() + 7 * 86_400_000) } }, select: { dueDate: true } }),
          ]);

          if (contracts > 0) await this.notifications.notifyRoles(['HR_MANAGER', 'HR_TECHNICIAN'], { kind: 'DEADLINE', title: 'Contratos a terminar', body: `${contracts} contrato(s) terminam nos próximos ${ALERT_HORIZON_DAYS} dias. Decida a renovação ou o aviso de não renovação.`, href: '/employees?filter=contracts-ending' });
          if (documents > 0) await this.notifications.notifyRoles(['HR_TECHNICIAN'], { kind: 'DEADLINE', title: 'Documentos a expirar', body: `${documents} documento(s) expiram nos próximos ${ALERT_HORIZON_DAYS} dias.`, href: '/documents' });
          if (exams > 0) await this.notifications.notifyRoles(['HR_MANAGER'], { kind: 'DEADLINE', title: 'Exames médicos', body: `${exams} exame(s) médico(s) em atraso ou a vencer.`, href: '/safety' });
          if (filings.length > 0) await this.notifications.notifyRoles(['PAYROLL_PROCESSOR', 'FINANCIAL_APPROVER'], { kind: 'ALERT', title: 'Obrigações fiscais', body: `${filings.length} declaração(ões)/pagamento(s) vencem nos próximos 7 dias (IRT e Segurança Social).`, href: '/tax' });
        }),
      );
    }
    return { tenants: tenants.length };
  }
}
