import { DataSource, Repository } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { FiscalYear } from '../accounting/entities/fiscal-year.entity';
import { FiscalCalendarService } from './fiscal-calendar.service';

/**
 * What "today" and "this year" mean for a tenant.
 *
 * ## The defect under test
 *
 * The four financial-statement routes built their own defaults:
 *
 * ```ts
 * const startDate = startDateStr ? new Date(startDateStr) : new Date(new Date().getFullYear(), 0, 1);
 * const endDate = endDateStr ? new Date(endDateStr) : new Date();
 * ```
 *
 * `new Date()` is the server's instant and the service renders it with `toISOString()`. The
 * containers run in UTC and every market this product sells into is behind it, so a report asked
 * for at 21:00 in Santo Domingo carried tomorrow's cut-off — and asked for at 21:00 on 31 January,
 * a period that spilled into February. `new Date(year, 0, 1)` is worse in the other direction: it
 * is *local* 1 January, which rendered in UTC is 31 December of the previous year for every
 * deployment east of Greenwich.
 *
 * The year boundary was wrong for a second reason that no time zone fixes. Many United States
 * filers close on 30 June or 30 September, and Latin American subsidiaries follow their parent's
 * year; `1 January` is simply not their year start, and the tenant's own `fiscal_years` rows say
 * what is.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('fiscal calendar', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let calendar: FiscalCalendarService;
  let organizations: Repository<Organization>;
  let fiscalYears: Repository<FiscalYear>;

  const created: string[] = [];

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env['DB_HOST'],
      port: Number(process.env['DB_PORT'] ?? 5432),
      username: process.env['DB_USERNAME'],
      password: process.env['DB_PASSWORD'] || undefined,
      database: process.env['DB_NAME'],
      synchronize: false,
      logging: false,
      entities: [`${__dirname}/../**/*.entity.{js,ts}`],
    });
    await dataSource.initialize();

    organizations = dataSource.getRepository(Organization);
    fiscalYears = dataSource.getRepository(FiscalYear);
    calendar = new FiscalCalendarService(organizations, fiscalYears);
  });

  afterAll(async () => {
    if (created.length) {
      await dataSource
        .createQueryBuilder()
        .delete()
        .from(Organization)
        .whereInIds(created)
        .execute();
    }
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  /** A tenant in a named zone, with an optional fiscal year. */
  async function tenant(options: {
    timezone?: string;
    country?: string;
    year?: { startDate: string; endDate: string };
  }): Promise<string> {
    const organization = await organizations.save(
      organizations.create({
        legalName: `Calendario ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: options.timezone ?? 'UTC',
        country: options.country ?? null,
      } as Partial<Organization>),
    );
    created.push(organization.id);

    if (options.year) {
      await fiscalYears.save(
        fiscalYears.create({
          organizationId: organization.id,
          startDate: options.year.startDate as unknown as Date,
          endDate: options.year.endDate as unknown as Date,
        }),
      );
    }
    return organization.id;
  }

  /**
   * The hour that used to break it: 21:00 in Santo Domingo is already the next day in UTC.
   *
   * Passed explicitly rather than pinned with `jest.useFakeTimers()`. These calls query
   * PostgreSQL, and freezing the timers freezes the driver's connection pool with them — the suite
   * hangs until the runner kills it.
   */
  const AT_2100_IN_SANTO_DOMINGO = new Date('2026-02-01T01:00:00.000Z');
  const MID_MARCH = new Date('2026-03-15T12:00:00.000Z');
  const NEW_YEARS_EVE_IN_UTC = new Date('2025-12-31T22:00:00.000Z');

  describe('today', () => {
    it('is the tenant’s calendar day, not the server’s', async () => {
      const dominican = await tenant({ timezone: 'America/Santo_Domingo' });
      const japanese = await tenant({ timezone: 'Asia/Tokyo' });

      // At this instant the server's own date is already 1 February.
      expect(AT_2100_IN_SANTO_DOMINGO.toISOString().slice(0, 10)).toBe('2026-02-01');
      // The Dominican tenant is still in January; the Japanese one is well into February.
      expect(await calendar.today(dominican, { at: AT_2100_IN_SANTO_DOMINGO })).toBe('2026-01-31');
      expect(await calendar.today(japanese, { at: AT_2100_IN_SANTO_DOMINGO })).toBe('2026-02-01');
    });

    it('falls back to the country’s zone when the tenant has not set one', async () => {
      // `organizations.timezone` defaults to 'UTC' and nothing ever set it, so the country is what
      // actually decides for the overwhelming majority of tenants.
      const bogota = await tenant({ timezone: 'UTC', country: 'CO' });
      expect(await calendar.today(bogota, { at: AT_2100_IN_SANTO_DOMINGO })).toBe('2026-01-31');
    });
  });

  describe('defaultPeriod', () => {
    it('runs from the tenant’s fiscal year start to today, not from 1 January', async () => {
      const juneFiler = await tenant({
        timezone: 'America/New_York',
        year: { startDate: '2025-07-01', endDate: '2026-06-30' },
      });

      expect(await calendar.defaultPeriod(juneFiler, { at: MID_MARCH })).toEqual({
        startDate: '2025-07-01',
        endDate: '2026-03-15',
      });
    });

    it('stops at today rather than running to the fiscal year end', async () => {
      const calendarFiler = await tenant({
        timezone: 'America/Santo_Domingo',
        year: { startDate: '2026-01-01', endDate: '2026-12-31' },
      });

      const period = await calendar.defaultPeriod(calendarFiler, { at: MID_MARCH });
      expect(period.endDate).toBe('2026-03-15');
      expect(period.endDate).not.toBe('2026-12-31');
    });

    it('falls back to 1 January of the tenant’s year when it has declared none', async () => {
      const noYears = await tenant({ timezone: 'America/Santo_Domingo' });
      expect(await calendar.defaultPeriod(noYears, { at: MID_MARCH })).toEqual({
        startDate: '2026-01-01',
        endDate: '2026-03-15',
      });
    });

    /** The year boundary in the direction the old code got wrong. */
    it('does not slip into the previous year for a tenant ahead of UTC', async () => {
      const tokyo = await tenant({ timezone: 'Asia/Tokyo' });
      // 07:00 on 1 January in Tokyo. `new Date(new Date().getFullYear(), 0, 1)` on a UTC server
      // would have produced 2025-01-01 here.
      expect(await calendar.defaultPeriod(tokyo, { at: NEW_YEARS_EVE_IN_UTC })).toEqual({
        startDate: '2026-01-01',
        endDate: '2026-01-01',
      });
    });
  });

  describe('resolvePeriod', () => {
    it('leaves the ends the caller named exactly where they were', async () => {
      const organizationId = await tenant({ timezone: 'America/Santo_Domingo' });
      expect(
        await calendar.resolvePeriod(organizationId, {
          startDate: '2024-03-01',
          endDate: '2024-03-31',
        }),
      ).toEqual({ startDate: '2024-03-01', endDate: '2024-03-31' });
    });

    it('fills in only the end the caller left out', async () => {
      const organizationId = await tenant({
        timezone: 'America/Santo_Domingo',
        year: { startDate: '2026-01-01', endDate: '2026-12-31' },
      });

      expect(
        await calendar.resolvePeriod(organizationId, { endDate: '2026-02-28' }, { at: MID_MARCH }),
      ).toEqual({ startDate: '2026-01-01', endDate: '2026-02-28' });
      expect(
        await calendar.resolvePeriod(organizationId, { startDate: '2026-02-01' }, { at: MID_MARCH }),
      ).toEqual({ startDate: '2026-02-01', endDate: '2026-03-15' });
    });
  });

  describe('fiscalYearContaining', () => {
    it('picks the year the date falls in, not merely the latest', async () => {
      const organizationId = await tenant({ timezone: 'America/Santo_Domingo' });
      for (const year of [
        { startDate: '2024-01-01', endDate: '2024-12-31' },
        { startDate: '2025-01-01', endDate: '2025-12-31' },
        { startDate: '2026-01-01', endDate: '2026-12-31' },
      ]) {
        await fiscalYears.save(
          fiscalYears.create({
            organizationId,
            startDate: year.startDate as unknown as Date,
            endDate: year.endDate as unknown as Date,
          }),
        );
      }

      expect(await calendar.fiscalYearContaining(organizationId, '2025-06-30')).toEqual({
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      });
    });

    it('is null when no declared year covers the date', async () => {
      const organizationId = await tenant({
        timezone: 'America/Santo_Domingo',
        year: { startDate: '2026-01-01', endDate: '2026-12-31' },
      });
      expect(await calendar.fiscalYearContaining(organizationId, '2020-05-05')).toBeNull();
    });
  });
});
