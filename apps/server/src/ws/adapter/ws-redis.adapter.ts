import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis, { RedisOptions } from 'ioredis';
import {
  createRetryStrategy,
  parseRedisUrl,
  RedisConfig,
} from '../../common/helpers';

export class WsRedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;
  private redisConfig: RedisConfig;

  async connectToRedis(): Promise<void> {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.redisConfig = parseRedisUrl(redisUrl);
    const isTls = redisUrl.startsWith('rediss://');

    const options: RedisOptions = {
      family: this.redisConfig.family,
      retryStrategy: createRetryStrategy(),
      ...(isTls && {
        tls: {
          rejectUnauthorized: false, // For AWS ElastiCache with self-signed certs
        },
      }),
    };

    const pubClient = new Redis(redisUrl, options);
    const subClient = new Redis(redisUrl, options);

    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }
}
