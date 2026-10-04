import { Controller, Get, Post, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../security/principal';
import { AuthenticatedOnly } from '../security/decorators/authenticated-only.decorator';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

/** A request for access to one screen, with an optional reason. */
export class AccessRequestDto {
  /** The path the user was refused, as the client router knows it. */
  @IsString()
  @MaxLength(300, { message: 'validation.constraints.max_length|{"max":300}' })
  @Matches(/^\/[^\s]*$/, { message: 'validation.constraints.matches' })
  path: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'validation.constraints.max_length|{"max":500}' })
  reason?: string;
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @AuthenticatedOnly(
    'The caller\'s own notification inbox: reading it, and marking their own items as read.',
  )
  getNotifications(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.getNotifications(user.id);
  }

  @Post('access-request')
  @HttpCode(HttpStatus.ACCEPTED)
  @AuthenticatedOnly(
    'Any member who was refused a screen may ask their own tenant\'s administrators for access; it grants nothing, it only notifies them.',
  )
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestAccess(@Body() dto: AccessRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.requestAccess(user, dto);
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
    @Param('id', UuidParamPipe) id: string,
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
