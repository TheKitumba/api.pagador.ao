import { Body, Controller, Get, HttpCode, Param, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiNoContentResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { paginationSchema } from '@/shared/application/pagination';
import { IdParam } from '@/shared/presentation/zod';

import { MessagingService } from '../application/messaging.service';
import { NotificationsService } from '../application/notifications.service';

class NotificationsQuery extends createZodDto(paginationSchema.extend({ unread: z.enum(['true', 'false']).optional().transform((value) => value === 'true'), kind: z.enum(['ALERT', 'DEADLINE', 'INFO', 'SUCCESS']).optional() })) {}
class ConversationDto extends createZodDto(z.object({ userIds: z.array(z.uuid()).min(1), title: z.string().optional().describe('Obrigatório em grupos') })) {}
class MessageDto extends createZodDto(z.object({ body: z.string().max(5000).default('') })) {}
class AnnouncementDto extends createZodDto(z.object({ title: z.string().min(3), body: z.string().min(3), audience: z.string().default('Toda a empresa'), sms: z.boolean().optional() })) {}

@ApiTags('Comunicação')
@ApiCookieAuth()
@Controller()
export class CommunicationController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly messaging: MessagingService,
  ) {}

  @Get('notifications')
  @ApiOperation({ summary: 'As minhas notificações', description: 'Também chegam em tempo real pelo Socket.IO (`/realtime`, evento `notification.created`).' })
  list(@Query() query: NotificationsQuery) {
    return this.notifications.mine(query);
  }

  @Post('notifications/:id/read')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiOperation({ summary: 'Marcar como lida' })
  async read(@Param() { id }: IdParam) {
    await this.notifications.markRead(id);
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marcar todas como lidas' })
  readAll() {
    return this.notifications.markAllRead();
  }

  @Get('conversations')
  @ApiOperation({ summary: 'As minhas conversas com última mensagem e não lidas' })
  conversations() {
    return this.messaging.conversations();
  }

  @Post('conversations')
  @ApiOperation({ summary: 'Iniciar conversa (reutiliza a conversa 1:1 existente)' })
  start(@Body() body: ConversationDto) {
    return this.messaging.start(body);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Mensagens (marca a conversa como lida)' })
  messages(@Param() { id }: IdParam) {
    return this.messaging.messages(id);
  }

  @Post('conversations/:id/messages')
  @UseInterceptors(FileInterceptor('attachment', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ schema: { type: 'object', properties: { body: { type: 'string' }, attachment: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Enviar mensagem', description: 'Os participantes recebem `message.created` em tempo real.' })
  send(@Param() { id }: IdParam, @Body() body: MessageDto, @UploadedFile() attachment?: { buffer: Buffer; mimetype: string; originalname: string }) {
    return this.messaging.send(id, body.body, attachment);
  }

  @Get('messages/:id/attachment')
  @ApiProduces('application/octet-stream')
  @ApiOperation({ summary: 'Descarregar anexo' })
  async attachment(@Param() { id }: IdParam) {
    const file = await this.messaging.attachment(id);
    return new StreamableFile(file.body, { type: file.contentType, disposition: `attachment; filename="${file.fileName}"` });
  }

  @Get('announcements')
  @ApiOperation({ summary: 'Comunicados' })
  announcements() {
    return this.messaging.announcements();
  }

  @Post('announcements')
  @ApiOperation({ summary: 'Publicar comunicado', description: 'Notificação, e-mail (Gmail) e, opcionalmente, SMS a toda a empresa.' })
  announce(@Body() body: AnnouncementDto) {
    return this.messaging.announce(body);
  }
}
