import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../../security/decorators/current-user.decorator';
import { HasPermission } from '../../security/decorators/permissions.decorator';
import { AuthenticatedOnly } from '../../security/decorators/authenticated-only.decorator';
import { AuthenticatedUser } from '../../security/principal';
import { PERMISSIONS } from '../../shared/permissions';
import { AllowInactiveSubscription } from '../../saas/decorators/allow-inactive-subscription.decorator';
import { OrganizationInvitationsService } from './organization-invitations.service';

/**
 * Invitations to an existing account.
 *
 * Two audiences, two kinds of route:
 *
 *  - The ADDRESSEE answers (`received`, `accept`, `decline`). Being signed in as the addressee is
 *    the whole authorisation — the service matches the invitation to the caller's own id — and it
 *    must work from whichever tenant they are acting in, including one whose subscription lapsed.
 *  - The INVITING tenant lists and withdraws what it sent, under the same permissions that govern
 *    inviting in the first place.
 */
@ApiTags('Users')
@Controller('invitations')
export class OrganizationInvitationsController {
  constructor(private readonly invitations: OrganizationInvitationsService) {}

  @Get('received')
  @AllowInactiveSubscription()
  @AuthenticatedOnly(
    'The caller\'s own pending invitations, matched to their user id. Answering an invitation is\n' +
    'a decision about one\'s own account, not an act inside the tenant they happen to be in.',
  )
  @ApiOperation({ summary: 'Invitations waiting for the signed-in person to answer' })
  received(@CurrentUser() user: AuthenticatedUser) {
    return this.invitations.listReceived(user.id);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @AllowInactiveSubscription()
  @AuthenticatedOnly(
    'Accepting joins the CALLER to the inviting tenant; the service refuses any invitation not\n' +
    'addressed to the caller\'s own id.',
  )
  @ApiOperation({ summary: 'Accept an invitation addressed to the signed-in person' })
  async accept(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    const { organizationId } = await this.invitations.accept(id, user.id);
    return { messageKey: 'users.invitation_accepted', organizationId };
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @AllowInactiveSubscription()
  @AuthenticatedOnly(
    'Declining affects only the caller\'s own invitation; the service matches it to their id.',
  )
  @ApiOperation({ summary: 'Decline an invitation addressed to the signed-in person' })
  async decline(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.invitations.decline(id, user.id);
    return { messageKey: 'users.invitation_declined' };
  }

  @Get('sent')
  @HasPermission(PERMISSIONS.USERS_VIEW)
  @ApiOperation({ summary: 'Invitations this organization has sent that are still pending' })
  sent(@CurrentUser() user: AuthenticatedUser) {
    return this.invitations.listSent(user.organizationId);
  }

  @Delete(':id')
  @HasPermission(PERMISSIONS.USERS_CREATE)
  @ApiOperation({ summary: 'Withdraw a pending invitation this organization sent' })
  async revoke(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.invitations.revoke(id, user.organizationId);
    return { messageKey: 'users.invitation_revoked' };
  }
}
