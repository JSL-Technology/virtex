import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fiscal and labour rules become dated data with their legal source (audit 2026-11-07, SP-03:
 * LOC-06, FAC-TX-03, NOM-02).
 *
 *  1. `statutory_tax_rates`: every national consumption-tax rate with its period and the instrument
 *     that sets it. Ecuador carries its history (12 % until 31 March 2024, 15 % from 1 April 2024),
 *     so a document dated before the change is still validated against 12 %. A trigger refuses two
 *     periods of the same tax that overlap.
 *  2. The tenant's `taxes` gain `effective_from/effective_to`. Existing rows are dated from the
 *     statutory row they mirror, so a tenant's 15 % Ecuadorian IVA does not validate a 2023 invoice.
 *  3. The payroll tables gain `legal_basis` and `published_on`.
 *  4. NOM-02: the Dominican minimum contributory wage stops being RD$10,000 from 2020 to January
 *     2026. That row was wrong for the whole period; it is replaced by the figures with a known
 *     source (19,351.50 from February 2024, 21,674.80 from April 2025, 23,223.00 from February 2026).
 *     A period before February 2024 now refuses to calculate — `payroll.no_minimum_contributory_
 *     wage_p1_p2` — until a platform administrator loads the official figure for it, instead of
 *     computing caps at less than half their value. Calculated runs keep their own snapshot.
 *
 * Start dates are the instrument's entry into force where it is well established; where it is not,
 * the row starts on 2020-01-01 and says so in `legal_basis`, so a document older than that is
 * refused rather than validated against a rate nobody confirmed for its date. Every row is a
 * starting point to be confirmed by a local accountant (verificar con contador/abogado local).
 * The values are a frozen copy on purpose: a migration must not change meaning with the code.
 */
type Row = [country: string, code: string, name: string, rate: number, from: string, to: string | null, basis: string];

const UNCONFIRMED = 'Tasa vigente; fecha de inicio por confirmar con contador local (se registra desde 2020-01-01).';

