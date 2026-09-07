
import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { ManufacturingService } from './manufacturing.service';
import { AuthGuard } from '@nestjs/passport';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('manufacturing')
@UseGuards(AuthGuard('jwt'))
export class ManufacturingController {
  constructor(private readonly manufacturingService: ManufacturingService) {}

  @Get('orders')
  @HasPermission(PERMISSIONS.MANUFACTURING_VIEW)
  findAllOrders() {
    return this.manufacturingService.findAllOrders();
  }

  @Post('orders')
  @HasPermission(PERMISSIONS.MANUFACTURING_MANAGE)
  createOrder(@Body() createOrderDto: any) {
    return this.manufacturingService.createOrder(createOrderDto);
  }
}
