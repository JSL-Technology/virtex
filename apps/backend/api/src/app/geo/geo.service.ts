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
        return { country: this.DEBUG_COUNTRY_OVERRIDE, city: 'Debug City', region: null, ll: [0, 0], ip };
    }

    // 2. Handle Localhost / Private IPs
    //
    // Outside development this returns NOTHING, not a plausible-looking placeholder.
    //
    // The placeholder used to be returned unconditionally, and this branch is reachable in
    // production far more often than it looks: behind a load balancer, a Kubernetes ingress or
    // any reverse proxy where `TRUST_PROXY` is not configured, `request.ip` IS a private
    // address. Every session then rendered as "Santo Domingo, República Dominicana" with real
    // coordinates on the "Active sessions" screen — the screen a user reads to spot an intruder —
    // and those same fabricated coordinates fed the impossible-travel calculation.
    //
    // An unknown location is honest and the UI already renders it as unknown. A fabricated one
    // is worse than no location at all, because it is believed.
    if (this.isLocalOrPrivate(ip)) {
      if (this.isDevelopment()) {
        this.logger.debug(`Local or private IP ${ip}: using the development placeholder location.`);
        return { country: 'DO', city: 'Santo Domingo', region: 'Distrito Nacional', ll: [18.4861, -69.9312], ip };
      }
      this.logger.debug(`Local or private IP ${ip}: no location can be determined.`);
      return { country: null, city: null, region: null, ll: null, ip };
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

  /** True only in the environments where a placeholder location is acceptable. */
  private isDevelopment(): boolean {
    const env = process.env['NODE_ENV'];
    return env === undefined || env === 'development' || env === 'test';
  }

  /**
   * Every address range that cannot be geolocated, not the five that were listed.
   *
   * The previous list matched `172.16.` and stopped, missing `172.17.`–`172.31.` — which
   * includes `172.17.0.0/16`, Docker's default bridge, so a containerised deployment took the
   * "real lookup" branch and silently produced null locations while a bare-metal one produced
   * fabricated ones. It also missed IPv4-mapped IPv6 (`::ffff:10.0.0.1`), link-local, CGNAT and
   * IPv6 unique-local addresses.
   */
  private isLocalOrPrivate(ip: string): boolean {
    if (!ip) return true;

    // A proxy chain may arrive as a comma-separated list; the first entry is the client.
    const raw = ip.split(',')[0].trim().toLowerCase();
    // Normalise IPv4-mapped IPv6 (`::ffff:192.168.0.1`) to its IPv4 form.
    const value = raw.startsWith('::ffff:') ? raw.slice(7) : raw;

    if (value === '::1' || value === 'localhost' || value === '0.0.0.0' || value === '::') return true;
    // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd][0-9a-f]{2}:/.test(value) || value.startsWith('fe80:')) return true;

    const octets = value.split('.').map(Number);
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return false;
    }
    const [a, b] = octets;
    return (
      a === 127 ||                          // loopback
      a === 10 ||                           // 10.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) ||  // 172.16.0.0/12 — Docker's default bridge lives here
      (a === 192 && b === 168) ||           // 192.168.0.0/16
      (a === 169 && b === 254) ||           // link-local
      (a === 100 && b >= 64 && b <= 127)    // 100.64.0.0/10, carrier-grade NAT
    );
  }
}
