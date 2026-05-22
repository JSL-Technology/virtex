import { ApiProperty } from '@nestjs/swagger';

export class CashFlowWaterfallDto {
  @ApiProperty({ description: 'Saldo de efectivo al inicio del período.' })
  openingBalance: number;

  @ApiProperty({ description: 'Ingresos que generan entradas de efectivo.' })
  operatingIncome: number;

  @ApiProperty({ description: 'Costo de la mercancía vendida, como salida de efectivo.' })
  costOfGoodsSold: number;

  @ApiProperty({ description: 'Gastos operativos que resultan en salidas de efectivo.' })
  operatingExpenses: number;

  @ApiProperty({ description: 'Flujo de efectivo neto de actividades de inversión (ej. compra/venta de activos).' })
  investments: number;

  @ApiProperty({ description: 'Flujo de efectivo neto de actividades de financiación (ej. préstamos, capital).' })
  financing: number;

  @ApiProperty({ description: 'Saldo de efectivo al final del período, calculado como la suma de todos los componentes.' })
  endingBalance: number;
}
