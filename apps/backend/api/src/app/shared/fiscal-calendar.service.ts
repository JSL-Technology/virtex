import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { FiscalYear } from '../accounting/entities/fiscal-year.entity';
import { IsoDate, toIsoDate } from '../common/dates';
import { fiscalDate, organizationTimeZone } from './fiscal-clock';

/** A reporting window, both ends inclusive. */
export interface ReportingPeriod {
  startDate: IsoDate;
  endDate: IsoDate;
}

export interface CalendarOptions {
  /** Run inside a caller's transaction. */
  manager?: EntityManager;
  /** The instant to read "now" from. Defaults to the real one; named so a test can pin a boundary. */
  at?: Date;
}

/**
 * What "today" and "this year" mean for a given tenant.
 *
 * ## The two defects this exists to close
 *
 * **The server's clock is not the tenant's calendar.** Every report route defaulted its period with
 * `new Date()` and `new Date(new Date().getFullYear(), 0, 1)`. The containers run in UTC and every
 * market this product sells into is behind it, so between 20:00 and midnight in Santo Domingo the
 * "as of today" cut-off was already **tomorrow** — a balance sheet that includes a day the tenant
 * has not lived yet, and on the last evening of a month, a period that spills into the next one.
 * The year boundary was worse in the other direction: read in the *server's* local calendar and
 * then rendered in UTC, 1 January becomes 31 December of the previous year for any deployment east
 * of Greenwich.
 *
 * **The fiscal year is not always the calendar year.** `1 January` is simply wrong for the many
 * United States filers whose year ends on 30 June or 30 September, and for the Latin American
 * subsidiaries that follow a foreign parent's year. The tenant's own `fiscal_years` rows say when
 * its year starts; nothing was reading them.
 */
@Injectable()
export class FiscalCalendarService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(FiscalYear)
    private readonly fiscalYearRepository: Repository<FiscalYear>,
  ) {}

  /**
   * The calendar day it is right now where the tenant keeps its books.
   *
   * `at` exists so the boundary can be tested at a fixed instant. Jest's fake timers cannot be used
   * for that here: this method queries PostgreSQL, and freezing the timers freezes the driver's
   * pool along with them.
   */
  async today(organizationId: string, options: CalendarOptions = {}): Promise<IsoDate> {
    const repository = options.manager
      ? options.manager.getRepository(Organization)
      : this.organizationRepository;
    const organization = await repository.findOne({
      where: { id: organizationId },
      select: ['id', 'country', 'timezone'],
    });
    return fiscalDate(organizationTimeZone(organization), options.at ?? new Date());
  }

  /**
   * The fiscal year `on` falls inside, if the tenant has declared one.
   *
   * Null rather than an invented range: a tenant that has not set up its years has no fiscal year,
   * and saying so lets the caller fall back explicitly instead of quietly reporting on a window
   * nobody chose.
   */
  async fiscalYearContaining(
    organizationId: string,
    on: IsoDate,
    manager?: EntityManager,
  ): Promise<ReportingPeriod | null> {
    const repository = manager
      ? manager.getRepository(FiscalYear)
      : this.fiscalYearRepository;
    const year = await repository.findOne({
      where: {
        organizationId,
        startDate: LessThanOrEqual(on as unknown as Date),
        endDate: MoreThanOrEqual(on as unknown as Date),
      },
      order: { startDate: 'DESC' },
    });
    if (!year) return null;
    return { startDate: toIsoDate(year.startDate), endDate: toIsoDate(year.endDate) };
  }

  /**
   * The period a report covers when the caller names neither end.
   *
   * Year-to-date within the tenant's own fiscal year: from the year's first day to today, never
   * past today. A window that runs to the fiscal year's end would show an income statement whose
   * period has not happened yet.
   */
  async defaultPeriod(
    organizationId: string,
    options: CalendarOptions = {},
  ): Promise<ReportingPeriod> {
    const endDate = await this.today(organizationId, options);
    const year = await this.fiscalYearContaining(organizationId, endDate, options.manager);
    return {
      startDate: year ? year.startDate : `${endDate.slice(0, 4)}-01-01`,
      endDate,
    };
  }

  /** Fill in whichever ends the caller left out, without moving the ones it gave. */
  async resolvePeriod(
    organizationId: string,
    requested: { startDate?: string; endDate?: string },
    options: CalendarOptions = {},
  ): Promise<ReportingPeriod> {
    if (requested.startDate && requested.endDate) {
      return { startDate: requested.startDate, endDate: requested.endDate };
    }
    const fallback = await this.defaultPeriod(organizationId, options);
    return {
      startDate: requested.startDate ?? fallback.startDate,
      endDate: requested.endDate ?? fallback.endDate,
    };
  }
}
