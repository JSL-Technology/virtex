import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { SaasService } from './saas.service';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { Public } from '../auth/decorators/public.decorator';
import { Request } from 'express';

@Controller('saas')
export class SaasController {
  constructor(private readonly saasService: SaasService) {}

  // Public: the registration page (unauthenticated) must list plans. Without
  // @Public() the global JwtAuthGuard returns 401, which the web client's auth
  // interceptor treats as an expired session — triggering a refresh + forced
  // logout that bounces the visitor to /auth/login.
  @Public()
  @Get('plans')
  getPlans() {
    return this.saasService.getPlans();
  }

  @Get('usage')
  @UseGuards(AuthGuard('jwt'))
  async getUsage(@Req() req: Request) {
    const user = req.user as AuthenticatedUser;
    if (!user.organizationId) {
        return [];
    }
    return this.saasService.getUsage(user.organizationId);
  }
}
