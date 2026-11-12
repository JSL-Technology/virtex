import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Dominican Republic stops being every market's default chart of accounts (audit 2026-11-07,
 * FIN-COA-03, LOC-02, I18N-05; pattern SP-02).
 *
 * New tenants are provisioned from a neutral plan plus their country's pack (`coa-builder.ts`).
 * This migration brings the tenants that already exist to the same state, without touching anything
 * a person changed:
 *
 *  1. The payroll account ROLES are renamed to the kind of fund (`AFP_PAYABLE` →
 *     `PENSION_CONTRIBUTIONS_PAYABLE`…), and so are the three settings columns that point at them.
 *     Roles are internal identifiers, so every row is renamed, Dominican tenants included.
 *  2. An account NAME is changed only for a tenant outside the Dominican Republic, and only while it
 *     still reads exactly as the old template wrote it. A name somebody edited is theirs and stays.
 *  3. Mexican tenants receive the SAT grouping code on the template accounts that have none.
 *  4. A Brazilian or US tenant's account names, stored under `es` whatever their language, are moved
 *     to the key of the language the books are kept in, when `es` is the only key present.
 *
 * The names below are frozen copies of the templates at the time of writing, on purpose: a migration
 * that imported the live template would change meaning the next time the template changed.
 * The institution names are a starting point for each market (verificar con contador local).
 */
const ROLE_RENAMES: ReadonlyArray<[string, string]> = [
  ['AFP_PAYABLE', 'PENSION_CONTRIBUTIONS_PAYABLE'],
  ['SFS_PAYABLE', 'HEALTH_CONTRIBUTIONS_PAYABLE'],
  ['INFOTEP_PAYABLE', 'OTHER_PAYROLL_CONTRIBUTIONS_PAYABLE'],
];

const COLUMN_RENAMES: ReadonlyArray<[string, string]> = [
  ['default_afp_payable_account_id', 'default_pension_contributions_payable_account_id'],
  ['default_sfs_payable_account_id', 'default_health_contributions_payable_account_id'],
  ['default_infotep_payable_account_id', 'default_other_payroll_contributions_payable_account_id'],
];

/** Old Spanish template name → [role, neutral name, per-country override]. */
const SPANISH_RENAMES: ReadonlyArray<{ role: string; old: string; neutral: string; byCountry: Record<string, string> }> = [
  {
    role: 'PENSION_CONTRIBUTIONS_PAYABLE',
    old: 'AFP por Pagar (TSS)',
    neutral: 'Aportes de Pensión por Pagar',
    byCountry: {
      MX: 'Aportaciones SAR (Retiro, Cesantía y Vejez) por Pagar',
      CO: 'Aportes a Fondos de Pensiones por Pagar',
    },
  },
  {
    role: 'HEALTH_CONTRIBUTIONS_PAYABLE',
    old: 'SFS por Pagar (TSS)',
    neutral: 'Aportes de Salud por Pagar',
    byCountry: { MX: 'Cuotas IMSS por Pagar', CO: 'Aportes a EPS por Pagar' },
  },
  {
    role: 'OTHER_PAYROLL_CONTRIBUTIONS_PAYABLE',
    old: 'SRL e INFOTEP por Pagar',
    neutral: 'Otros Aportes Laborales por Pagar',
    byCountry: { MX: 'Aportaciones INFONAVIT por Pagar', CO: 'Aportes ARL y Parafiscales por Pagar' },
  },
  {
    role: 'PAYROLL_TAX_WITHHOLDING_PAYABLE',
    old: 'ISR de Empleados Retenido por Pagar',
    neutral: 'Impuesto sobre la Renta Retenido a Empleados por Pagar',
    byCountry: {
      MX: 'ISR Retenido por Sueldos y Salarios por Pagar',
      CO: 'Retención en la Fuente por Salarios por Pagar',
    },
  },
  {
    role: 'EMPLOYER_CONTRIBUTIONS_EXPENSE',
    old: 'Aportes Patronales (TSS/INFOTEP)',
    neutral: 'Aportes Patronales a la Seguridad Social',
    byCountry: {
      MX: 'Cuotas Patronales IMSS, SAR e INFONAVIT',
      CO: 'Aportes Patronales (Seguridad Social y Parafiscales)',
    },
  },
  {
    role: 'SERVICE_CHARGE_PAYABLE',
    old: 'Propina Legal por Pagar',
    neutral: 'Cargos por Servicio por Pagar',
    byCountry: { CR: 'Cargo por Servicio (10 %) por Pagar' },
  },
  {
    role: 'EXCISE_TAX_PAYABLE',
    old: 'Impuesto Selectivo al Consumo por Pagar',
    neutral: 'Impuestos Específicos al Consumo por Pagar',
    byCountry: { MX: 'IEPS por Pagar', CO: 'Impuesto Nacional al Consumo por Pagar', EC: 'ICE por Pagar' },
  },
];

