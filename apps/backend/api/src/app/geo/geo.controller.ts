import { Controller, Get, Req } from '@nestjs/common';
import { GeoService } from './geo.service';
import { Request } from 'express';

@Controller('geo')
export class GeoController {
  constructor(private readonly geoService: GeoService) {}

  @Get('location')
  getLocation(@Req() req: Request) {
    // Extract IP from various headers or socket
    let ip = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '';

    // Handle multiple IPs in x-forwarded-for (e.g. "client, proxy1, proxy2")
    if (ip.includes(',')) {
      ip = ip.split(',')[0].trim();
    }

    // If it's IPv6 mapped IPv4 (::ffff:127.0.0.1), clean it
    if (ip.startsWith('::ffff:')) {
      ip = ip.replace('::ffff:', '');
    }

    return this.geoService.getLocation(ip);
  }
}
