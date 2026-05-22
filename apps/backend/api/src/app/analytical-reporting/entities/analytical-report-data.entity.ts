
import { ViewEntity, ViewColumn, DataSource } from 'typeorm';

@ViewEntity({
  name: 'analytical_report_data',
  materialized: true,
  expression: (dataSource: DataSource) =>
    dataSource
      .createQueryBuilder()
      .select('je.id', 'journal_entry_id')
      .addSelect('jel.id', 'journal_entry_line_id')
      .addSelect('je.organization_id', 'organization_id')
      .addSelect('jlv.ledger_id', 'ledger_id')
      .addSelect('je.date', 'date')
      .addSelect('EXTRACT(YEAR FROM je.date)', 'year')
      .addSelect('EXTRACT(MONTH FROM je.date)', 'month')
      .addSelect('EXTRACT(QUARTER FROM je.date)', 'quarter')
      .addSelect('jel.account_id', 'account_id')
      .addSelect('acc.code', 'account_code')
      .addSelect('acc.name', 'account_name')
      .addSelect('acc.type', 'account_type')
      .addSelect('acc.category', 'account_category')
      .addSelect('jlv.debit', 'debit')
      .addSelect('jlv.credit', 'credit')
      .addSelect("(jlv.debit - jlv.credit)", 'net_change')



      .addSelect("jel.dimensions ->> 'Centro de Costo'", 'cost_center')
      .addSelect("jel.dimensions ->> 'Proyecto'", 'project')
      .from('journal_entry_lines', 'jel')
      .innerJoin('journal_entries', 'je', 'jel.journal_entry_id = je.id')
      .innerJoin('accounts', 'acc', 'jel.account_id = acc.id')
      .innerJoin('journal_entry_line_valuations', 'jlv', 'jlv.journal_entry_line_id = jel.id')
      .where("je.status = 'Posted'"),
})
export class AnalyticalReportData {
  @ViewColumn() journal_entry_id: string;
  @ViewColumn() journal_entry_line_id: string;
  @ViewColumn() organization_id: string;
  @ViewColumn() ledger_id: string;
  @ViewColumn() date: Date;
  @ViewColumn() year: number;
  @ViewColumn() month: number;
  @ViewColumn() quarter: number;
  @ViewColumn() account_id: string;
  @ViewColumn() account_code: string;
  @ViewColumn() account_name: string;
  @ViewColumn() account_type: string;
  @ViewColumn() account_category: string;
  @ViewColumn() debit: number;
  @ViewColumn() credit: number;
  @ViewColumn() net_change: number;
  @ViewColumn() cost_center: string;
  @ViewColumn() project: string;
}