/** SAT código agrupador, first level, for the template's account codes (frozen copy). */
const MX_GROUPING: ReadonlyArray<[string, string]> = [
  ['1000', '100'], ['1110', '101'], ['1120', '102'], ['1130', '105'], ['1140', '115'], ['1150', '118'],
  ['1155', '113'], ['1160', '109'], ['2000', '200'], ['2110', '201'], ['2120', '205'], ['2130', '208'],
  ['2135', '216'], ['2140', '210'], ['2141', '211'], ['2142', '211'], ['2143', '211'], ['2144', '216'],
  ['2150', '213'], ['2165', '213'], ['2170', '206'], ['3000', '300'], ['3100', '301'], ['3300', '304'],
  ['3400', '305'], ['4000', '400'], ['4100', '401'], ['4200', '401'], ['4300', '402'], ['4900', '403'],
  ['5000', '500'], ['5100', '501'], ['5200', '601'], ['5250', '601'], ['5300', '601'], ['5400', '601'],
  ['5600', '601'], ['5700', '701'], ['5750', '701'],
];

export class NeutralChartOfAccounts1789470000000 implements MigrationInterface {
  name = 'NeutralChartOfAccounts1789470000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const [from, to] of COLUMN_RENAMES) {
      await q.query(`
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'organization_settings' AND column_name = '${from}') THEN
            ALTER TABLE "organization_settings" RENAME COLUMN "${from}" TO "${to}";
          END IF;
        END $$`);
    }

    for (const [from, to] of ROLE_RENAMES) {
      await q.query(`UPDATE "accounts" SET "system_role" = $2 WHERE "system_role" = $1`, [from, to]);
    }

    for (const rename of SPANISH_RENAMES) {
      const overrides = Object.entries(rename.byCountry);
      const caseSql = overrides.length
        ? `CASE o."country" ${overrides.map((_, i) => `WHEN $${4 + i * 2} THEN $${5 + i * 2}`).join(' ')} ELSE $3 END`
        : '$3';
      await q.query(
        `UPDATE "accounts" a
            SET "name" = jsonb_set(a."name", '{es}', to_jsonb((${caseSql})::text))
           FROM "organizations" o
          WHERE o."id" = a."organization_id"
            AND COALESCE(o."country", '') <> 'DO'
            AND a."system_role" = $1
            AND a."name" ->> 'es' = $2`,
        [rename.role, rename.old, rename.neutral, ...overrides.flat()],
      );
    }

    // Brazil had no seeded taxes, so its tax accounts were named with the Spanish fallback.
    await q.query(`
      UPDATE "accounts" a
         SET "name" = jsonb_build_object('es', replace(a."name" ->> 'es', 'Impuesto a ', 'Tributos a '))
        FROM "organizations" o
       WHERE o."id" = a."organization_id"
         AND o."country" = 'BR'
         AND a."system_role" IN ('TAX_RECEIVABLE', 'TAX_PAYABLE')
         AND a."name" ->> 'es' IN ('Impuesto a Recuperar', 'Impuesto a Recolher')`);

    await q.query(
      `UPDATE "accounts" a
          SET "fiscal_grouping_code" = v.grp
         FROM "organizations" o,
              (SELECT * FROM unnest($1::text[], $2::text[]) AS t(code, grp)) v
        WHERE o."id" = a."organization_id"
          AND o."country" = 'MX'
          AND a."code" = v.code
          AND (a."fiscal_grouping_code" IS NULL OR btrim(a."fiscal_grouping_code") = '')`,
      [MX_GROUPING.map(([code]) => code), MX_GROUPING.map(([, grp]) => grp)],
    );

    // I18N-05: a name stored under `es` in books kept in another language is re-keyed.
    for (const column of ['name', 'description']) {
      await q.query(`
        UPDATE "accounts" a
           SET "${column}" = jsonb_build_object(LEFT(o."books_language", 2), a."${column}" -> 'es')
          FROM "organizations" o
         WHERE o."id" = a."organization_id"
           AND LEFT(COALESCE(o."books_language", 'es'), 2) IN ('pt', 'en')
           AND a."${column}" IS NOT NULL
           AND jsonb_typeof(a."${column}") = 'object'
           AND (SELECT array_agg(k) FROM jsonb_object_keys(a."${column}") k) = ARRAY['es']`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    // Roles and columns go back; the renamed account names, grouping codes and language keys are
    // corrections of data the old template got wrong and are deliberately not reverted.
    for (const [from, to] of ROLE_RENAMES) {
      await q.query(`UPDATE "accounts" SET "system_role" = $1 WHERE "system_role" = $2`, [from, to]);
    }
    for (const [from, to] of COLUMN_RENAMES) {
      await q.query(`ALTER TABLE "organization_settings" RENAME COLUMN "${to}" TO "${from}"`);
    }
  }
}
