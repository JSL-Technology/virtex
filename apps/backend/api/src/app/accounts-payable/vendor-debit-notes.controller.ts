
import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Param,
  Patch,
  Delete,
  ParseUUIDPipe,
} from '@nestjs/common';
import { VendorDebitNotesService } from './vendor-debit-notes.service';
import { CreateVendorDebitNoteDto } from './dto/create-vendor-debit-note.dto';
import { UpdateVendorDebitNoteDto } from './dto/update-vendor-debit-note.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('vendor-debit-notes')
@UseGuards(JwtAuthGuard)
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
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.vendorDebitNotesService.findOne(id, user.organizationId);
  }

  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_EDIT)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateVendorDebitNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendorDebitNotesService.update(
      id,
      updateDto,
      user.organizationId,
    );
  }

  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VOID)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.vendorDebitNotesService.remove(id, user.organizationId);
  }
}
