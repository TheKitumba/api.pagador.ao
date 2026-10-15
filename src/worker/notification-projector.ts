import { Injectable, Logger } from '@nestjs/common';
import type { Role } from '@prisma/client';

import { NotificationsService, type NewNotification } from '@/contexts/communication/application/notifications.service';
import { RealtimePublisher } from '@/contexts/communication/infrastructure/realtime-publisher';
import { Mailer, type MailMessage } from '@/shared/application/ports';
import { AppConfig } from '@/shared/infrastructure/config/app-config';
import { Database } from '@/shared/infrastructure/prisma/database';

export interface IntegrationEvent {
  id: string;
  tenantId: string;
  type: string;
  payload: Record<string, unknown>;
}

/** A templated e-mail without its recipient (sent to several users). */
type WithoutRecipient<M> = M extends unknown ? Omit<M, 'to'> : never;
type MailContent = WithoutRecipient<MailMessage>;

interface ApprovalStepRef {
  approver: Role;
  label: string;
}

/**
 * Turns integration events from the outbox into in-app notifications, e-mails and a realtime
 * `domain.event` broadcast the web app uses to refresh its queries (docs/09, 9.8 and 9.9).
 * Runs inside the event's tenant transaction, so RLS applies as in a request.
 */
@Injectable()
export class NotificationProjector {
  private readonly logger = new Logger(NotificationProjector.name);

  constructor(
    private readonly db: Database,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimePublisher,
    private readonly mailer: Mailer,
    private readonly config: AppConfig,
  ) {}

  async project(event: IntegrationEvent) {
    const payload = event.payload;
    const id = (key: string) => String(payload[key] ?? '');

    switch (event.type) {
      case 'approval.requested':
      case 'approval.step_approved':
        await this.notifyCurrentApprover(id('requestId'));
        break;
      case 'approval.approved':
      case 'approval.rejected':
      case 'approval.returned':
        await this.notifyRequester(event.type, id('requestId'), payload.reason as string | undefined);
        break;
      case 'leave.approved':
        await this.notifications.notifyEmployee(id('employeeId'), { kind: 'SUCCESS', title: 'Férias aprovadas', body: `De ${id('startDate')} a ${id('endDate')}.`, href: '/me/leave' });
        break;
      case 'overtime.approved':
        await this.notifications.notifyEmployee(id('employeeId'), { kind: 'SUCCESS', title: 'Horas extra aprovadas', body: 'Serão pagas no próximo processamento salarial.', href: '/me/time' });
        break;
      case 'feedback.given':
        await this.notifications.notifyEmployee(id('toEmployeeId'), { kind: 'INFO', title: `Recebeu ${id('kind').toLowerCase()}`, body: 'Um colega deixou-lhe feedback.', href: '/me/performance' });
        break;
      case 'employee.iban_changed':
        await this.notifications.notifyRoles(['PAYROLL_PROCESSOR', 'FINANCIAL_APPROVER'], { kind: 'ALERT', title: 'IBAN alterado', body: `${id('name')} alterou a conta bancária. Confirme antes do próximo pagamento.`, href: `/employees/${id('employeeId')}` });
        break;
      case 'employee.created':
        await this.notifications.notifyRoles(['HR_MANAGER'], { kind: 'INFO', title: 'Novo colaborador', body: `${id('name')} foi admitido.`, href: `/employees/${id('employeeId')}` });
        break;
      case 'candidate.applied':
        await this.notifications.notifyRoles(['RECRUITER', 'HR_MANAGER'], { kind: 'INFO', title: 'Nova candidatura', body: `${id('name')} candidatou-se a ${id('jobTitle')}.`, href: '/recruitment' });
        break;
      case 'accident.reported':
        await this.notifications.notifyRoles(['HR_MANAGER'], { kind: 'ALERT', title: 'Acidente de trabalho registado', body: `Gravidade: ${id('severity')}. A participação à seguradora tem prazo legal.`, href: '/safety' });
        break;
      case 'payroll_run.calculated':
        await this.notifications.notifyRoles(['PAYROLL_PROCESSOR'], { kind: 'SUCCESS', title: 'Processamento calculado', body: 'Reveja os recibos e submeta para aprovação.', href: `/payroll/runs/${id('runId')}` });
        break;
      case 'payroll_run.approved':
        await this.notifications.notifyRoles(['PAYROLL_PROCESSOR', 'FINANCIAL_APPROVER'], { kind: 'SUCCESS', title: 'Processamento aprovado', body: 'Pode gerar o lote de pagamento.', href: `/payroll/runs/${id('runId')}` });
        break;
      case 'payroll_run.paid':
        await this.notifyPayslipsAvailable(id('runId'));
        break;
      case 'payment_batch.approved':
        await this.notifications.notifyRoles(['PAYROLL_PROCESSOR', 'FINANCIAL_APPROVER'], { kind: 'SUCCESS', title: 'Lote de pagamento aprovado', body: 'Exporte o ficheiro bancário e submeta-o no banco.', href: '/payments' });
        break;
      case 'payment_batch.paid':
        await this.notifications.notifyRoles(['FINANCIAL_APPROVER'], { kind: 'SUCCESS', title: 'Lote pago', body: 'Todas as transferências foram confirmadas.', href: '/payments' });
        break;
      default:
        break;
    }

    this.realtime.toTenant(event.tenantId, 'domain.event', { type: event.type, payload });
  }

