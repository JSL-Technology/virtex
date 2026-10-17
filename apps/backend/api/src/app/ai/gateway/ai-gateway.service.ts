import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Anthropic from '@anthropic-ai/sdk';
import CircuitBreaker = require('opossum');
import { createHash } from 'node:crypto';
import { AiRequest, AiRequestStatus } from '../entities/ai-request.entity';
import { AI_ROUTES, AiFeature, costMicroUsd, isPricedModel, TokenUsage } from './ai-models';
import { EntitlementsPort, SaasResource } from '../../saas/contracts/entitlements.contract';
import {
  ServiceUnavailableError,
  UnprocessableEntityError,
} from '../../i18n/localized.exception';

/** What a feature hands the gateway: one user turn whose answer must match `schema`. */
export interface StructuredRequest<T> {
  feature: AiFeature;
  organizationId: string;
  userId: string | null;
  /** Stable instructions. Kept free of per-request values so it can be served from the prompt cache. */
  system: string;
  content: Anthropic.ContentBlockParam[];
  /** JSON Schema of the answer. Every object needs `additionalProperties: false`. */
  schema: Record<string, unknown>;
  /**
   * Checks what the schema cannot say (an id that must belong to the tenant, a code that must be in
   * a list) and returns the typed value, or throws. The schema guarantees shape; this guarantees
   * meaning, and it runs on the server — the model's answer is input like any other.
   */
  validate: (value: unknown) => T;
  /** Identifies the input for the audit trail without storing it (e.g. the image's SHA-256). */
  inputFingerprint?: string;
}

export interface StructuredResult<T> {
  value: T;
  requestId: string;
  model: string;
}

