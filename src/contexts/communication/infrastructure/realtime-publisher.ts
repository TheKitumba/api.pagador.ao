import { Emitter } from '@socket.io/redis-emitter';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

import { AppConfig } from '@/shared/infrastructure/config/app-config';

/**
 * Publishes realtime events through Redis. Works from the API and from the worker: every API
 * instance's Socket.IO server (with the Redis adapter) delivers them (docs/09, 9.9).
 */
@Injectable()
export class RealtimePublisher implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly emitter: Emitter;

  constructor(config: AppConfig) {
    this.redis = new Redis(config.env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 2 });
    this.emitter = new Emitter(this.redis);
  }

  toUser(userId: string, event: string, payload: unknown) {
    this.emitter.to(`user:${userId}`).emit(event, payload);
  }

  toTenant(tenantId: string, event: string, payload: unknown) {
    this.emitter.to(`tenant:${tenantId}`).emit(event, payload);
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
