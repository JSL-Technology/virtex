
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { IntercompanyService } from './intercompany.service';
import { CreateIntercompanyTransactionDto } from './dto/create-intercompany-transaction.dto';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@Controller('intercompany')
@UseGuards(JwtAuthGuard)
export class IntercompanyController {
  constructor(private readonly intercompanyService: IntercompanyService) {}

  @Post('transactions')
  createTransaction(@Body() dto: CreateIntercompanyTransactionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.intercompanyService.create(dto, user.organizationId);
  }
}