/** Thrown to the breaker for failures that say nothing about the provider's health. */
class NonTrippingError extends Error {
  constructor(readonly original: unknown) {
    super('non-tripping');
  }
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * The one place in the product that calls a language model.
 *
 * Every feature goes through here so that the five things that must hold for EVERY call hold by
 * construction rather than by each feature remembering them:
 *
 *  1. **Entitlement.** The plan's `AI_CREDITS` are consumed before the call, inside a transaction,
 *     so concurrent requests cannot each find the last credit free.
 *  2. **Accounting.** Every call — successful, refused or failed — is written to `ai_requests` with
 *     its tokens, cost and latency. Nothing the user sent is stored; only a fingerprint.
 *  3. **Resilience.** A circuit breaker stops calling a provider that is failing, so a degraded API
 *     costs one fast 503 rather than a queue of ninety-second timeouts; the forms the AI assists
 *     keep working by hand. Refusals are re-run server-side on a fallback model (`fallbacks`).
 *  4. **Structure.** Answers are constrained to a JSON Schema by the API and then validated again
 *     here against the tenant's own data. A model's output is untrusted input.
 *  5. **Configuration.** Which model serves a feature is a deploy setting (`AI_MODEL_*`).
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);
  private readonly client: Anthropic | null;
  private readonly breaker: CircuitBreaker<[Anthropic.Beta.Messages.MessageCreateParamsNonStreaming], Anthropic.Beta.Messages.BetaMessage>;

  constructor(
    private readonly config: ConfigService,
    private readonly entitlements: EntitlementsPort,
    @InjectRepository(AiRequest) private readonly requests: Repository<AiRequest>,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    const enabled = this.config.get<boolean>('AI_ENABLED') !== false;
    this.client =
      enabled && apiKey
        ? new Anthropic({
            apiKey,
            timeout: this.config.get<number>('AI_REQUEST_TIMEOUT_MS') ?? 90_000,
            maxRetries: 2,
          })
        : null;

    this.breaker = new CircuitBreaker(
      async (params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming) => {
        try {
          return await this.client!.beta.messages.create(params);
        } catch (error) {
          // A request the API rejected as malformed, unauthorised or over quota is our problem or
          // the tenant's, not the provider being down; it must not open the circuit for everyone.
          if (
            error instanceof Anthropic.APIError &&
            typeof error.status === 'number' &&
            error.status >= 400 &&
            error.status < 500 &&
            error.status !== 408 &&
            error.status !== 429
          ) {
            throw new NonTrippingError(error);
          }
          throw error;
        }
      },
      {
        // The SDK enforces the request timeout and retries; the breaker only counts outcomes.
        timeout: false,
        errorThresholdPercentage: 50,
        volumeThreshold: 5,
        resetTimeout: 30_000,
        errorFilter: (error: unknown) => error instanceof NonTrippingError,
      },
    );
    this.breaker.on('open', () => this.logger.warn('AI provider circuit OPEN — AI features degrade to manual'));
    this.breaker.on('close', () => this.logger.log('AI provider circuit CLOSED'));
  }

  /** Whether calls can be made at all: a key is configured, AI is enabled and the circuit is closed. */
  isAvailable(): boolean {
    return this.client !== null && !this.breaker.opened;
  }

  async structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    if (!this.client) {
      throw new ServiceUnavailableError('ai.not_configured');
    }
    if (this.breaker.opened) {
      throw new ServiceUnavailableError('ai.temporarily_unavailable');
    }

    const route = AI_ROUTES[request.feature];
    const model = this.config.get<string>(route.modelSetting) as string;
    if (!isPricedModel(model)) {
      this.logger.warn(`Model ${model} has no list price; its cost is reported at the dearest rate.`);
    }

    // 1. Pay first: the plan's counter moves before the provider is called.
    await this.entitlements.consume(request.organizationId, SaasResource.AI_CREDITS, route.credits);

    const started = Date.now();
    const record: Partial<AiRequest> = {
      organizationId: request.organizationId,
      userId: request.userId,
      feature: request.feature,
      provider: 'anthropic',
      model,
      credits: route.credits,
      inputHash: request.inputFingerprint
        ? createHash('sha256').update(`${request.feature}:${request.inputFingerprint}`).digest('hex')
        : null,
    };

    let response: Anthropic.Beta.Messages.BetaMessage;
    try {
      response = await this.breaker.fire({
        model,
        max_tokens: route.maxTokens,
        system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: request.content as Anthropic.Beta.Messages.BetaContentBlockParam[] }],
        output_config: {
          effort: route.effort,
          format: { type: 'json_schema', schema: request.schema },
        },
        // A safety decline is re-run on the fallback model the API picks for its category, inside
        // the same call; the response's `model` says which one answered.
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
      });
    } catch (error) {
      const cause = error instanceof NonTrippingError ? error.original : error;
      await this.record(record, 'FAILED', started, null, null, this.errorCode(cause));
      this.logger.error(
        `AI call failed (${request.feature}, org ${request.organizationId}): ${(cause as Error)?.message ?? cause}`,
      );
      if (this.breaker.opened || (cause as Error)?.message?.includes('Breaker is open')) {
        throw new ServiceUnavailableError('ai.temporarily_unavailable');
      }
      throw new ServiceUnavailableError('ai.provider_error');
    }

    const usage: TokenUsage = {
      inputTokens: response.usage.input_tokens ?? 0,
      outputTokens: response.usage.output_tokens ?? 0,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    };
    record.model = response.model ?? model;

    if (response.stop_reason === 'refusal') {
      const id = await this.record(record, 'REFUSED', started, usage, response.stop_reason);
      this.logger.warn(`AI call refused (${request.feature}, request ${id})`);
      throw new UnprocessableEntityError('ai.request_refused');
    }
    if (response.stop_reason === 'max_tokens') {
      await this.record(record, 'FAILED', started, usage, response.stop_reason, 'max_tokens');
      throw new UnprocessableEntityError('ai.answer_incomplete');
    }

    const text = response.content
      .filter((block): block is Anthropic.Beta.Messages.BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    let value: T;
    try {
      value = request.validate(JSON.parse(text));
    } catch (error) {
      await this.record(record, 'FAILED', started, usage, response.stop_reason, 'invalid_answer');
      this.logger.warn(`AI answer failed validation (${request.feature}): ${(error as Error).message}`);
      throw new UnprocessableEntityError('ai.answer_invalid');
    }

    const requestId = await this.record(record, 'SUCCEEDED', started, usage, response.stop_reason);
    return { value, requestId, model: record.model as string };
  }

  private async record(
    base: Partial<AiRequest>,
    status: AiRequestStatus,
    started: number,
    usage: TokenUsage | null,
    stopReason: string | null,
    errorCode: string | null = null,
  ): Promise<string> {
    const row = this.requests.create({
      ...base,
      status,
      stopReason,
      errorCode,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      cacheReadTokens: usage?.cacheReadTokens ?? 0,
      cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
      costMicroUsd: usage ? costMicroUsd(base.model as string, usage) : 0,
      latencyMs: Date.now() - started,
    });
    try {
      const saved = await this.requests.save(row);
      return saved.id;
    } catch (error) {
      // The answer must not be lost because its receipt could not be written; the credit was
      // already consumed by `enforceLimit`, so the quota stays correct either way.
      this.logger.error(`Could not record AI request: ${(error as Error).message}`);
      return '';
    }
  }

  private errorCode(error: unknown): string {
    if (error instanceof Anthropic.APIError) {
      return `http_${error.status ?? 'unknown'}`;
    }
    if ((error as Error)?.message?.includes('Breaker is open')) return 'circuit_open';
    return 'unknown';
  }
}
