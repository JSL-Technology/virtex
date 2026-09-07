import { Controller, Get, Post, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AuthenticatedOnly } from '../auth/decorators/authenticated-only.decorator';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';


@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @AuthenticatedOnly(
    'The caller\'s own notification inbox: reading it, and marking their own items as read.',
  )
  getNotifications(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.getNotifications(user.id);
  }

  @Post('test-notification')
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_COMPANY)
  testCreateNotification(@CurrentUser() user: AuthenticatedUser) {
    const testTitle = '¡Notificación de Prueba!';
    const testBody = `Hola ${user.firstName}, esto es un mensaje para verificar que las notificaciones funcionan.`;
    return this.notificationsService.createNotification(user.id, testTitle, testBody);
  }

  @Post(':id/read')
  @AuthenticatedOnly(
    'The caller\'s own notification inbox: reading it, and marking their own items as read.',
  )
  markAsRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser
    ) {
    return this.notificationsService.markAsRead(id, user.id);
  }

  @Post('read-all')
  @AuthenticatedOnly(
    'The caller\'s own notification inbox: reading it, and marking their own items as read.',
  )
  markAllAsRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markAllAsRead(user.id);
  }
}
