import { Global, Module } from '@nestjs/common';

import { MessagingService } from './application/messaging.service';
import { NotificationsService } from './application/notifications.service';
import { RealtimePublisher } from './infrastructure/realtime-publisher';
import { CommunicationController } from './presentation/communication.controller';
import { RealtimeGateway } from './presentation/realtime.gateway';

/** Global: the worker and other contexts create notifications through NotificationsService. */
@Global()
@Module({
  controllers: [CommunicationController],
  providers: [RealtimePublisher, NotificationsService, MessagingService, RealtimeGateway],
  exports: [NotificationsService, RealtimePublisher],
})
export class CommunicationModule {}
