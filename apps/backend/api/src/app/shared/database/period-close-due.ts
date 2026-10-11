/**
 * When an open accounting period is owed a close.
 *
 * A company gets the twelve periods of the calendar year it signs up in, so documents can be dated
 * anywhere in its fiscal year and the year-end close has a whole year to close. But the months
 * before it started using the product are not ITS months to close: a company created on 11 October
 * was told on its first day that January to September were overdue (QA U24), and every alert,
 * inbox and «what falls due» list led with nine closes nobody owed.
 *
 * A period is owed a close when it ended after the books started — the day the organization was
 * created — or when anything was posted in it (history migrated into those months makes them the
 * company's to close). One rule, as SQL, for every screen that reports late closes: they used to
 * disagree because each wrote its own.
 *
 * @param periodAlias the alias of `accounting_periods` in the caller's query.
 * @param organizationParam the bound parameter holding the organization id (`$1`, `:organizationId`).
 */
export function periodCloseDueSql(periodAlias: string, organizationParam: string): string {
  const p = periodAlias;
  return `(
    ${p}."end_date" >= (SELECT o."created_at"::date FROM "organizations" o WHERE o."id" = ${organizationParam})
    OR EXISTS (
      SELECT 1 FROM "journal_entries" je
       WHERE je."organization_id" = ${organizationParam}
         AND je."date" BETWEEN ${p}."start_date" AND ${p}."end_date"
    )
  )`;
}
