
import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { ManufacturingService } from './manufacturing.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('manufacturing')
@UseGuards(AuthGuard('jwt'))
export class ManufacturingController {
  constructor(private readonly manufacturingService: ManufacturingService) {}

  @Get('orders')
  findAllOrders() {
    return this.manufacturingService.findAllOrders();
  }

  @Post('orders')
  createOrder(@Body() createOrderDto: any) {
    return this.manufacturingService.createOrder(createOrderDto);
  }
}
