import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { type OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import type { Socket } from 'socket.io';

import { AppConfig } from '@/shared/infrastructure/config/app-config';
import type { AccessTokenPayload } from '@/shared/application/access-token';
import { ACCESS_COOKIE } from '@/shared/presentation/auth.guard';

const config = new AppConfig();

/**
 * Socket.IO gateway (`/realtime`): the browser connects with the session cookie and joins its
 * user and tenant rooms. Events are emitted through Redis by RealtimePublisher (docs/09, 9.9).
 */
@WebSocketGateway({ namespace: '/realtime', cors: { origin: config.corsOrigins, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly appConfig: AppConfig,
  ) {}

  async handleConnection(socket: Socket) {
    const cookies = Object.fromEntries((socket.handshake.headers.cookie ?? '').split(';').map((part) => part.trim().split('=').map(decodeURIComponent)));
    const token = (cookies[ACCESS_COOKIE] as string | undefined) ?? (socket.handshake.auth?.token as string | undefined);
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token ?? '', {
        publicKey: this.appConfig.jwtPublicKey,
        algorithms: ['RS256'],
        issuer: this.appConfig.env.JWT_ISSUER,
        audience: this.appConfig.env.JWT_AUDIENCE,
      });
      await socket.join([`user:${payload.sub}`, `tenant:${payload.tid}`]);
    } catch {
      this.logger.debug('Ligação realtime sem sessão válida — desligada');
      socket.disconnect(true);
    }
  }
}
