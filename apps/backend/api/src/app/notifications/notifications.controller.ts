import { Controller, Get, Post, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { User } from '../users/entities/user.entity/user.entity';


@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  getNotifications(@CurrentUser() user: User) {
    return this.notificationsService.getNotifications(user.id);
  }

  @Post('test-notification')
  testCreateNotification(@CurrentUser() user: User) {
    const testTitle = '¡Notificación de Prueba!';
    const testBody = `Hola ${user.firstName}, esto es un mensaje para verificar que las notificaciones funcionan.`;
    return this.notificationsService.createNotification(user.id, testTitle, testBody);
  }

  @Post(':id/read')
  markAsRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User
    ) {
    return this.notificationsService.markAsRead(id, user.id);
  }

  @Post('read-all')
  markAllAsRead(@CurrentUser() user: User) {
    return this.notificationsService.markAllAsRead(user.id);
  }
}
