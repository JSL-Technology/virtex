import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FixedAssetsService } from './fixed-assets.service';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto';
import { UpdateFixedAssetDto } from './dto/update-fixed-asset.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { DisposeAssetDto } from './dto/dispose-asset.dto';

@Controller('fixed-assets')
@UseGuards(JwtAuthGuard)
export class FixedAssetsController {
  constructor(private readonly fixedAssetsService: FixedAssetsService) {}

  @Post()
  create(@Body() createFixedAssetDto: CreateFixedAssetDto, @CurrentUser() user: User) {

    return this.fixedAssetsService.create(createFixedAssetDto, user.organizationId);
  }

  @Get()
  findAll(@CurrentUser() user: User) {

    return this.fixedAssetsService.findAll(user.organizationId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {

    return this.fixedAssetsService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateFixedAssetDto: UpdateFixedAssetDto,
    @CurrentUser() user: User,
  ) {

    return this.fixedAssetsService.update(id, updateFixedAssetDto, user.organizationId);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {

    return this.fixedAssetsService.remove(id, user.organizationId);
  }

  @Post(':id/dispose')
  dispose(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() disposeDto: DisposeAssetDto,
    @CurrentUser() user: User,
  ) {
    return this.fixedAssetsService.dispose(id, disposeDto, user.organizationId);
  }
}