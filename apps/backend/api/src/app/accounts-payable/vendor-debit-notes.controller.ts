
import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Param,
  Patch,
  Delete,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Idempotent } from '../shared/idempotency/idempotent.decorator';
import { VoidVendorDebitNoteDto } from './dto/void-vendor-debit-note.dto';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { VendorDebitNotesService } from './vendor-debit-notes.service';
import { CreateVendorDebitNoteDto } from './dto/create-vendor-debit-note.dto';
import { UpdateVendorDebitNoteDto } from './dto/update-vendor-debit-note.dto';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('vendor-debit-notes')
export class VendorDebitNotesController {
  constructor(
    private readonly vendorDebitNotesService: VendorDebitNotesService,
  ) {}

  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_CREATE)
  @Post()
  create(
    @Body() createDto: CreateVendorDebitNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendorDebitNotesService.create(createDto, user.organizationId);
  }

  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VIEW)
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.vendorDebitNotesService.findAll(user.organizationId);
  }

  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VIEW)
  @Get(':id')
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.vendorDebitNotesService.findOne(id, user.organizationId);
  }

  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_EDIT)
  @Patch(':id')
  update(
    @Param('id', UuidParamPipe) id: string,
    @Body() updateDto: UpdateVendorDebitNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendorDebitNotesService.update(
      id,
      updateDto,
      user.organizationId,
    );
  }

  /** Void: reverse the note's entry and restore the bill's balance. The only correction there is. */
  @Post(':id/void')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VOID)
  voidNote(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: VoidVendorDebitNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendorDebitNotesService.voidNote(id, user.organizationId, dto, user.id);
  }

  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VOID)
  @Delete(':id')
  remove(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.vendorDebitNotesService.remove(id, user.organizationId);
  }
}
