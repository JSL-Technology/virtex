import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { IsIsoDate } from '../../common/validators/is-iso-date.validator';
import { ExchangeRateFeedStatus } from '../entities/exchange-rate-feed.entity';

/** An operator's reading of a feed: the days to read (by publication), and whether to write past its bound. */
export class RunOfficialRateFeedDto {
  @IsOptional()
  @IsIsoDate()
  from?: string;

  @IsOptional()
  @IsIsoDate()
  to?: string;

  /**
   * Write figures that moved more than the feed's daily bound — a devaluation the operator has
   * confirmed against the publication. Without it such a figure is reported and not written.
   */
  @IsOptional()
  @IsBoolean()
  acceptJumps?: boolean;
}

export class SetOfficialRateFeedStatusDto {
  @IsIn(Object.values(ExchangeRateFeedStatus))
  status: ExchangeRateFeedStatus;
}

export class OfficialRateFeedRunsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
