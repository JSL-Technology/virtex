
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { BalanceUpdateService } from '../chart-of-accounts/balance-update.service';

@Controller('health')
export class HealthController {
  constructor(private readonly balanceUpdateService: BalanceUpdateService) {}

  @Get('queues')
  @UseGuards(JwtAuthGuard)
  async getQueueHealth() {
    return this.balanceUpdateService.getQueueStatus();
  }
}