const RATES: readonly Row[] = [
  ['DO', 'ITBIS_GENERAL', 'ITBIS 18%', 18, '2013-01-01', null, 'Código Tributario, art. 341, modificado por la Ley 253-12 (vigente desde el 1 de enero de 2013).'],
  ['DO', 'ITBIS_REDUCED', 'ITBIS Tasa Reducida 16%', 16, '2013-01-01', null, 'Ley 253-12, tasa reducida para los bienes que enumera (vigente desde el 1 de enero de 2013).'],
  ['DO', 'ITBIS_EXEMPT', 'ITBIS Exento 0%', 0, '2013-01-01', null, 'Código Tributario, arts. 343-344 (bienes y servicios exentos).'],
  ['MX', 'IVA_GENERAL', 'IVA 16%', 16, '2010-01-01', null, 'Ley del IVA, art. 1, reforma publicada en el DOF el 7 de diciembre de 2009.'],
  ['MX', 'IVA_BORDER', 'IVA Región Fronteriza 8%', 8, '2019-01-01', null, 'Decreto de estímulos fiscales región fronteriza norte (DOF 31 de diciembre de 2018) y sus prórrogas.'],
  ['MX', 'IVA_ZERO', 'IVA Tasa 0%', 0, '2010-01-01', null, 'Ley del IVA, art. 2-A.'],
  ['CO', 'IVA_GENERAL', 'IVA 19%', 19, '2017-01-01', null, 'Estatuto Tributario, art. 468, modificado por la Ley 1819 de 2016.'],
  ['CO', 'IVA_REDUCED', 'IVA 5%', 5, '2017-01-01', null, 'Estatuto Tributario, art. 468-1, modificado por la Ley 1819 de 2016.'],
  ['CO', 'IVA_EXCLUDED', 'IVA Excluido 0%', 0, '2017-01-01', null, 'Estatuto Tributario, arts. 424 y 476 (bienes y servicios excluidos).'],
  ['CL', 'IVA_GENERAL', 'IVA 19%', 19, '2003-10-01', null, 'DL 825, art. 14, modificado por la Ley 19.888 (vigente desde el 1 de octubre de 2003).'],
  ['CL', 'IVA_EXEMPT', 'Exento 0%', 0, '2003-10-01', null, 'DL 825, arts. 12 y 13 (exenciones).'],
  ['PE', 'IGV_GENERAL', 'IGV 18%', 18, '2011-03-01', null, 'TUO de la Ley del IGV, art. 17 (16 %) más el IPM (2 %), Ley 29666 (vigente desde el 1 de marzo de 2011).'],
  ['PE', 'IGV_EXEMPT', 'Exonerado 0%', 0, '2011-03-01', null, 'TUO de la Ley del IGV, apéndices I y II (operaciones exoneradas).'],
  ['AR', 'IVA_GENERAL', 'IVA 21%', 21, '1995-04-01', null, 'Ley de IVA, art. 28, alícuota fijada por la Ley 24.468 (vigente desde el 1 de abril de 1995).'],
  ['AR', 'IVA_REDUCED', 'IVA 10,5%', 10.5, '2020-01-01', null, `Ley de IVA, art. 28, alícuota reducida. ${UNCONFIRMED}`],
  ['AR', 'IVA_INCREASED', 'IVA 27%', 27, '2020-01-01', null, `Ley de IVA, art. 28, alícuota incrementada (servicios públicos a no consumidores finales). ${UNCONFIRMED}`],
  ['AR', 'IVA_EXEMPT', 'IVA Exento 0%', 0, '2020-01-01', null, `Ley de IVA, art. 7 (exenciones). ${UNCONFIRMED}`],
  ['EC', 'IVA_GENERAL', 'IVA 12%', 12, '2017-06-01', '2024-03-31', 'Ley de Régimen Tributario Interno, art. 65; tarifa general tras el fin de la tarifa temporal del 14 % de la Ley Orgánica de Solidaridad (31 de mayo de 2017).'],
  ['EC', 'IVA_GENERAL', 'IVA 15%', 15, '2024-04-01', null, 'Ley Orgánica para Enfrentar el Conflicto Armado Interno, la Crisis Social y Económica (RO 12-03-2024) y Decreto Ejecutivo 198 (vigente desde el 1 de abril de 2024).'],
  ['EC', 'IVA_ZERO', 'IVA 0%', 0, '2017-06-01', null, 'Ley de Régimen Tributario Interno, arts. 55 y 56 (tarifa 0 %).'],
  ['UY', 'IVA_BASIC', 'IVA Básico 22%', 22, '2020-01-01', null, `Título 10 del Texto Ordenado 1996, art. 18 (tasa básica). ${UNCONFIRMED}`],
  ['UY', 'IVA_MINIMUM', 'IVA Mínimo 10%', 10, '2020-01-01', null, `Título 10 del Texto Ordenado 1996, art. 18 (tasa mínima). ${UNCONFIRMED}`],
  ['UY', 'IVA_EXEMPT', 'Exento 0%', 0, '2020-01-01', null, `Título 10 del Texto Ordenado 1996, art. 19 (exoneraciones). ${UNCONFIRMED}`],
  ['PY', 'IVA_GENERAL', 'IVA 10%', 10, '2020-01-01', null, `Ley 6380/2019, art. 90 (tasa general). ${UNCONFIRMED}`],
  ['PY', 'IVA_REDUCED', 'IVA 5%', 5, '2020-01-01', null, `Ley 6380/2019, art. 90 (tasa reducida). ${UNCONFIRMED}`],
  ['PY', 'IVA_EXEMPT', 'Exento 0%', 0, '2020-01-01', null, `Ley 6380/2019, art. 100 (exoneraciones). ${UNCONFIRMED}`],
  ['BO', 'IVA_GENERAL', 'IVA 13%', 13, '2020-01-01', null, `Ley 843 (Texto Ordenado), art. 15. ${UNCONFIRMED}`],
  ['BO', 'IVA_EXEMPT', 'Exento 0%', 0, '2020-01-01', null, `Ley 843 (Texto Ordenado), art. 14 (exenciones). ${UNCONFIRMED}`],
  ['VE', 'IVA_GENERAL', 'IVA 16%', 16, '2020-01-01', null, `Ley de IVA, art. 27 (alícuota general fijada por el Ejecutivo). ${UNCONFIRMED}`],
  ['VE', 'IVA_EXEMPT', 'Exento 0%', 0, '2020-01-01', null, `Ley de IVA, arts. 17 y 18 (exenciones). ${UNCONFIRMED}`],
  ['PA', 'ITBMS_GENERAL', 'ITBMS 7%', 7, '2010-07-01', null, 'Código Fiscal, art. 1057-V, tarifa fijada por la Ley 49 de 2009 (vigente desde el 1 de julio de 2010).'],
  ['PA', 'ITBMS_EXEMPT', 'Exento 0%', 0, '2010-07-01', null, 'Código Fiscal, art. 1057-V, parágrafo 8 (exenciones).'],
  ['CR', 'IVA_GENERAL', 'IVA 13%', 13, '2019-07-01', null, 'Ley 9635 de Fortalecimiento de las Finanzas Públicas, Ley del IVA art. 10 (vigente desde el 1 de julio de 2019).'],
  ['CR', 'IVA_EXEMPT', 'Exento 0%', 0, '2019-07-01', null, 'Ley del IVA (Ley 9635), art. 8 (exenciones).'],
  ['GT', 'IVA_GENERAL', 'IVA 12%', 12, '2020-01-01', null, `Decreto 27-92, Ley del IVA, art. 10. ${UNCONFIRMED}`],
  ['GT', 'IVA_EXEMPT', 'Exento 0%', 0, '2020-01-01', null, `Decreto 27-92, Ley del IVA, art. 7 (exenciones). ${UNCONFIRMED}`],
  ['SV', 'IVA_GENERAL', 'IVA 13%', 13, '2020-01-01', null, `Ley de IVA (Decreto 296), art. 54. ${UNCONFIRMED}`],
  ['SV', 'IVA_EXEMPT', 'Exento 0%', 0, '2020-01-01', null, `Ley de IVA (Decreto 296), arts. 45 y 46 (exenciones). ${UNCONFIRMED}`],
  ['HN', 'ISV_GENERAL', 'ISV 15%', 15, '2014-01-01', null, 'Ley del Impuesto sobre Ventas, art. 6, reformada por el Decreto 278-2013 (vigente desde el 1 de enero de 2014).'],
  ['HN', 'ISV_EXEMPT', 'Exento 0%', 0, '2014-01-01', null, 'Ley del Impuesto sobre Ventas, art. 15 (exenciones).'],
  ['NI', 'IVA_GENERAL', 'IVA 15%', 15, '2020-01-01', null, `Ley 822 de Concertación Tributaria, art. 109. ${UNCONFIRMED}`],
  ['NI', 'IVA_EXEMPT', 'Exento 0%', 0, '2020-01-01', null, `Ley 822 de Concertación Tributaria, art. 127 (exenciones). ${UNCONFIRMED}`],
];

