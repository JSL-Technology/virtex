import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { MarketReturnFiling, ReturnPeriod } from '../../markets/contracts';
import { returnFilingFor, returnFilingsOf } from '../../markets';
import { Organization } from '../../organizations/entities/organization.entity';
import {
  BadRequestError,
  NotFoundError,
  UnprocessableEntityError,
} from '../../i18n/localized.exception';
import { ReturnDatasetFactory } from './return-dataset';

/** One of a market's filings, as the client lists them. */
export interface ReturnFilingView {
  code: string;
  labelKey: string;
  periodicity: MarketReturnFiling['periodicity'];
  mediaType: string;
  extension: string;
  tracked: boolean;
  options: readonly { name: string; labelKey: string; kind: string; values?: readonly string[]; required: boolean }[];
}

/** A built return: the file, what it is called, and how many records it declares. */
export interface GeneratedReturn {
  code: string;
  fileName: string;
  mediaType: string;
  body: string;
  records: number;
  tracked: boolean;
}

/**
 * The engine that builds any market's periodic return.
 *
 * It resolves which filing was asked for from the company's own market, checks the options the
 * authority asks for, assembles the period's facts (`ReturnDatasetFactory`) and hands them to that
 * market's generator. It knows no authority and no format: the Dominican formats used to be four
 * methods of the compliance service reading `Repository<Invoice>`, each guarded by a country check
 * written by hand, and Mexico's three XML documents were three more
 * (docs/ARQUITECTURA_MERCADOS.md, fase 5).
 */
@Injectable()
export class ReturnsService {
  constructor(
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    private readonly datasets: ReturnDatasetFactory,
  ) {}

  /** What this company's market files, for the screen that offers them. */
  async available(organizationId: string): Promise<ReturnFilingView[]> {
    const organization = await this.require(organizationId);
    return returnFilingsOf(organization.country).map((filing) => ({
      code: filing.code,
      labelKey: filing.labelKey,
      periodicity: filing.periodicity,
      mediaType: filing.mediaType,
      extension: filing.extension,
      tracked: filing.tracked,
      options: (filing.options ?? []).map((option) => ({
        name: option.name,
        labelKey: option.labelKey,
        kind: option.kind,
        values: option.values,
        required: option.required ?? false,
      })),
    }));
  }

  /**
   * Build one filing for one period.
   *
   * A code this market does not file is a 404 and not an empty file: a Mexican tenant asking for a
   * 607 is asking for a document that does not exist for them, and producing a plausible-looking
   * file that means nothing to their authority is the worse answer.
   */
  async generate(
    organizationId: string,
    code: string,
    period: { year: number; month: number; ledgerId?: string },
    options: Readonly<Record<string, string | undefined>> = {},
  ): Promise<GeneratedReturn> {
    const organization = await this.require(organizationId);
    const filing = returnFilingFor(organization.country, code);
    if (!filing) {
      throw new NotFoundError('compliance.return_not_filed_in_this_market', {
        code,
        country: organization.country ?? '—',
      });
    }

    const dataset = this.datasets.of({ organization, year: period.year, month: period.month, ledgerId: period.ledgerId });
    const result = await filing.build(dataset, this.checkedOptions(filing, options));
    if (result.refusal) {
      throw new UnprocessableEntityError(result.refusal.messageKey, result.refusal.params);
    }

    return {
      code: filing.code,
      fileName: filing.fileName(dataset.period),
      mediaType: filing.mediaType,
      body: result.file,
      records: result.records,
      tracked: filing.tracked,
    };
  }

  /** Whether this company's market tracks a filing month by month in the calendar. */
  async isTracked(organizationId: string, code: string): Promise<boolean> {
    const organization = await this.require(organizationId);
    return returnFilingFor(organization.country, code)?.tracked ?? false;
  }

  /** The period, for a caller that needs its bounds before building anything. */
  period(year: number, month: number): ReturnPeriod {
    return this.datasets.of({ organization: new Organization(), year, month }).period;
  }

  /**
   * The options as the filing declares them: nothing else is passed through.
   *
   * An option the authority does not define is refused rather than ignored — a caller that sends
   * `tipoEnvio` to a filing that has no such thing believes it said something — and a choice
   * outside the published values, or a date that is not one, is refused for the same reason.
   */
  private checkedOptions(
    filing: MarketReturnFiling,
    sent: Readonly<Record<string, string | undefined>>,
  ): Record<string, string> {
    const declared = new Map((filing.options ?? []).map((option) => [option.name, option]));
    const checked: Record<string, string> = {};

    for (const [name, value] of Object.entries(sent)) {
      if (value === undefined || value === '') continue;
      const option = declared.get(name);
      if (!option) {
        throw new BadRequestError('compliance.return_option_not_declared', { option: name, code: filing.code });
      }
      if (option.kind === 'CHOICE' && !(option.values ?? []).includes(value)) {
        throw new BadRequestError('compliance.return_option_value_not_allowed', {
          option: name,
          value,
          values: (option.values ?? []).join(', '),
        });
      }
      if (option.kind === 'DATE' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new BadRequestError('compliance.return_option_date_expected', { option: name, value });
      }
      checked[name] = value;
    }

    for (const option of filing.options ?? []) {
      if (option.required && !checked[option.name]) {
        throw new BadRequestError('compliance.return_option_required', { option: option.name, code: filing.code });
      }
    }
    return checked;
  }

  private async require(organizationId: string): Promise<Organization> {
    const organization = await this.organizations.findOne({ where: { id: organizationId } });
    if (!organization) throw new NotFoundError('compliance.organization_not_found');
    return organization;
  }
}
