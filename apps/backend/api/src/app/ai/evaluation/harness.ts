import * as Joi from 'joi';
import { envValidation } from '../../config/env.validation';
import { AiGatewayService } from '../gateway/ai-gateway.service';
import { CopilotService } from '../copilot/copilot.service';
import { CopilotToolRegistry, CopilotUser, s } from '../../contracts/copilot/copilot-tools.contract';
import { fakeTenantDataSource } from '../../shared/tenancy/testing';

/** The deployment's AI settings, from the environment, with the same defaults the API boots with. */
const AI_KEYS = [
  'ANTHROPIC_API_KEY',
  'AI_ENABLED',
  'AI_MODEL_VISION',
  'AI_MODEL_NARRATIVE',
  'AI_MODEL_DEEP_ANALYSIS',
  'AI_MODEL_COPILOT',
  'AI_MODEL_LIGHT',
  'AI_REQUEST_TIMEOUT_MS',
] as const;

export function evalSettings(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const schema = Joi.object(Object.fromEntries(AI_KEYS.flatMap((key) => {
    try {
      return [[key, envValidation.extract(key)]];
    } catch {
      return [];
    }
  })));
  const picked = Object.fromEntries(AI_KEYS.filter((key) => env[key] !== undefined).map((key) => [key, env[key]]));
  const { value, error } = schema.validate(picked, { convert: true });
  if (error) throw error;
  return value as Record<string, unknown>;
}

/** What each call cost and with which prompt — kept in memory, reported with the results. */
export interface EvalReceipt {
  feature: string;
  promptId: string;
  promptHash: string;
  model: string;
  status: string;
  costMicroUsd: number;
}

/**
 * The real gateway — the same prompts, schemas, validation and model routing as production —
 * with everything around it in memory: no database, no credits, no policy. Only the provider
 * call is real.
 */
export function evalGateway(settings = evalSettings()) {
  const receipts: EvalReceipt[] = [];
  const requests = {
    create: (row: Record<string, unknown>) => row,
    save: async (row: Record<string, unknown>) => {
      receipts.push({
        feature: String(row['feature']),
        promptId: String(row['promptId'] ?? ''),
        promptHash: String(row['promptHash'] ?? ''),
        model: String(row['model'] ?? ''),
        status: String(row['status'] ?? ''),
        costMicroUsd: Number(row['costMicroUsd'] ?? 0),
      });
      return { ...row, id: `eval-${receipts.length}` };
    },
  };
  const entitlements = { consume: async () => undefined, checkFeature: async () => true };
  const policy = { assertCallAllowed: async () => undefined, afterCall: async () => undefined };
  const gateway = new AiGatewayService(
    { get: (key: string) => settings[key] } as never,
    entitlements as never,
    requests as never,
    fakeTenantDataSource(),
    policy as never,
  );
  return { gateway, receipts };
}

/** An in-memory repository, enough for the copilot's conversation tables. */
function memoryRepo() {
  const rows: Array<Record<string, unknown>> = [];
  let next = 0;
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) => Object.entries(where ?? {}).every(([key, value]) => row[key] === value);
  return {
    rows,
    create: (row: Record<string, unknown>) => ({ ...row }),
    save: async (input: Record<string, unknown> | Array<Record<string, unknown>>) => {
      for (const row of Array.isArray(input) ? input : [input]) {
        if (!row['id']) row['id'] = `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`;
        if (!row['createdAt']) row['createdAt'] = new Date();
        if (!rows.includes(row)) rows.push(row);
      }
      return input;
    },
    find: async ({ where }: { where?: Record<string, unknown> } = {}) => rows.filter((row) => matches(row, where ?? {})),
    findOne: async ({ where }: { where: Record<string, unknown> }) => rows.find((row) => matches(row, where)) ?? null,
    count: async ({ where }: { where?: Record<string, unknown> } = {}) => rows.filter((row) => matches(row, where ?? {})).length,
    delete: async () => ({ affected: 0 }),
  };
}

/**
 * A copilot whose tools return the case's fixtures. The tools keep their production names and
 * a neutral description; a draft tool proposes and records what it was asked, and creates nothing.
 */
export function evalCopilot(
  gateway: AiGatewayService,
  fixtures: Record<string, unknown>,
  draftTool: string | undefined,
  descriptions: Record<string, string> = {},
) {
  const registry = new CopilotToolRegistry();
  const called: string[] = [];
  const drafts: Array<{ tool: string; input: Record<string, unknown> }> = [];
  for (const [name, result] of Object.entries(fixtures)) {
    registry.register({
      kind: 'read',
      name,
      branchScope: 'none',
      externalText: true,
      description: descriptions[name] ?? `Reads ${name.replace(/_/g, ' ')} from the ERP.`,
      permissions: [],
      inputSchema: s.object({ query: s.nullable(s.string('Optional filter')) }),
      run: async () => {
        called.push(name);
        return result;
      },
    });
  }
  for (const name of new Set([draftTool, 'draft_purchase_order'].filter((tool): tool is string => !!tool))) {
    registry.register({
      kind: 'draft',
      name,
      branchScope: 'none',
      description: `Proposes a ${name.replace(/^draft_/, '').replace(/_/g, ' ')} as a draft. The person confirms it before anything is created.`,
      permissions: [],
      inputSchema: s.object({
        party_id: s.string('Customer or supplier id'),
        lines: s.array(s.object({ product_id: s.string(), quantity: s.number(), unit_price: s.nullable(s.number()) })),
      }),
      propose: async (_ctx, input) => {
        drafts.push({ tool: name, input });
        return { summary: name, preview: { lines: input['lines'] ?? [] } };
      },
      commit: async () => {
        throw new Error('evaluation never commits');
      },
    });
  }
  const copilot = new CopilotService(
    gateway,
    registry,
    { checkFeature: async () => true } as never,
    memoryRepo() as never,
    memoryRepo() as never,
    memoryRepo() as never,
    memoryRepo() as never,
    fakeTenantDataSource(),
    { get: async () => ({ maskIdentifiers: false }) } as never,
  );
  return { copilot, called, drafts };
}

export function evalUser(language: string): CopilotUser {
  return { id: '00000000-0000-4000-8000-0000000000aa', organizationId: '00000000-0000-4000-8000-0000000000bb', permissions: [], language, branches: null };
}
