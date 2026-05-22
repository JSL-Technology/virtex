import { Injectable, Logger } from '@nestjs/common';
import * as geoip from 'geoip-lite';

export interface GeoLocation {
    country: string | null;
    city: string | null;
    region: string | null;
    ll: [number, number] | null; // Latitude, Longitude
    ip: string;
}

@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  // Set this to a country code (e.g., 'CO', 'DO', 'US') to globally simulate
  // that country for all requests in dev mode. Set to null to use real detection.
  private readonly DEBUG_COUNTRY_OVERRIDE: string | null = null;

  getLocation(ip: string): GeoLocation {

    // 1. Handle Debug Override
    if (process.env['NODE_ENV'] !== 'production' && this.DEBUG_COUNTRY_OVERRIDE) {
        this.logger.debug(`Using DEBUG_COUNTRY_OVERRIDE: ${this.DEBUG_COUNTRY_OVERRIDE}`);
        return { country: this.DEBUG_COUNTRY_OVERRIDE, city: 'Debug City', ll: [0, 0], ip };
    }

    // 2. Handle Localhost / Private IPs
    if (this.isLocalOrPrivate(ip)) {
      this.logger.debug(`Local or Private IP detected: ${ip}. Defaulting to 'DO' (Dominican Republic) for dev.`);
      // Default to DO for localhost development if not overridden
      return { country: 'DO', city: 'Santo Domingo', region: 'Distrito Nacional', ll: [18.4861, -69.9312], ip };
    }

    // 3. Real Lookup
    const geo = geoip.lookup(ip);
    this.logger.debug(`Geo lookup for ${ip}: ${JSON.stringify(geo)}`);

    return {
      country: geo ? geo.country : null,
      city: geo ? geo.city : null,
      region: geo ? geo.region : null,
      ll: geo ? geo.ll : null,
      ip
    };
  }

  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Radius of the earth in km
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in km
    return d;
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  private isLocalOrPrivate(ip: string): boolean {
    return (
      ip === '::1' ||
      ip === '127.0.0.1' ||
      ip.startsWith('192.168.') ||
      ip.startsWith('10.') ||
      ip.startsWith('172.16.')
    );
  }
}
