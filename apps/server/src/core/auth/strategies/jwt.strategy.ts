import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { JwtApiKeyPayload, JwtPayload, JwtType } from '../dto/jwt-payload';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { FastifyRequest } from 'fastify';
import { extractBearerTokenFromHeader } from '../../../common/helpers';
import { ModuleRef } from '@nestjs/core';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private logger = new Logger('JwtStrategy');

  constructor(
    private userRepo: UserRepo,
    private workspaceRepo: WorkspaceRepo,
    private readonly environmentService: EnvironmentService,
    private moduleRef: ModuleRef,
  ) {
    super({
      jwtFromRequest: (req: FastifyRequest) => {
        const token = req.cookies?.authToken || extractBearerTokenFromHeader(req);
        if (!token) {
          this.logger.debug(`No auth token found in request. Cookies: ${JSON.stringify(req.cookies)}, Headers: ${req.headers.authorization}`);
        }
        return token;
      },
      ignoreExpiration: false,
      secretOrKey: environmentService.getAppSecret(),
      passReqToCallback: true,
    });
  }

  async validate(req: any, payload: JwtPayload | JwtApiKeyPayload) {
    if (!payload.workspaceId) {
      this.logger.debug('JWT payload missing workspaceId');
      throw new UnauthorizedException();
    }

    // In cloud mode, validate workspace access
    if (this.environmentService.isCloud()) {
      const header = req.headers?.host || '';
      const subdomainHost = this.environmentService.getSubdomainHost();
      const hostname = header.split(':')[0];
      
      this.logger.debug(`JWT validation - hostname: ${hostname}, token workspaceId: ${payload.workspaceId}, req.raw.workspaceId: ${req.raw?.workspaceId}`);
      
      // If accessing from base domain, allow (for cloud login flow)
      if (hostname === subdomainHost || hostname === `www.${subdomainHost}`) {
        // Base domain access - workspace ID from token is valid
        this.logger.debug('Base domain access - allowing');
      } else {
        // Subdomain access - check if workspace matches
        // If req.raw.workspaceId is set by domain middleware, it must match
        // If not set, we'll validate by checking if the workspace hostname matches the subdomain
        if (req.raw?.workspaceId) {
          if (req.raw.workspaceId !== payload.workspaceId) {
            this.logger.warn(`Workspace mismatch - req.raw.workspaceId: ${req.raw.workspaceId}, token workspaceId: ${payload.workspaceId}`);
            throw new UnauthorizedException('Workspace does not match');
          }
        } else {
          // Domain middleware hasn't set workspaceId yet, validate by hostname
          const subdomain = hostname.split('.')[0];
          const workspace = await this.workspaceRepo.findByHostname(subdomain);
          if (workspace && workspace.id !== payload.workspaceId) {
            this.logger.warn(`Workspace mismatch - hostname workspace: ${workspace.id}, token workspaceId: ${payload.workspaceId}`);
            throw new UnauthorizedException('Workspace does not match');
          }
          if (!workspace) {
            this.logger.warn(`Workspace not found for hostname: ${subdomain}`);
          }
        }
      }
    } else {
      // Self-hosted mode - strict matching
      if (req.raw?.workspaceId && req.raw.workspaceId !== payload.workspaceId) {
        this.logger.warn(`Self-hosted workspace mismatch - req.raw.workspaceId: ${req.raw.workspaceId}, token workspaceId: ${payload.workspaceId}`);
      throw new UnauthorizedException('Workspace does not match');
      }
    }

    if (payload.type === JwtType.API_KEY) {
      return this.validateApiKey(req, payload as JwtApiKeyPayload);
    }

    if (payload.type !== JwtType.ACCESS) {
      throw new UnauthorizedException();
    }

    const workspace = await this.workspaceRepo.findById(payload.workspaceId);

    if (!workspace) {
      throw new UnauthorizedException();
    }
    const user = await this.userRepo.findById(payload.sub, payload.workspaceId);

    if (!user || user.deactivatedAt || user.deletedAt) {
      throw new UnauthorizedException();
    }

    return { user, workspace };
  }

  private async validateApiKey(req: any, payload: JwtApiKeyPayload) {
    let ApiKeyModule: any;
    let isApiKeyModuleReady = false;

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ApiKeyModule = require('./../../../ee/api-key/api-key.service');
      isApiKeyModuleReady = true;
    } catch (err) {
      this.logger.debug(
        'API Key module requested but enterprise module not bundled in this build',
      );
      isApiKeyModuleReady = false;
    }

    if (isApiKeyModuleReady) {
      const ApiKeyService = this.moduleRef.get(ApiKeyModule.ApiKeyService, {
        strict: false,
      });

      return ApiKeyService.validateApiKey(payload);
    }

    throw new UnauthorizedException('Enterprise API Key module missing');
  }
}
