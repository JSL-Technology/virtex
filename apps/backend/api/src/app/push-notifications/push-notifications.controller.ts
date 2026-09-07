import { Controller, Post, Body, Delete, UseGuards, Req } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PushSubscription } from './entities/push-subscription.entity';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AuthenticatedOnly } from '../auth/decorators/authenticated-only.decorator';


@Controller('push')
@UseGuards(JwtAuthGuard)
@AuthenticatedOnly(
  'Subscribing and unsubscribing the caller\'s own browser or device from push. The subscription is\n' +
  'keyed to the user; there is nothing here another permission could scope.',
)
export class PushNotificationsController {
  constructor(
    @InjectRepository(PushSubscription)
    private readonly pushSubscriptionRepository: Repository<PushSubscription>,
  ) {}

  @Post('subscribe')
  async subscribe(
    @Body() subscriptionDto: { endpoint: string; p256dh: string; auth: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const subscription = this.pushSubscriptionRepository.create({
      ...subscriptionDto,
      userId: user.id,
    });
    await this.pushSubscriptionRepository.save(subscription);
    return { success: true };
  }

  @Delete('unsubscribe')
  async unsubscribe(
    @Body() body: { endpoint: string },
    @CurrentUser() user: AuthenticatedUser,
    ) {
    await this.pushSubscriptionRepository.delete({ endpoint: body.endpoint, userId: user.id });
    return { success: true };
  }
}
