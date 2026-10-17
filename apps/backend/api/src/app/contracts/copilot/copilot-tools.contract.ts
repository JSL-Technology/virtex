import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

/**
 * The copilot's tools, contributed by the modules that own the data.
 *
 * The copilot answers "¿cuánto me deben los clientes?" by calling the receivables module, and
 * drafts a quote by calling sales. If the AI module imported every domain to do that, it would be
 * the most coupled module in the system; instead each domain registers the tools it offers here —
 * a description, a strict input schema, the permission it requires — exactly as it registers its
 * datasets for import/export. The AI module only reads this registry.
 *
 * ## The rules every tool is held to
 *
 * - **Permissions are the user's.** A tool declares the permissions its route requires; the copilot
 *   offers it only to a user who holds them and checks again before running it.
 * - **Scope is the user's.** `run` receives the user and must pass `user.id` as the actor to services
 *   that apply branch scope, so the copilot sees exactly what the user would.
 * - **Nothing moves money or changes access.** A tool whose route needs step-up is not registered.
 * - **Writes are proposals.** A `draft` tool's `propose` returns a preview and writes nothing; the
 *   document is created by `commit`, only after the person confirms, and always as a draft.
 * - **Results are data.** Whatever a tool returns is shown to the model as data, never as
 *   instructions — a customer named "ignora lo anterior" stays a customer name.
 */

export interface CopilotUser {
  id: string;
  organizationId: string;
  permissions: string[];
  language: string;
}

export interface CopilotToolContext {
  user: CopilotUser;
  organizationId: string;
}

/** JSON Schema with `additionalProperties: false` on every object (the API's strict mode). */
export type CopilotSchema = Record<string, unknown>;

interface CopilotToolBase {
  /** snake_case, unique: what the model calls. */
  name: string;
  /** What it returns and when to use it — the model chooses by this. In English, for the model. */
  description: string;
  inputSchema: CopilotSchema;
  /** Every one is required (as `@HasPermission` with several arguments). */
  permissions: string[];
  /** Plan feature that must be enabled, if any (e.g. `ai_forecasting`). */
  feature?: string;
}

export interface CopilotReadTool extends CopilotToolBase {
  kind: 'read';
  /** Returns JSON-serialisable data, already trimmed to what is useful (lists capped). */
  run(ctx: CopilotToolContext, input: Record<string, unknown>): Promise<unknown>;
}

export interface CopilotDraftProposal {
  /** One-line description for the confirmation card. */
  summary: string;
  /** What will be created, as the person will see it before confirming (totals computed). */
  preview: Record<string, unknown>;
}

export interface CopilotDraftResult {
  /** The created draft. */
  id: string;
  /** Client route to open it. */
  link: string;
  label: string;
}

export interface CopilotDraftTool extends CopilotToolBase {
  kind: 'draft';
  /** Validates and previews; must not write. */
  propose(ctx: CopilotToolContext, input: Record<string, unknown>): Promise<CopilotDraftProposal>;
  /** Creates the document as a draft. Runs only after the person confirmed the proposal. */
  commit(ctx: CopilotToolContext, input: Record<string, unknown>): Promise<CopilotDraftResult>;
}

export type CopilotTool = CopilotReadTool | CopilotDraftTool;

@Injectable()
export class CopilotToolRegistry {
  private readonly tools = new Map<string, CopilotTool>();

  register(...tools: CopilotTool[]): void {
    for (const tool of tools) {
      if (!/^[a-z][a-z0-9_]{2,63}$/.test(tool.name)) {
        throw new Error(`Copilot tool name "${tool.name}" must be snake_case`);
      }
      // Idempotent: a module initialised twice in a test harness must not duplicate a tool.
      if (!this.tools.has(tool.name)) this.tools.set(tool.name, tool);
    }
  }

  get(name: string): CopilotTool | undefined {
    return this.tools.get(name);
  }

