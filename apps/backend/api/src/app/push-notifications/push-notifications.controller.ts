import { Body, Controller, Delete, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PushSubscription } from './entities/push-subscription.entity';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { AuthenticatedOnly } from '../security/decorators/authenticated-only.decorator';
import { SubscribePushDto, UnsubscribePushDto } from './dto/push-subscription.dto';

@Controller('push')
@AuthenticatedOnly(
  'Subscribing and unsubscribing the caller\'s own browser or device from push. The subscription is\n' +
  'keyed to the user; there is nothing here another permission could scope.',
)
export class PushNotificationsController {
  constructor(
    @InjectRepository(PushSubscription)
    private readonly pushSubscriptionRepository: Repository<PushSubscription>,
  ) {}

  /**
   * Register this browser for the signed-in user.
   *
   * Keyed by (user, endpoint) and written with an upsert, never by a caller-supplied id: the previous
   * `create({ ...body })` + `save()` treated an `id` in the body as "update that row", so any user
   * could take over anyone's subscription (PLT-NOT-01). An endpoint already registered to ANOTHER
   * user moves to this one: it identifies a browser, and that browser is now signed in as this user.
   */
  @Post('subscribe')
  @HttpCode(HttpStatus.OK)
  async subscribe(@Body() dto: SubscribePushDto, @CurrentUser() user: AuthenticatedUser) {
    await this.pushSubscriptionRepository.manager.transaction(async (manager) => {
      await manager.delete(PushSubscription, { endpoint: dto.endpoint });
      await manager.insert(PushSubscription, {
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userId: user.id,
      });
    });
    return { success: true };
  }

  @Delete('unsubscribe')
  @HttpCode(HttpStatus.OK)
  async unsubscribe(@Body() dto: UnsubscribePushDto, @CurrentUser() user: AuthenticatedUser) {
    await this.pushSubscriptionRepository.delete({ endpoint: dto.endpoint, userId: user.id });
    return { success: true };
  }
}