  private async notifyCurrentApprover(requestId: string) {
    const request = await this.db.tx.approvalRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status !== 'PENDING') return;
    const step = (request.steps as unknown as ApprovalStepRef[])[request.currentStep];
    if (!step) return;

    const notification: NewNotification = { kind: 'DEADLINE', title: 'Aprovação pendente', body: request.title, href: '/approvals' };
    const excluded = new Set([request.requesterUserId, ...request.excludedUserIds].filter(Boolean));

    let userIds: string[];
    if (step.approver === 'LINE_MANAGER' && request.beneficiaryManagerId) {
      const manager = await this.db.tx.membership.findFirst({ where: { tenantId: request.tenantId, employeeId: request.beneficiaryManagerId }, select: { userId: true } });
      userIds = manager ? [manager.userId] : [];
    } else {
      const role: Role = step.approver === 'LINE_MANAGER' ? 'HR_MANAGER' : step.approver;
      const members = await this.db.tx.membership.findMany({ where: { tenantId: request.tenantId, roles: { has: role } }, select: { userId: true } });
      userIds = members.map((member) => member.userId);
    }
    const recipients = userIds.filter((userId) => !excluded.has(userId));
    await this.notifications.notifyUsers(recipients, notification);
    await this.email(recipients, {
      subject: `Aprovação pendente: ${request.title}`,
      template: 'approval-pending',
      data: { title: request.title, stepLabel: step.label, approvalsUrl: `${this.config.env.APP_URL}/approvals` },
    });
  }

  private async notifyRequester(type: string, requestId: string, reason?: string) {
    const request = await this.db.tx.approvalRequest.findUnique({ where: { id: requestId } });
    if (!request?.requesterUserId) return;
    const outcome = { 'approval.approved': ['SUCCESS', 'aprovado'], 'approval.rejected': ['ALERT', 'rejeitado'], 'approval.returned': ['ALERT', 'devolvido'] } as const;
    const [kind, verb] = outcome[type as keyof typeof outcome];
    await this.notifications.notifyUsers([request.requesterUserId], { kind, title: `Pedido ${verb}`, body: reason ? `${request.title} — ${reason}` : request.title, href: '/approvals?scope=mine' });
  }

  private async notifyPayslipsAvailable(runId: string) {
    const payslips = await this.db.tx.payslip.findMany({ where: { runId }, select: { employeeId: true } });
    const members = await this.db.tx.membership.findMany({ where: { tenantId: this.db.tenantId, employeeId: { in: payslips.map((payslip) => payslip.employeeId) } }, select: { userId: true } });
    await this.notifications.notifyUsers(members.map((member) => member.userId), { kind: 'INFO', title: 'Recibo de vencimento disponível', body: 'O seu salário foi pago. O recibo já está no portal.', href: '/me/payslips' });
  }

  private async email(userIds: string[], message: MailContent) {
    if (userIds.length === 0) return;
    const users = await this.db.tx.user.findMany({ where: { id: { in: userIds }, email: { not: null } }, select: { email: true } });
    for (const { email } of users) {
      if (!email) continue;
      await this.mailer.send({ ...message, to: email } as MailMessage).catch((error: unknown) => this.logger.warn(`E-mail para ${email} falhou: ${String(error)}`));
    }
  }
}
