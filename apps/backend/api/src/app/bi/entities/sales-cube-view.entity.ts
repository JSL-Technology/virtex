import { ViewEntity, ViewColumn } from 'typeorm';

@ViewEntity({
  name: 'sales_cube_view',
  expression: `
    -- La expresión SQL no es necesaria aquí si la vista ya está creada por una migración.
    -- TypeORM la usará si 'synchronize: true' está habilitado para crear la vista.
    -- La dejamos comentada o vacía ya que nuestra migración se encarga de la creación.
  `,
  synchronize: false,
})
export class SalesCubeView {
  @ViewColumn()
  line_id: string;

  @ViewColumn()
  quantity: number;

  @ViewColumn()
  price: number;

  @ViewColumn()
  total_amount: number;

  @ViewColumn()
  date: string;

  @ViewColumn()
  year: number;

  @ViewColumn()
  quarter: number;

  @ViewColumn()
  month: number;

  @ViewColumn()
  month_name: string;

  @ViewColumn()
  week: number;

  @ViewColumn()
  day_name: string;

  @ViewColumn()
  product_id: string;

  @ViewColumn()
  product_name: string;

  @ViewColumn()
  category_id: string;

  @ViewColumn()
  customer_id: string;

  @ViewColumn()
  customer_name: string;

  @ViewColumn()
  customer_country: string;

  @ViewColumn()
  organization_id: string;
}
