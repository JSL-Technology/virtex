import { ApiProperty } from '@nestjs/swagger';

/**
 * A cash waterfall: where the money started, what moved it, where it ended.
 *
 * ## Why the shape changed
 *
 * It used to carry `operatingIncome`, `costOfGoodsSold` and `operatingExpenses` — profit and loss
 * figures, presented as if they were cash movements — with an opening balance taken from the sum of
 * **every current asset**, receivables and inventory included, labelled as cash. The bars did not
 * add up to a movement in cash because they were never measuring one.
 *
 * These are the three activities of a cash flow statement, and they are taken from the statement
 * itself, so `openingBalance + operating + investing + financing = endingBalance` exactly.
 */
export class CashFlowWaterfallDto {
  @ApiProperty({ description: 'Efectivo y equivalentes al inicio del período.' })
  openingBalance: number;

  @ApiProperty({ description: 'Efectivo neto generado por actividades de operación.' })
  operating: number;

  @ApiProperty({ description: 'Efectivo neto usado en actividades de inversión.' })
  investing: number;

  @ApiProperty({ description: 'Efectivo neto por actividades de financiación.' })
  financing: number;

  @ApiProperty({ description: 'Efectivo y equivalentes al cierre del período.' })
  endingBalance: number;
}
