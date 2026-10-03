import { CallHandler, ExecutionContext } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { firstValueFrom, of } from 'rxjs';
import { UserResponseDto } from './dto/user-response.dto';
import { I18nService } from '../i18n/i18n.service';
import { LocaleInterceptor } from '../i18n/locale.interceptor';
import { TenantCurrencyPort } from '../i18n/ports/tenant-currency.port';

/**
 * The session's locale context states the tenant's real currency and country (QA A-12).
 *
 * It read `organization.currency` and `organization.countryCode`, which the organization entity
 * does not have: every tenant was sent `USD` and no country, so a Dominican-peso company saw its
 * dashboard and new documents in dollars.
 */
describe('LocaleInterceptor', () => {
  const http = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({}) }) } as unknown as ExecutionContext;

  const user = (organization: Record<string, unknown>) =>
    plainToInstance(
      UserResponseDto,
      { id: 'u-1', email: 'a@b.test', organization },
      { excludeExtraneousValues: true },
    );

  async function run(body: unknown, port?: TenantCurrencyPort) {
    const interceptor = new LocaleInterceptor(new I18nService(), port);
    const handler: CallHandler = { handle: () => of(body) };
    return firstValueFrom(interceptor.intercept(http, handler));
  }

  const dop: TenantCurrencyPort = { functionalCurrency: jest.fn(async () => 'DOP') };

  beforeEach(() => jest.clearAllMocks());

  it("formats in the tenant's books currency and country, not USD", async () => {
    const dto = user({ id: 'org-1', legalName: 'Nortex', slug: 'nortex', country: 'do', timezone: 'America/Santo_Domingo' });
    await run(dto, dop);

    expect(dto.organization?.countryCode).toBe('DO');
    expect(dto.organization?.currency).toBe('DOP');
    expect(dto.localeContext).toEqual(
      expect.objectContaining({ currency: 'DOP', countryCode: 'DO', timezone: 'America/Santo_Domingo' }),
    );
  });

  it('asks once per tenant, however many users the response carries', async () => {
    const a = user({ id: 'org-1', legalName: 'A', slug: 'a' });
    const b = user({ id: 'org-1', legalName: 'A', slug: 'a' });
    await run({ data: [a, b] }, dop);

    expect(dop.functionalCurrency).toHaveBeenCalledTimes(1);
    expect(b.localeContext?.currency).toBe('DOP');
  });

  it('still serves the session when the currency cannot be read', async () => {
    const failing: TenantCurrencyPort = { functionalCurrency: jest.fn(async () => { throw new Error('db down'); }) };
    const dto = user({ id: 'org-1', legalName: 'A', slug: 'a' });
    await run({ user: dto }, failing);

    expect(dto.localeContext?.currency).toBe('USD');
  });

  it('does not take free text for a country', async () => {
    const dto = user({ id: 'org-1', legalName: 'A', slug: 'a', country: 'República Dominicana' });
    await run(dto, dop);
    expect(dto.organization?.countryCode).toBeNull();
  });

  it('leaves responses without users untouched', async () => {
    const body = { rows: [{ id: 1 }] };
    expect(await run(body, dop)).toBe(body);
    expect(dop.functionalCurrency).not.toHaveBeenCalled();
  });
});