  /** In registration-independent order, so the tool list (and the prompt cache) is stable. */
  all(): CopilotTool[] {
    return [...this.tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}

/**
 * Builders for strict tool schemas. In strict mode every property is listed as required and an
 * optional one is expressed as nullable, so the model always sends the key (with `null` when it has
 * nothing to say) — and the tool reads `input.x ?? default` without guessing whether it was meant.
 */
export const s = {
  object(properties: Record<string, CopilotSchema>, description?: string): CopilotSchema {
    return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties, ...(description ? { description } : {}) };
  },
  string(description?: string, extra: Record<string, unknown> = {}): CopilotSchema {
    return { type: 'string', ...(description ? { description } : {}), ...extra };
  },
  integer(description?: string): CopilotSchema {
    return { type: 'integer', ...(description ? { description } : {}) };
  },
  number(description?: string): CopilotSchema {
    return { type: 'number', ...(description ? { description } : {}) };
  },
  enum(values: readonly string[], description?: string): CopilotSchema {
    return { type: 'string', enum: [...values], ...(description ? { description } : {}) };
  },
  array(items: CopilotSchema, description?: string): CopilotSchema {
    return { type: 'array', items, ...(description ? { description } : {}) };
  },
  nullable(schema: CopilotSchema): CopilotSchema {
    return { anyOf: [schema, { type: 'null' }] };
  },
};

/** Reads an optional (nullable) value from a strict tool input. */
export function opt<T>(input: Record<string, unknown>, key: string): T | undefined {
  const value = input[key];
  return value === null || value === undefined || value === '' ? undefined : (value as T);
}

/** A list capped to `max`, saying how many were left out so the model can narrow its question. */
export function capped<T>(items: T[], max: number, total = items.length) {
  return { total, shown: Math.min(items.length, max), items: items.slice(0, max) };
}

/**
 * A draft tool's input turned into the route's own DTO and validated with the route's own rules,
 * so a document proposed by the copilot passes exactly the checks a person's form would. Throws a
 * plain-language list of the problems, which goes back to the model as the tool's error.
 */
export async function asValidDto<T extends object>(cls: new () => T, plain: Record<string, unknown>): Promise<T> {
  const dto = plainToInstance(cls, plain);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: false });
  if (errors.length) {
    const flatten = (list: ValidationError[], path = ''): string[] =>
      list.flatMap((error) => {
        const at = path ? `${path}.${error.property}` : error.property;
        return [
          ...Object.keys(error.constraints ?? {}).map((rule) => `${at}: ${rule}`),
          ...flatten(error.children ?? [], at),
        ];
      });
    throw new Error(`Invalid input — ${flatten(errors).join('; ')}`);
  }
  return dto;
}

/** An ageing report trimmed for the model: totals, and the largest balances first. */
export function agingForModel(
  report: { asOfDate: string; currencyCode: string; rows: Array<{ partyId: string; partyName: string; total: number; current: number; buckets: unknown }>; totals: unknown },
  max = 25,
) {
  const rows = [...report.rows].sort((a, b) => b.total - a.total);
  return {
    asOfDate: report.asOfDate,
    currencyCode: report.currencyCode,
    totals: report.totals,
    parties: rows.length,
    largest: rows.slice(0, max).map((row) => ({ id: row.partyId, name: row.partyName, current: row.current, buckets: row.buckets, total: row.total })),
  };
}

/**
 * The customer's or supplier's display name, for a draft's preview — or an error the model can act
 * on when the id it passed is not one of this company's (it then searches instead of guessing).
 */
export async function partyName(
  dataSource: { query: (sql: string, params: unknown[]) => Promise<Array<{ name: string | null }>> },
  party: 'customer' | 'supplier',
  organizationId: string,
  id: string,
): Promise<string> {
  const sql =
    party === 'customer'
      ? `SELECT COALESCE(NULLIF("companyName", ''), "contactPerson", "email") AS "name" FROM "customers" WHERE "id"::text = $1 AND "organization_id" = $2`
      : `SELECT "name" FROM "suppliers" WHERE "id"::text = $1 AND "organization_id" = $2`;
  const [row] = await dataSource.query(sql, [id, organizationId]);
  if (!row) throw new Error(`No ${party} with id ${id}; find it with search_${party}s first.`);
  return row.name ?? '';
}
