import './load-env';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Redis } from 'ioredis';
import type { ServerOptions } from 'socket.io';

import { AppModule } from './app.module';
import { AppConfig } from './shared/infrastructure/config/app-config';
import { setupSwagger } from './shared/presentation/swagger';

/** Socket.IO with the Redis adapter, so events reach clients connected to any API instance. */
class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | undefined;

  connect(url: string) {
    const pub = new Redis(url);
    const sub = pub.duplicate();
    this.adapterConstructor = createAdapter(pub, sub);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(AppConfig);

  app.set('trust proxy', 1);
  app.setGlobalPrefix('v1', { exclude: [] });
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.enableShutdownHooks();

  const io = new RedisIoAdapter(app);
  io.connect(config.env.REDIS_URL);
  app.useWebSocketAdapter(io);

  setupSwagger(app);
  await app.listen(config.env.PORT);
  Logger.log(`API em http://localhost:${config.env.PORT}/v1 · documentação em http://localhost:${config.env.PORT}/v1/docs`, 'Bootstrap');
}

void bootstrap();
