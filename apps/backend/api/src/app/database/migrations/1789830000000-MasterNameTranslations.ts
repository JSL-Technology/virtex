import { MigrationInterface, QueryRunner } from 'typeorm';

type Names = { es: string; en: string; pt: string };
const LANGUAGES = ['es', 'en', 'pt'] as const;

/**
 * The tables whose name is a word to read rather than a proper name: each keeps its name in the
 * books language — the record — and, beside it, the same name in the other languages.
 */
const TABLES = ['journals', 'ledgers', 'payment_methods', 'taxes', 'dimensions', 'dimension_values', 'warehouses'] as const;

/**
 * What the system names when it provisions a company, as the catalogue words it today — a literal
 * snapshot, as a migration has to be: a later change of wording must not change what this one did.
 */
const SYSTEM_JOURNALS: ReadonlyArray<[code: string, names: Names]> = [
  ['VENTAS', {"es": "Diario de ventas", "en": "Sales journal", "pt": "Diário de vendas"}],
  ['COMPRAS', {"es": "Diario de compras", "en": "Purchases journal", "pt": "Diário de compras"}],
  ['COBROS', {"es": "Diario de cobros", "en": "Collections journal", "pt": "Diário de cobranças"}],
  ['PAGOS', {"es": "Diario de pagos", "en": "Payments journal", "pt": "Diário de pagamentos"}],
  ['BANCOS', {"es": "Diario de bancos", "en": "Banks journal", "pt": "Diário de bancos"}],
  ['CAJA', {"es": "Diario de caja", "en": "Cash journal", "pt": "Diário de caixa"}],
  ['NOMINA', {"es": "Diario de nómina", "en": "Payroll journal", "pt": "Diário da folha"}],
  ['GENERAL', {"es": "Diario general", "en": "General journal", "pt": "Diário geral"}],
  ['DEPREC', {"es": "Diario de depreciación", "en": "Depreciation journal", "pt": "Diário de depreciação"}],
  ['CIERRE', {"es": "Diario de cierre", "en": "Closing journal", "pt": "Diário de encerramento"}],
  ['CONCIL', {"es": "Diario de conciliación", "en": "Reconciliation journal", "pt": "Diário de conciliação"}],
  ['ACT-FIJOS', {"es": "Diario de activos fijos", "en": "Fixed assets journal", "pt": "Diário de ativo imobilizado"}],
  ['AJU-INF', {"es": "Diario de ajuste por inflación", "en": "Inflation adjustment journal", "pt": "Diário de correção monetária"}],
];
const DEFAULT_LEDGER: Names = {"es": "Libro principal", "en": "Main ledger", "pt": "Livro principal"};
const MAIN_WAREHOUSE: Names = {"es": "Almacén principal", "en": "Main warehouse", "pt": "Armazém principal"};
const PAYMENT_METHODS: readonly Names[] = [
  {"es": "Transferencia ACH", "en": "ACH transfer", "pt": "Transferência ACH"}, // ach
  {"es": "Transferencia bancaria", "en": "Bank transfer", "pt": "Transferência bancária"}, // bank_transfer
  {"es": "Boleto bancario", "en": "Bank slip (boleto)", "pt": "Boleto bancário"}, // boleto
  {"es": "Tarjeta", "en": "Card", "pt": "Cartão"}, // card
  {"es": "Efectivo", "en": "Cash", "pt": "Dinheiro"}, // cash
  {"es": "Cheque", "en": "Check", "pt": "Cheque"}, // check
  {"es": "Tarjeta de crédito", "en": "Credit card", "pt": "Cartão de crédito"}, // credit_card
  {"es": "Tarjeta de débito", "en": "Debit card", "pt": "Cartão de débito"}, // debit_card
  {"es": "Permuta", "en": "Barter", "pt": "Permuta"}, // dgii_barter
  {"es": "Tarjeta de crédito o débito", "en": "Credit or debit card", "pt": "Cartão de crédito ou débito"}, // dgii_card
  {"es": "Efectivo", "en": "Cash", "pt": "Dinheiro"}, // dgii_cash
  {"es": "Cheque, transferencia o depósito", "en": "Cheque, transfer or deposit", "pt": "Cheque, transferência ou depósito"}, // dgii_check_transfer
  {"es": "Compra a crédito", "en": "Purchase on credit", "pt": "Compra a prazo"}, // dgii_credit
  {"es": "Nota de crédito", "en": "Credit note", "pt": "Nota de crédito"}, // dgii_credit_note
  {"es": "Mixto", "en": "Mixed", "pt": "Misto"}, // dgii_mixed
  {"es": "A crédito", "en": "On account", "pt": "A prazo"}, // on_account
  {"es": "PIX", "en": "PIX", "pt": "PIX"}, // pix
  {"es": "Por definir", "en": "To be defined", "pt": "A definir"}, // to_be_defined
  {"es": "Transferencia cablegráfica", "en": "Wire transfer", "pt": "Transferência eletrônica (wire)"}, // wire
  {"es": "Zelle", "en": "Zelle", "pt": "Zelle"}, // zelle
];

