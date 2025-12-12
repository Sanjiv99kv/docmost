import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { AuthService } from './services/auth.service';
import { SetupGuard } from './guards/setup.guard';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { PasswordResetDto } from './dto/password-reset.dto';
import { VerifyUserTokenDto } from './dto/verify-user-token.dto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { validateSsoEnforcement } from './auth.util';
import { ModuleRef } from '@nestjs/core';
import { Public } from '../../common/decorators/public.decorator';
import { TokenService } from './services/token.service';
import { JwtType, JwtExchangePayload } from './dto/jwt-payload';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private authService: AuthService,
    private environmentService: EnvironmentService,
    private moduleRef: ModuleRef,
    private tokenService: TokenService,
    private userRepo: UserRepo,
    private workspaceRepo: WorkspaceRepo,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @AuthWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() loginInput: LoginDto,
  ) {
    validateSsoEnforcement(workspace);

    let MfaModule: any;
    let isMfaModuleReady = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      MfaModule = require('./../../ee/mfa/services/mfa.service');
      isMfaModuleReady = true;
    } catch (err) {
      this.logger.debug(
        'MFA module requested but EE module not bundled in this build',
      );
      isMfaModuleReady = false;
    }
    if (isMfaModuleReady) {
      const mfaService = this.moduleRef.get(MfaModule.MfaService, {
        strict: false,
      });

      const mfaResult = await mfaService.checkMfaRequirements(
        loginInput,
        workspace,
        res,
      );

      if (mfaResult) {
        // If user has MFA enabled OR workspace enforces MFA, require MFA verification
        if (mfaResult.userHasMfa || mfaResult.requiresMfaSetup) {
          return {
            userHasMfa: mfaResult.userHasMfa,
            requiresMfaSetup: mfaResult.requiresMfaSetup,
            isMfaEnforced: mfaResult.isMfaEnforced,
          };
        } else if (mfaResult.authToken) {
          // User doesn't have MFA and workspace doesn't require it
          this.setAuthCookie(res, mfaResult.authToken);
          return;
        }
      }
    }

    const authToken = await this.authService.login(loginInput, workspace.id);
    this.setAuthCookie(res, authToken);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Get('exchange')
  async exchangeToken(
    @Query('token') token: string,
    @Res({ passthrough: true }) res: FastifyReply,
    @Req() req: FastifyRequest,
  ) {
    if (!token) {
      throw new BadRequestException('Token is required');
    }

    try {
      // Verify and decode the exchange token
      const payload = await this.tokenService.verifyJwt(token, JwtType.EXCHANGE) as JwtExchangePayload;

      // Get user and workspace
      const user = await this.userRepo.findById(payload.sub, payload.workspaceId);
      if (!user || user.deactivatedAt || user.deletedAt) {
        throw new UnauthorizedException('User not found or inactive');
      }

      const workspace = await this.workspaceRepo.findById(payload.workspaceId);
      if (!workspace) {
        throw new UnauthorizedException('Workspace not found');
      }

      // Generate new access token
      const authToken = await this.tokenService.generateAccessToken(user);

      // Set auth cookie with domain for cloud mode
      this.setAuthCookie(res, authToken);

      // Redirect to workspace home
      const subdomainHost = this.environmentService.getSubdomainHost();
      const redirectUrl = this.environmentService.isHttps()
        ? `https://${workspace.hostname}.${subdomainHost}`
        : `http://${workspace.hostname}.${subdomainHost}:${this.environmentService.getPort()}`;

      res.redirect(redirectUrl);
    } catch (error) {
      // Provide more specific error messages for debugging
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      // Type guard for Error objects
      if (error instanceof Error) {
        if (error.name === 'TokenExpiredError') {
          throw new UnauthorizedException('Exchange token has expired. Please try again.');
        }
        if (error.name === 'JsonWebTokenError') {
          throw new UnauthorizedException('Invalid exchange token format.');
        }
        throw new UnauthorizedException(`Invalid or expired token: ${error.message || 'Unknown error'}`);
      }
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('cloud-login')
  async cloudLogin(
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() loginInput: LoginDto,
    @Req() req: FastifyRequest,
  ) {
    // Only allow cloud login from base domain
    if (!this.environmentService.isCloud()) {
      throw new ForbiddenException('Cloud login is only available in cloud mode');
    }

    const header = req.headers.host || '';
    const subdomainHost = this.environmentService.getSubdomainHost();
    const hostname = header.split(':')[0];

    // Check if this is the base domain
    if (hostname !== subdomainHost && hostname !== `www.${subdomainHost}`) {
      throw new ForbiddenException('Cloud login is only allowed from the base domain');
    }

    const { authToken, workspace } = await this.authService.cloudLogin(loginInput);

    // Set auth cookie with domain for cloud mode
    this.setAuthCookie(res, authToken);

    // Return workspace info for redirect
    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        hostname: workspace.hostname,
      },
      redirectUrl: this.environmentService.isHttps()
        ? `https://${workspace.hostname}.${subdomainHost}`
        : `http://${workspace.hostname}.${subdomainHost}:${this.environmentService.getPort()}`,
    };
  }

  @UseGuards(SetupGuard)
  @HttpCode(HttpStatus.OK)
  @Post('setup')
  async setupWorkspace(
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() createAdminUserDto: CreateAdminUserDto,
  ) {
    const { workspace, authToken } =
      await this.authService.setup(createAdminUserDto);

    this.setAuthCookie(res, authToken);
    return workspace;
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.authService.changePassword(dto, user.id, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  async forgotPassword(
    @Body() forgotPasswordDto: ForgotPasswordDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    validateSsoEnforcement(workspace);
    return this.authService.forgotPassword(forgotPasswordDto, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @Post('password-reset')
  async passwordReset(
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() passwordResetDto: PasswordResetDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const result = await this.authService.passwordReset(
      passwordResetDto,
      workspace,
    );

    if (result.requiresLogin) {
      return {
        requiresLogin: true,
      };
    }

    // Set auth cookie if no MFA is required
    this.setAuthCookie(res, result.authToken);
    return {
      requiresLogin: false,
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('verify-token')
  async verifyResetToken(
    @Body() verifyUserTokenDto: VerifyUserTokenDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.authService.verifyUserToken(verifyUserTokenDto, workspace.id);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('collab-token')
  async collabToken(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.authService.getCollabToken(user, workspace.id);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@Res({ passthrough: true }) res: FastifyReply) {
    const cookieOptions: any = {
      path: '/',
    };

    if (this.environmentService.isCloud()) {
      const subdomainHost = this.environmentService.getSubdomainHost();
      if (subdomainHost) {
        cookieOptions.domain = '.' + subdomainHost;
      }
    }

    res.clearCookie('authToken', cookieOptions);
  }

  setAuthCookie(res: FastifyReply, token: string) {
    const cookieOptions: any = {
      httpOnly: true,
      path: '/',
      expires: this.environmentService.getCookieExpiresIn(),
      secure: this.environmentService.isHttps(),
      sameSite: 'lax', // Allow cookies on cross-site requests for subdomain redirects
    };

    // Add domain for cloud mode to enable cross-subdomain cookies
    if (this.environmentService.isCloud()) {
      const subdomainHost = this.environmentService.getSubdomainHost();
      if (subdomainHost) {
        cookieOptions.domain = '.' + subdomainHost;
      }
    }

    res.setCookie('authToken', token, cookieOptions);
  }
}
