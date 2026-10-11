import { Pipe, PipeTransform, inject } from '@angular/core';
import { LocaleStore } from '@virteex/shared/ui-i18n';
import { formatInternational, formatNational, regionForE164 } from '../utils/phone.util';

/**
 * A stored phone number as people write it — «(809) 555-7788», «55 1234 5678», «601 5550100» —
 * not «8095557788» (QA U50).
 *
 * In any market: a number of the company's own country is shown in that country's national
 * format; one from elsewhere keeps its international prefix, so it can still be dialled. With no
 * company country known, a number with its prefix is shown internationally and one without it is
 * left as stored — guessing a country would format it wrongly. Unparseable input is shown as stored.
 */
@Pipe({ name: 'vxPhone', standalone: true, pure: true })
export class PhonePipe implements PipeTransform {
  private readonly locale = inject(LocaleStore);

  transform(value: string | null | undefined): string {
    const raw = (value ?? '').trim();
    if (!raw) return '';
    const home = (this.locale.tenantContext()?.countryCode ?? '').toUpperCase() || null;
    const region = raw.startsWith('+') ? regionForE164(raw) : home;
    if (!region) return raw;
    if (home && region !== home) return formatInternational(raw);
    return formatNational(raw, region);
  }
}
