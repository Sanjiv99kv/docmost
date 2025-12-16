import {
  Global,
  Logger,
  Module,
  OnApplicationBootstrap,
  BeforeApplicationShutdown,
} from '@nestjs/common';
import { InjectKysely, KyselyModule } from 'nestjs-kysely';
import { EnvironmentService } from '../integrations/environment/environment.service';
import { CamelCasePlugin, LogEvent, PostgresDialect, sql } from 'kysely';
import { Pool, types } from 'pg';
import { GroupRepo } from '@docmost/db/repos/group/group.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { GroupUserRepo } from '@docmost/db/repos/group/group-user.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { PageRepo } from './repos/page/page.repo';
import { CommentRepo } from './repos/comment/comment.repo';
import { PageHistoryRepo } from './repos/page/page-history.repo';
import { AttachmentRepo } from './repos/attachment/attachment.repo';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import * as process from 'node:process';
import { MigrationService } from '@docmost/db/services/migration.service';
import { UserTokenRepo } from './repos/user-token/user-token.repo';
import { BacklinkRepo } from '@docmost/db/repos/backlink/backlink.repo';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { PageListener } from '@docmost/db/listeners/page.listener';

// https://github.com/brianc/node-postgres/issues/811
types.setTypeParser(types.builtins.INT8, (val) => Number(val));

@Global()
@Module({
  imports: [
    KyselyModule.forRootAsync({
      imports: [],
      inject: [EnvironmentService],
      useFactory: (environmentService: EnvironmentService) => {
        const databaseUrl = environmentService.getDatabaseURL();
        const isProduction = environmentService.getNodeEnv() === 'production';

        // Check if individual DB parameters are provided
        const dbHost = environmentService.getDatabaseHost();
        const dbPort = environmentService.getDatabasePort();
        const dbUsername = environmentService.getDatabaseUsername();
        const dbPassword = environmentService.getDatabasePassword();
        const dbName = environmentService.getDatabaseName();

        // Determine if SSL should be enabled
        // Enable SSL for: production, AWS RDS hosts, or when DB_SSL_ENABLED is set
        let shouldUseSSL = false;
        let sslConfig: any = false;
        let hostname: string | undefined;

        // Determine hostname for SSL detection
        if (dbHost) {
          hostname = dbHost;
        } else if (databaseUrl) {
          try {
            const url = new URL(databaseUrl);
            hostname = url.hostname;
          } catch (err) {
            // URL parsing failed, will handle below
          }
        }

        // Check if it's a remote host (RDS)
        const isRemoteHost = hostname &&
          (hostname.includes('.rds.amazonaws.com') ||
            hostname.includes('.rds.') ||
            !['localhost', '127.0.0.1'].includes(hostname));

        // Check sslmode in URL if using connection string
        let hasSslMode = false;
        if (databaseUrl) {
          try {
            const url = new URL(databaseUrl);
            const sslParam = url.searchParams.get('sslmode');
            hasSslMode = sslParam === 'require' || sslParam === 'prefer' || sslParam === 'verify-ca' || sslParam === 'verify-full';
          } catch (err) {
            // Ignore URL parsing errors
          }
        }

        // Determine if SSL should be used
        shouldUseSSL = isProduction ||
          isRemoteHost ||
          process.env.DB_SSL_ENABLED === 'true' ||
          hasSslMode;

        if (shouldUseSSL) {
          // For AWS RDS, we need to accept self-signed certificates
          sslConfig = {
            rejectUnauthorized: false, // Accept RDS self-signed certificates
          };
        }

        // Build pool configuration
        let poolConfig: any = {
          max: environmentService.getDatabaseMaxPool(),
          ssl: sslConfig,
        };

        // Use individual parameters if provided, otherwise use connection string
        if (dbHost && dbPort && dbUsername && dbPassword && dbName) {
          poolConfig = {
            ...poolConfig,
            host: dbHost,
            port: dbPort,
            user: dbUsername,
            password: dbPassword,
            database: dbName,
          };
        } else if (databaseUrl) {
          poolConfig = {
            ...poolConfig,
            connectionString: databaseUrl,
          };
        } else {
          throw new Error('Either DATABASE_URL or individual database parameters (DATABASE_HOST, DATABASE_PORT, DATABASE_USERNAME, DATABASE_PASSWORD, DATABASE_NAME) must be provided');
        }

        return {
          dialect: new PostgresDialect({
            pool: new Pool(poolConfig).on('error', (err) => {
              console.error('Database error:', err.message);
            }),
          }),
          plugins: [new CamelCasePlugin()],
          log: (event: LogEvent) => {
            if (environmentService.getNodeEnv() !== 'development') return;
            const logger = new Logger(DatabaseModule.name);
            if (event.level) {
              if (process.env.DEBUG_DB?.toLowerCase() === 'true') {
                logger.debug(event.query.sql);
                logger.debug('query time: ' + event.queryDurationMillis + ' ms');
                //if (event.query.parameters.length > 0) {
                // logger.debug('parameters: ' + event.query.parameters);
                //}
              }
            }
          },
        };
      },
    }),
  ],
  providers: [
    MigrationService,
    WorkspaceRepo,
    UserRepo,
    GroupRepo,
    GroupUserRepo,
    SpaceRepo,
    SpaceMemberRepo,
    PageRepo,
    PageHistoryRepo,
    CommentRepo,
    AttachmentRepo,
    UserTokenRepo,
    BacklinkRepo,
    ShareRepo,
    PageListener,
  ],
  exports: [
    WorkspaceRepo,
    UserRepo,
    GroupRepo,
    GroupUserRepo,
    SpaceRepo,
    SpaceMemberRepo,
    PageRepo,
    PageHistoryRepo,
    CommentRepo,
    AttachmentRepo,
    UserTokenRepo,
    BacklinkRepo,
    ShareRepo,
  ],
})
export class DatabaseModule
  implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly migrationService: MigrationService,
    private readonly environmentService: EnvironmentService,
  ) { }

  async onApplicationBootstrap() {
    await this.establishConnection();

    if (this.environmentService.getNodeEnv() === 'production') {
      await this.migrationService.migrateToLatest();
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (this.db) {
      await this.db.destroy();
    }
  }

  async establishConnection() {
    const retryAttempts = 15;
    const retryDelay = 3000;

    this.logger.log('Establishing database connection');
    for (let i = 0; i < retryAttempts; i++) {
      try {
        await sql`SELECT 1=1`.execute(this.db);
        this.logger.log('Database connection successful');
        break;
      } catch (err) {
        if (err['errors']) {
          this.logger.error(err['errors'][0]);
        } else {
          this.logger.error(err);
        }

        if (i < retryAttempts - 1) {
          this.logger.log(
            `Retrying [${i + 1}/${retryAttempts}] in ${retryDelay / 1000} seconds`,
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        } else {
          this.logger.error(
            `Failed to connect to database after ${retryAttempts} attempts. Exiting...`,
          );
          process.exit(1);
        }
      }
    }
  }
}
