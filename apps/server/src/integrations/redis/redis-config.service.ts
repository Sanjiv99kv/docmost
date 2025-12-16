import { Injectable } from '@nestjs/common';
import {
  RedisModuleOptions,
  RedisOptionsFactory,
} from '@nestjs-labs/nestjs-ioredis';
import { createRetryStrategy, parseRedisUrl } from '../../common/helpers';
import { EnvironmentService } from '../environment/environment.service';

@Injectable()
export class RedisConfigService implements RedisOptionsFactory {
  constructor(private readonly environmentService: EnvironmentService) {}
  createRedisOptions(): RedisModuleOptions {
    const redisUrl = this.environmentService.getRedisUrl();
    const redisConfig = parseRedisUrl(redisUrl);
    
    // Check if URL uses TLS (rediss://)
    const isTls = redisUrl.startsWith('rediss://');
    
    return {
      readyLog: true,
      config: {
        host: redisConfig.host,
        port: redisConfig.port,
        password: redisConfig.password,
        db: redisConfig.db,
        family: redisConfig.family,
        retryStrategy: createRetryStrategy(),
        // Configure TLS for Redis if using rediss://
        ...(isTls && {
          tls: {
            rejectUnauthorized: false, // For AWS ElastiCache with self-signed certs
          },
        }),
      },
    };
  }
}