/** The other languages of a name, for books kept in `books`. */
const translationsFor = (names: Names, books: (typeof LANGUAGES)[number]) =>
  JSON.stringify(Object.fromEntries(LANGUAGES.filter((language) => language !== books).map((language) => [language, names[language]])));

/**
 * Masters named in several languages (books bilingual, part 3): a journal, a ledger, a payment
 * method, a tax, a dimension and its values, a warehouse.
 *
 * `name` stays what it is — the record, in the books language, what a filing and an export read —
 * and `name_translations` holds the same name in the other languages, for whoever reads the screen
 * in one of them. A US controller of a Dominican company reads «Sales journal» where the books keep
 * «Diario de ventas».
 *
 * What the system named itself — the journals, the main ledger and warehouse, the payment methods a
 * market seeds — is translated here for every company that has it, matched on the company's books
 * language and on the name being still the one the system gave it: a name a person changed is
 * theirs, and is not translated by guess. What people named is theirs to translate.
 */
export class MasterNameTranslations1789830000000 implements MigrationInterface {
  name = 'MasterNameTranslations1789830000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      await q.query(`ALTER TABLE "${table}" ADD COLUMN "name_translations" jsonb NOT NULL DEFAULT '{}'::jsonb`);
      await q.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "CHK_${table}_name_translations" CHECK (jsonb_typeof("name_translations") = 'object')`,
      );
    }

    for (const books of LANGUAGES) {
      for (const [code, names] of SYSTEM_JOURNALS) {
        await q.query(
          `UPDATE "journals" j SET "name_translations" = $1::jsonb FROM "organizations" o
            WHERE o."id" = j."organization_id" AND o."books_language" = $2 AND j."code" = $3 AND j."name" = $4
              AND j."name_translations" = '{}'::jsonb`,
          [translationsFor(names, books), books, code, names[books]],
        );
      }
      for (const [table, names] of [['ledgers', DEFAULT_LEDGER], ['warehouses', MAIN_WAREHOUSE]] as const) {
        await q.query(
          `UPDATE "${table}" t SET "name_translations" = $1::jsonb FROM "organizations" o
            WHERE o."id" = t."organization_id" AND o."books_language" = $2 AND t."is_default" AND t."name" = $3
              AND t."name_translations" = '{}'::jsonb`,
          [translationsFor(names, books), books, names[books]],
        );
      }
      // A payment method is matched on its name: the same word seeds under different codes from one
      // market to another. Two catalogue entries that write the same word in these books and
      // translate it differently say nothing certain, and translate nothing.
      const byName = new Map<string, string | null>();
      for (const names of PAYMENT_METHODS) {
        const translations = translationsFor(names, books);
        const seen = byName.get(names[books]);
        byName.set(names[books], seen === undefined || seen === translations ? translations : null);
      }
      for (const [name, translations] of byName) {
        if (translations === null) continue;
        await q.query(
          `UPDATE "payment_methods" p SET "name_translations" = $1::jsonb FROM "organizations" o
            WHERE o."id" = p."organization_id" AND o."books_language" = $2 AND p."name" = $3
              AND p."name_translations" = '{}'::jsonb`,
          [translations, books, name],
        );
      }
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [...TABLES].reverse()) {
      await q.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "CHK_${table}_name_translations"`);
      await q.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "name_translations"`);
    }
  }
}