/** NOM-02: the Dominican minimum contributory wage with a known source. */
const DO_MIN_WAGE: ReadonlyArray<[from: string, to: string | null, value: number, basis: string]> = [
  ['2024-02-01', '2025-03-31', 19351.5, 'TSS, salario mínimo cotizable desde febrero de 2024 (cifra verificada en la auditoría 2026-11-07, NOM-02). Verificar con contador local.'],
  ['2025-04-01', '2026-01-31', 21674.8, 'TSS, salario mínimo cotizable desde abril de 2025 (cifra verificada en la auditoría 2026-11-07, NOM-02). Verificar con contador local.'],
];

export class StatutoryRatesWithValidity1789490000000 implements MigrationInterface {
  name = 'StatutoryRatesWithValidity1789490000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "statutory_tax_rates" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "country_code" character varying(2) NOT NULL,
        "tax_code" character varying(40) NOT NULL,
        "name" character varying(80) NOT NULL,
        "rate" numeric(7,4) NOT NULL,
        "effective_from" date NOT NULL,
        "effective_to" date,
        "legal_basis" text NOT NULL,
        "published_on" date,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_statutory_tax_rates" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_statutory_tax_rates_period" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
        CONSTRAINT "CHK_statutory_tax_rates_rate" CHECK ("rate" >= 0 AND "rate" <= 100)
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_statutory_tax_rates_version" ON "statutory_tax_rates" ("country_code", "tax_code", "effective_from")`,
    );
    // Two periods of one tax that overlap would make "the rate on this date" ambiguous.
    await q.query(`
      CREATE OR REPLACE FUNCTION virtex_statutory_tax_rates_no_overlap() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "statutory_tax_rates" r
           WHERE r."country_code" = NEW."country_code" AND r."tax_code" = NEW."tax_code" AND r."id" <> NEW."id"
             AND daterange(r."effective_from", r."effective_to", '[]') && daterange(NEW."effective_from", NEW."effective_to", '[]')
        ) THEN
          RAISE EXCEPTION 'statutory_tax_rates: % % overlaps an existing period', NEW."country_code", NEW."tax_code"
            USING ERRCODE = '23P01';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await q.query(`
      CREATE TRIGGER "TR_statutory_tax_rates_no_overlap" BEFORE INSERT OR UPDATE ON "statutory_tax_rates"
        FOR EACH ROW EXECUTE FUNCTION virtex_statutory_tax_rates_no_overlap()`);
    for (const [country, code, name, rate, from, to, basis] of RATES) {
      await q.query(
        `INSERT INTO "statutory_tax_rates" ("country_code", "tax_code", "name", "rate", "effective_from", "effective_to", "legal_basis")
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [country, code, name, rate, from, to, basis],
      );
    }
    // Global reference data: readable by the application role, writable only by migrations/admins.
    await q.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT ON "statutory_tax_rates" TO virtex_app;
        END IF;
      END $$`);

    // The tenant's catalogue gets periods too, dated from the statutory row each mirrors.
    await q.query(`
      ALTER TABLE "taxes"
        ADD COLUMN "effective_from" date,
        ADD COLUMN "effective_to" date,
        ADD CONSTRAINT "CHK_taxes_period" CHECK ("effective_to" IS NULL OR "effective_from" IS NULL OR "effective_to" >= "effective_from")`);
    await q.query(`
      UPDATE "taxes" t SET "effective_from" = s."effective_from", "effective_to" = s."effective_to"
        FROM "organizations" o, "statutory_tax_rates" s
       WHERE o."id" = t."organization_id"
         AND s."country_code" = UPPER(COALESCE(t."countryCode", o."country"))
         AND s."rate" = t."rate"
         AND t."type" = 'Porcentaje'
         AND s."effective_to" IS NULL`);

    for (const table of ['payroll_statutory_contributions', 'payroll_statutory_references', 'payroll_income_tax_brackets']) {
      await q.query(`ALTER TABLE "${table}" ADD COLUMN "legal_basis" text, ADD COLUMN "published_on" date`);
    }
    await q.query(`
      UPDATE "payroll_statutory_contributions" SET "legal_basis" = CASE "contribution_code"
          WHEN 'AFP' THEN 'Ley 87-01 del Sistema Dominicano de Seguridad Social, art. 56 (pensiones). Verificar con contador local.'
          WHEN 'SFS' THEN 'Ley 87-01, art. 140 (Seguro Familiar de Salud). Verificar con contador local.'
          WHEN 'SRL' THEN 'Ley 87-01, art. 196 (Seguro de Riesgos Laborales); tasa según la clasificación de la empresa. Verificar con contador local.'
          WHEN 'INFOTEP' THEN 'Ley 116-80 del INFOTEP, art. 23 (1 % de la nómina). Verificar con contador local.'
        END
       WHERE "country_code" = 'DO' AND "legal_basis" IS NULL`);
    await q.query(`
      UPDATE "payroll_income_tax_brackets" SET "legal_basis" = 'Código Tributario, art. 296 (escala anual del ISR de personas físicas). Verificar con contador local.'
       WHERE "country_code" = 'DO' AND "legal_basis" IS NULL`);

    // NOM-02: the RD$10,000 row was wrong for every period it covered.
    await q.query(
      `DELETE FROM "payroll_statutory_references"
        WHERE "country_code" = 'DO' AND "key" = 'MIN_WAGE_COTIZABLE' AND "effective_from" = '2020-01-01' AND "value" = 10000`,
    );
    for (const [from, to, value, basis] of DO_MIN_WAGE) {
      await q.query(
        `INSERT INTO "payroll_statutory_references" ("country_code", "key", "effective_from", "effective_to", "value", "currency_code", "legal_basis")
         SELECT 'DO', 'MIN_WAGE_COTIZABLE', $1, $2, $3, 'DOP', $4
          WHERE NOT EXISTS (SELECT 1 FROM "payroll_statutory_references"
                             WHERE "country_code" = 'DO' AND "key" = 'MIN_WAGE_COTIZABLE' AND "effective_from" = $1)`,
        [from, to, value, basis],
      );
    }
    await q.query(`
      UPDATE "payroll_statutory_references" SET "legal_basis" = CASE "key"
          WHEN 'MIN_WAGE_COTIZABLE' THEN 'TSS, salario mínimo cotizable desde febrero de 2026. Verificar con contador local.'
          WHEN 'BONUS_EMPLOYEE_LEVY_RATE' THEN 'Ley 116-80 del INFOTEP: el aporte del trabajador sobre la regalía pascual no aplica (Código de Trabajo, art. 222). Verificar con contador local.'
          ELSE 'Verificar con contador local.'
        END
       WHERE "country_code" = 'DO' AND "legal_basis" IS NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM "payroll_statutory_references" WHERE "country_code" = 'DO' AND "key" = 'MIN_WAGE_COTIZABLE' AND "effective_from" IN ('2024-02-01', '2025-04-01')`,
    );
    // The RD$10,000 row is not restored: it was the defect.
    for (const table of ['payroll_statutory_contributions', 'payroll_statutory_references', 'payroll_income_tax_brackets']) {
      await q.query(`ALTER TABLE "${table}" DROP COLUMN "legal_basis", DROP COLUMN "published_on"`);
    }
    await q.query(`ALTER TABLE "taxes" DROP CONSTRAINT "CHK_taxes_period", DROP COLUMN "effective_from", DROP COLUMN "effective_to"`);
    await q.query(`DROP TRIGGER IF EXISTS "TR_statutory_tax_rates_no_overlap" ON "statutory_tax_rates"`);
    await q.query(`DROP FUNCTION IF EXISTS virtex_statutory_tax_rates_no_overlap()`);
    await q.query(`DROP TABLE "statutory_tax_rates"`);
  }
}
