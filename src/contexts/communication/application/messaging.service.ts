import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { authorize } from '@/shared/application/permissions';
import { FileStorage, Mailer, SmsSender } from '@/shared/application/ports';
import { ForbiddenError, NotFoundError, ValidationError } from '@/shared/domain/errors';
import { AuditService } from '@/shared/infrastructure/audit/audit.service';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { Database } from '@/shared/infrastructure/prisma/database';

import { RealtimePublisher } from '../infrastructure/realtime-publisher';
import { NotificationsService } from './notifications.service';

/** Conversations (1:1 and groups) and company announcements (docs/03 M19). */
@Injectable()
export class MessagingService {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly storage: FileStorage,
    private readonly realtime: RealtimePublisher,
    private readonly notifications: NotificationsService,
    private readonly mailer: Mailer,
    private readonly sms: SmsSender,
    private readonly audit: AuditService,
  ) {}

  private async assertParticipant(conversationId: string) {
    const participant = await this.db.tx.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId: this.actors.current.userId } } });
    if (!participant) throw new ForbiddenError('Não participa nesta conversa', 'not_participant');
    return participant;
  }

  async conversations() {
    const actor = this.actors.current;
    const conversations = await this.db.tx.conversation.findMany({
      where: { participants: { some: { userId: actor.userId } } },
      include: { participants: true, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const userIds = [...new Set(conversations.flatMap((c) => c.participants.map((p) => p.userId)))];
    const users = await this.db.tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    const names = new Map(users.map((user) => [user.id, user.name]));

    const result = [];
    for (const conversation of conversations) {
      const me = conversation.participants.find((p) => p.userId === actor.userId)!;
      const unread = await this.db.tx.message.count({ where: { conversationId: conversation.id, authorUserId: { not: actor.userId }, ...(me.lastReadAt ? { createdAt: { gt: me.lastReadAt } } : {}) } });
      const others = conversation.participants.filter((p) => p.userId !== actor.userId).map((p) => names.get(p.userId) ?? '');
      const last = conversation.messages[0];
      result.push({
        id: conversation.id,
        title: conversation.title ?? others.join(', '),
        isGroup: conversation.isGroup,
        participants: conversation.participants.map((p) => ({ userId: p.userId, name: names.get(p.userId) ?? null })),
        lastMessage: last ? { body: last.body, author: names.get(last.authorUserId) ?? null, at: last.createdAt } : null,
        unread,
      });
    }
    return result.sort((a, b) => (b.lastMessage?.at.getTime() ?? 0) - (a.lastMessage?.at.getTime() ?? 0));
  }

  async start(input: { userIds: string[]; title?: string }) {
    const actor = this.actors.current;
    const members = await this.db.tx.membership.count({ where: { tenantId: actor.tenantId, userId: { in: input.userIds } } });
    if (members !== new Set(input.userIds).size) throw new ValidationError('Participantes inválidos', { userIds: ['Todos têm de pertencer à conta'] });
    const userIds = [...new Set([actor.userId, ...input.userIds])];
    if (userIds.length === 2 && !input.title) {
      const existing = await this.db.tx.conversation.findFirst({ where: { isGroup: false, AND: userIds.map((userId) => ({ participants: { some: { userId } } })) } });
      if (existing) return { id: existing.id };
    }
    const conversation = await this.db.tx.conversation.create({
      data: { tenantId: actor.tenantId, title: input.title, isGroup: userIds.length > 2, participants: { create: userIds.map((userId) => ({ tenantId: actor.tenantId, userId })) } },
    });
    return { id: conversation.id };
  }

  async messages(conversationId: string) {
    const participant = await this.assertParticipant(conversationId);
    const messages = await this.db.tx.message.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' }, take: 500 });
    const users = await this.db.tx.user.findMany({ where: { id: { in: [...new Set(messages.map((m) => m.authorUserId))] } }, select: { id: true, name: true } });
    const names = new Map(users.map((user) => [user.id, user.name]));
    await this.db.tx.conversationParticipant.update({ where: { id: participant.id }, data: { lastReadAt: new Date() } });
    return messages.map((message) => ({ id: message.id, author: { userId: message.authorUserId, name: names.get(message.authorUserId) ?? null }, body: message.body, hasAttachment: Boolean(message.attachmentKey), at: message.createdAt }));
  }

  async send(conversationId: string, body: string, attachment?: { buffer: Buffer; mimetype: string; originalname: string }) {
    const actor = this.actors.current;
    await this.assertParticipant(conversationId);
    let attachmentKey: string | undefined;
    if (attachment) {
      attachmentKey = `${actor.tenantId}/messages/${randomUUID()}-${attachment.originalname.replace(/[^\w.-]+/g, '_')}`;
      await this.storage.put(attachmentKey, attachment.buffer, attachment.mimetype);
    }
    const message = await this.db.tx.message.create({ data: { tenantId: actor.tenantId, conversationId, authorUserId: actor.userId, body: body || attachment?.originalname || '', attachmentKey } });
    const participants = await this.db.tx.conversationParticipant.findMany({ where: { conversationId, userId: { not: actor.userId } } });
    for (const participant of participants) {
      this.realtime.toUser(participant.userId, 'message.created', { conversationId, id: message.id, author: actor.name, body: message.body, at: message.createdAt });
    }
    return { id: message.id, at: message.createdAt };
  }

  async attachment(messageId: string) {
    const message = await this.db.tx.message.findUnique({ where: { id: messageId } });
    if (!message?.attachmentKey) throw new NotFoundError('Anexo', messageId);
    await this.assertParticipant(message.conversationId);
    return { ...(await this.storage.get(message.attachmentKey)), fileName: message.attachmentKey.split('/').pop() ?? 'anexo' };
  }

  async announcements() {
    const rows = await this.db.tx.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    return rows;
  }

  /** Announcement to the whole company: in-app notification, e-mail and (optionally) SMS. */
  async announce(input: { title: string; body: string; audience: string; sms?: boolean }) {
    const actor = this.actors.current;
    authorize(actor, 'communication.publish');
    const announcement = await this.db.tx.announcement.create({ data: { ...input, sms: input.sms ?? false, tenantId: actor.tenantId, authorId: actor.userId } });
    const members = await this.db.tx.membership.findMany({ where: { tenantId: actor.tenantId }, include: { user: { select: { email: true, phone: true } } } });
    await this.notifications.notifyUsers(members.map((m) => m.userId), { kind: 'INFO', title: input.title, body: input.body.slice(0, 280), href: '/messages' });
    for (const member of members) {
      if (member.user.email) await this.mailer.send({ to: member.user.email, subject: `Comunicado: ${input.title}`, text: input.body });
      if (input.sms && member.user.phone) await this.sms.send(member.user.phone, `${input.title}: ${input.body}`.slice(0, 300));
    }
    await this.audit.record({ action: 'announcement.publish', entityType: 'announcement', entityId: announcement.id, after: { title: input.title, recipients: members.length } });
    return { id: announcement.id, recipients: members.length };
  }
}
