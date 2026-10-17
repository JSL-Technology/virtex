import Anthropic from '@anthropic-ai/sdk';
import { AiGatewayService } from './ai-gateway.service';
import { costMicroUsd } from './ai-models';
import { SaasResource } from '../../saas/contracts/entitlements.contract';

const settings: Record<string, unknown> = {
  ANTHROPIC_API_KEY: 'sk-test',
  AI_ENABLED: true,
  AI_MODEL_VISION: 'claude-opus-5-5',
  AI_MODEL_NARRATIVE: 'claude-opus-5-5',
  AI_MODEL_DEEP_ANALYSIS: 'claude-fable-5-1',
  AI_REQUEST_TIMEOUT_MS: 30_000,
};

const message = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'msg_1',
  model: 'claude-opus-5-5',
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
  usage: { input_tokens: 2_000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  ...overrides,
});

function build(config: Record<string, unknown> = settings) {
  const saved: Array<Record<string, unknown>> = [];
  const requests = {
    create: jest.fn((row) => row),
    save: jest.fn(async (row) => {
      saved.push(row);
      return { ...row, id: `req-${saved.length}` };
    }),
  };
  const entitlements = { consume: jest.fn().mockResolvedValue(undefined), checkFeature: jest.fn() };
  const service = new AiGatewayService(
    { get: (key: string) => config[key] } as never,
    entitlements as never,
    requests as never,
  );
  const create = jest.fn();
  // The breaker calls through `this.client`, so replacing the client's method is enough.
  (service as unknown as { client: unknown }).client = config['ANTHROPIC_API_KEY']
    ? { beta: { messages: { create } } }
    : null;
  return { service, create, saved, entitlements };
}

const request = (validate: (value: unknown) => unknown = (value) => value) => ({
  feature: 'product_vision' as const,
  organizationId: 'org-1',
  userId: 'user-1',
  system: 'instructions',
  content: [{ type: 'text' as const, text: 'hello' }],
  schema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  validate,
  inputFingerprint: 'abc',
});

describe('AiGatewayService', () => {
  it('answers 503, and spends nothing, when no key is configured', async () => {
    const { service, entitlements } = build({ ...settings, ANTHROPIC_API_KEY: '' });
    await expect(service.structured(request())).rejects.toMatchObject({ status: 503 });
    expect(entitlements.consume).not.toHaveBeenCalled();
    expect(service.isAvailable()).toBe(false);
  });

  it('consumes the plan credits before calling the model', async () => {
    const { service, create, entitlements } = build();
    const order: string[] = [];
    entitlements.consume.mockImplementation(async () => void order.push('consume'));
    create.mockImplementation(async () => {
      order.push('call');
      return message();
    });
    await service.structured(request());
    expect(order).toEqual(['consume', 'call']);
    expect(entitlements.consume).toHaveBeenCalledWith('org-1', SaasResource.AI_CREDITS, 1);
  });

  it('never calls the model when the plan has no credits left', async () => {
    const { service, create, entitlements } = build();
    entitlements.consume.mockRejectedValue(new Error('limit reached'));
    await expect(service.structured(request())).rejects.toThrow('limit reached');
    expect(create).not.toHaveBeenCalled();
  });

  it('asks for structured output, with the effort and fallbacks configured for the feature', async () => {
    const { service, create } = build();
    create.mockResolvedValue(message());
    await service.structured(request());
    const params = create.mock.calls[0][0];
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.output_config).toEqual({
      effort: 'high',
      format: { type: 'json_schema', schema: request().schema },
    });
    expect(params.fallbacks).toBe('default');
    expect(params.betas).toContain('server-side-fallback-2026-07-01');
    // The system prompt is marked for the prompt cache.
    expect(params.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('records a successful call with its tokens, cost and a fingerprint — not the input', async () => {
    const { service, create, saved } = build();
    create.mockResolvedValue(message());
    const result = await service.structured(request());
    expect(result).toEqual({ value: { ok: true }, requestId: 'req-1', model: 'claude-opus-5-5' });
    expect(saved[0]).toMatchObject({
      status: 'SUCCEEDED',
      feature: 'product_vision',
      inputTokens: 2_000,
      outputTokens: 500,
      credits: 1,
      costMicroUsd: costMicroUsd('claude-opus-5-5', {
        inputTokens: 2_000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    });
    expect(saved[0]['inputHash']).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(saved[0])).not.toContain('hello');
  });

  it('records the model that actually answered when a fallback served the request', async () => {
    const { service, create, saved } = build();
    create.mockResolvedValue(message({ model: 'claude-opus-4-8' }));
    const result = await service.structured(request());
    expect(result.model).toBe('claude-opus-4-8');
    expect(saved[0]['model']).toBe('claude-opus-4-8');
  });

  it('turns a refusal into a 422 and records it as refused', async () => {
    const { service, create, saved } = build();
    create.mockResolvedValue(message({ stop_reason: 'refusal', content: [] }));
    await expect(service.structured(request())).rejects.toMatchObject({ status: 422 });
    expect(saved[0]['status']).toBe('REFUSED');
  });

  it('turns an answer that fails validation into a 422', async () => {
    const { service, create, saved } = build();
    create.mockResolvedValue(message());
    await expect(
      service.structured(
        request(() => {
          throw new Error('category is not the tenant\'s');
        }),
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(saved[0]).toMatchObject({ status: 'FAILED', errorCode: 'invalid_answer' });
  });

  it('turns a provider failure into a 503 the form can fall back from', async () => {
    const { service, create, saved } = build();
    create.mockRejectedValue(new Anthropic.InternalServerError(500, undefined, 'boom', new Headers()));
    await expect(service.structured(request())).rejects.toMatchObject({ status: 503 });
    expect(saved[0]).toMatchObject({ status: 'FAILED', errorCode: 'http_500' });
  });

  it('does not let malformed requests open the circuit for everybody', async () => {
    const { service, create } = build();
    create.mockRejectedValue(new Anthropic.BadRequestError(400, undefined, 'bad', new Headers()));
    for (let i = 0; i < 10; i++) {
      await expect(service.structured(request())).rejects.toBeDefined();
    }
    expect(service.isAvailable()).toBe(true);
  });

  it('opens the circuit when the provider keeps failing, and then stops calling it', async () => {
    const { service, create } = build();
    create.mockRejectedValue(new Anthropic.InternalServerError(500, undefined, 'down', new Headers()));
    for (let i = 0; i < 6; i++) {
      await expect(service.structured(request())).rejects.toBeDefined();
    }
    expect(service.isAvailable()).toBe(false);
    const calls = create.mock.calls.length;
    await expect(service.structured(request())).rejects.toMatchObject({ status: 503 });
    expect(create.mock.calls.length).toBe(calls);
  });
});

describe('costMicroUsd', () => {
  it('prices a call in millionths of a dollar from the list price', () => {
    // 1M input at $4 + 100k output at $20 = $4 + $2 = $6.
    expect(costMicroUsd('claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(6_000_000);
  });

  it('prices an unknown model at the dearest rate, never as free', () => {
    const usage = { inputTokens: 1_000, outputTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(costMicroUsd('some-future-model', usage)).toBe(costMicroUsd('claude-fable-5-1', usage));
  });
});
