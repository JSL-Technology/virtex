
import { EventSubscriber, EntitySubscriberInterface, UpdateEvent, RemoveEvent, DataSource } from 'typeorm';
import { Injectable, Inject } from '@nestjs/common';
import { User } from '../entities/user.entity/user.entity';
import { UserCacheService } from '../../auth/modules/user-cache.service';
import { InjectDataSource } from '@nestjs/typeorm';

@Injectable()
@EventSubscriber()
export class UserSubscriber implements EntitySubscriberInterface<User> {
  constructor(
    @InjectDataSource() readonly dataSource: DataSource,
    private readonly userCacheService: UserCacheService
  ) {
    dataSource.subscribers.push(this);
  }

  listenTo() {
    return User;
  }

  async afterUpdate(event: UpdateEvent<User>) {
    // Invalidate cache when user is updated
    if (event.entity && event.entity.id) {
        await this.userCacheService.invalidate(event.entity.id);
    } else if (event.databaseEntity && event.databaseEntity.id) {
         await this.userCacheService.invalidate(event.databaseEntity.id);
    }
  }

  async afterRemove(event: RemoveEvent<User>) {
      // Invalidate cache when user is removed
      if (event.entity && event.entity.id) {
          await this.userCacheService.invalidate(event.entity.id);
      } else if (event.databaseEntity && event.databaseEntity.id) {
            await this.userCacheService.invalidate(event.databaseEntity.id);
      }
  }
}
