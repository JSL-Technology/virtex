
import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { JournalsService } from './journals.service';
import { CreateJournalDto } from './dto/journal.dto';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@Controller('journals')
@UseGuards(JwtAuthGuard)
export class JournalsController {
  constructor(private readonly journalsService: JournalsService) {}

  @Post()
  create(@Body() createJournalDto: CreateJournalDto, @CurrentUser() user: AuthenticatedUser) {
    return this.journalsService.create(createJournalDto, user.organizationId);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.journalsService.findAll(user.organizationId);
  }
}