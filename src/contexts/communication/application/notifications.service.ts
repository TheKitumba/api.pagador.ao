import { Injectable } from '@nestjs/common';
import type { NotificationKind, Role } from '@prisma/client';

import { type Pagination, pageArgs, toPage } from '@/shared/application/pagination';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { Database } from '@/shared/infrastructure/prisma/database';

import { RealtimePublisher } from '../infrastructure/realtime-publisher';

export interface NewNotification {
  kind: NotificationKind;
  title: string;
  body: string;
  href?: string;
}

/** In-app notifications, pushed live over Socket.IO (docs/03 M19). */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly realtime: RealtimePublisher,
  ) {}

  async notifyUsers(userIds: string[], notification: NewNotification) {
    const tenantId = this.db.tenantId;
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return 0;
    await this.db.tx.notification.createMany({ data: unique.map((userId) => ({ tenantId, userId, ...notification })) });
    for (const userId of unique) this.realtime.toUser(userId, 'notification.created', notification);
    return unique.length;
  }

  /** Notifies every member holding one of the roles (e.g. FINANCIAL_APPROVER for a payroll to approve). */
  async notifyRoles(roles: Role[], notification: NewNotification) {
    const members = await this.db.tx.membership.findMany({ where: { tenantId: this.db.tenantId, roles: { hasSome: roles } }, select: { userId: true } });
    return this.notifyUsers(members.map((member) => member.userId), notification);
  }

  /** Notifies the user account linked to an employee (portal), if any. */
  async notifyEmployee(employeeId: string, notification: NewNotification) {
    const member = await this.db.tx.membership.findFirst({ where: { tenantId: this.db.tenantId, employeeId }, select: { userId: true } });
    return member ? this.notifyUsers([member.userId], notification) : 0;
  }

  async mine(filter: Pagination & { unread?: boolean; kind?: NotificationKind }) {
    const actor = this.actors.current;
    const rows = await this.db.tx.notification.findMany({
      where: { userId: actor.userId, ...(filter.unread ? { readAt: null } : {}), ...(filter.kind ? { kind: filter.kind } : {}) },
      ...pageArgs(filter),
    });
    const unread = await this.db.tx.notification.count({ where: { userId: actor.userId, readAt: null } });
    return { ...toPage(rows, filter.limit), unread };
  }

  async markRead(id: string) {
    await this.db.tx.notification.updateMany({ where: { id, userId: this.actors.current.userId, readAt: null }, data: { readAt: new Date() } });
  }

  async markAllRead() {
    const result = await this.db.tx.notification.updateMany({ where: { userId: this.actors.current.userId, readAt: null }, data: { readAt: new Date() } });
    return { updated: result.count };
  }
}
