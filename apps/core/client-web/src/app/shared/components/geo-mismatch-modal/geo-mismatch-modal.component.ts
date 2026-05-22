import { Component, inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { GeoLocationService } from '../../../core/services/geo-location.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-geo-mismatch-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './geo-mismatch-modal.component.html',
  styleUrls: ['./geo-mismatch-modal.component.scss']
})
export class GeoMismatchModalComponent {
  public geoLocationService = inject(GeoLocationService);
  private router = inject(Router);
  private document = inject(DOCUMENT);

  getCountryName(code: string): string {
    const map: Record<string, string> = {
      'DO': 'República Dominicana',
      'CO': 'Colombia',
      'US': 'Estados Unidos',
      'ES': 'España',
      'MX': 'México'
    };
    return map[code.toUpperCase()] || code.toUpperCase();
  }

  close() {
    this.geoLocationService.mismatchSignal.set(null);
  }

  switchCountry(targetCountryCode: string) {
    const url = this.router.url;
    // Split URL: /es/do/auth/register -> ['', 'es', 'do', 'auth', 'register']
    const segments = url.split('/');

    // Check if index 2 is indeed the country code.
    // This is a heuristic. For strict correctness we would need to know the route structure matches /:lang/:country
    // But given the context of "mismatch", we are almost certainly on a country-specific route.
    if (segments.length > 2) {
      segments[2] = targetCountryCode.toLowerCase();
      const newUrl = segments.join('/');
      this.document.location.href = newUrl;
    } else {
        // Fallback if URL structure is weird (e.g. at root with query params? Unlikely given CountryGuard)
        // Just reload to root
        this.close();
    }
  }
}
