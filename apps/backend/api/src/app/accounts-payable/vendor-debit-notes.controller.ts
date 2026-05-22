
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

@Controller('vendor-debit-notes')
@UseGuards(JwtAuthGuard)
export class VendorDebitNotesController {
  constructor(
    private readonly vendorDebitNotesService: VendorDebitNotesService,
  ) {}

  @Post()
  create(
    @Body() createDto: CreateVendorDebitNoteDto,
    @CurrentUser() user: User,
  ) {
    return this.vendorDebitNotesService.create(createDto, user.organizationId);
  }

  @Get()
  findAll(@CurrentUser() user: User) {
    return this.vendorDebitNotesService.findAll(user.organizationId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.vendorDebitNotesService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateVendorDebitNoteDto,
    @CurrentUser() user: User,
  ) {
    return this.vendorDebitNotesService.update(
      id,
      updateDto,
      user.organizationId,
    );
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.vendorDebitNotesService.remove(id, user.organizationId);
  }
}
