import { Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';

@Injectable()
export class DomainMiddleware implements NestMiddleware {
  constructor(
    private workspaceRepo: WorkspaceRepo,
    private environmentService: EnvironmentService,
  ) {}
  async use(
    req: FastifyRequest['raw'],
    res: FastifyReply['raw'],
    next: () => void,
  ) {
    if (this.environmentService.isSelfHosted()) {
      const workspace = await this.workspaceRepo.findFirst();
      if (!workspace) {
        //throw new NotFoundException('Workspace not found');
        (req as any).workspaceId = null;
        return next();
      }

      // TODO: unify
      (req as any).workspaceId = workspace.id;
      (req as any).workspace = workspace;
    } else if (this.environmentService.isCloud()) {
      const header = req.headers.host || '';
      const subdomainHost = this.environmentService.getSubdomainHost();
      
      // Extract hostname without port
      const hostname = header.split(':')[0];
      
      // Check if this is the base domain (with or without port, with or without www)
      if (hostname === subdomainHost || hostname === `www.${subdomainHost}`) {
        // Base domain - allow for signup/workspace creation
        (req as any).workspaceId = null;
        (req as any).isBaseDomain = true;
        return next();
      }
      
      // Extract subdomain (first part before first dot)
      const subdomain = hostname.split('.')[0];

      // Lookup workspace by hostname
      const workspace = await this.workspaceRepo.findByHostname(subdomain);

      if (!workspace) {
        (req as any).workspaceId = null;
        return next();
      }

      (req as any).workspaceId = workspace.id;
      (req as any).workspace = workspace;
    }

    next();
  }
}
