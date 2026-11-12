/**
 * Whether this process may reach the outside world for a given kind of effect.
 *
 * ## Why one switch
 *
 * A request to a tax authority cannot be taken back. `npm run verify:invoicing` — which CI runs on
 * every push — requested a DGII authentication seed and posted a signed one to `ecf.dgii.gov.do`,
 * and the e-CF retry and verdict-polling crons run every few minutes in any process that boots,
 * development included (audit 2026-11-07, FAC-EINV-02 / FE-CI-03). Nothing in the transport layer
 * asked whether this process was meant to do that.
 *
 * Every outbound call with a real-world consequence now asks here first, by kind:
 *
 *   fiscal_authority   DGII e-CF, the other regimes' authorities, Mexico's PAC
 *
 * ## The rule
 *
 * `EXTERNAL_EFFECTS` decides: `all`, `none`, or a comma-separated list of kinds.
 * Unset, it is `all` in a real deployment and `none` in a development-like process
 * (`isDevLikeEnvironment`, the project's single allow-listed environment decision) — so a laptop or
 * a CI runner must opt IN to talking to a tax authority, and production never has to remember to.
 * A production process cannot be configured with `none`: `env.validation.ts` refuses it at boot,
 * because a production that silently stops transmitting fiscal documents is worse than one that
 * fails to start.
 */
import { isDevLikeEnvironment } from './environment';

export enum ExternalEffect {
  FiscalAuthority = 'fiscal_authority',
}

const ALL = Object.values(ExternalEffect) as string[];

/** Parse `EXTERNAL_EFFECTS` into the set of allowed kinds. Unknown kinds are an error, not a no-op. */
export function parseExternalEffects(raw: string | undefined, devLike: boolean): Set<string> {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return new Set(devLike ? [] : ALL);
  if (value === 'all') return new Set(ALL);
  if (value === 'none') return new Set();
  const kinds = value.split(',').map((kind) => kind.trim()).filter(Boolean);
  const unknown = kinds.filter((kind) => !ALL.includes(kind));
  if (unknown.length) {
    throw new Error(`EXTERNAL_EFFECTS names unknown kinds: ${unknown.join(', ')} (known: ${ALL.join(', ')}, or all / none)`);
  }
  return new Set(kinds);
}

export function externalEffectAllowed(effect: ExternalEffect, env: NodeJS.ProcessEnv = process.env): boolean {
  return parseExternalEffects(env['EXTERNAL_EFFECTS'], isDevLikeEnvironment()).has(effect);
}

/**
 * Thrown — never swallowed into a fake success — when a call is refused by the switch.
 *
 * Callers that persist a transmission state record it as "not transmitted", exactly as they do for
 * a missing endpoint, so nothing downstream mistakes a refused call for an authority's answer.
 */
export class ExternalEffectDisabledError extends Error {
  readonly code = 'EXTERNAL_EFFECT_DISABLED';

  constructor(readonly effect: ExternalEffect) {
    super(
      `Outbound ${effect} calls are disabled in this process (EXTERNAL_EFFECTS). ` +
        'Nothing was sent; set EXTERNAL_EFFECTS to allow it deliberately.',
    );
    this.name = 'ExternalEffectDisabledError';
  }
}

/** Throw unless `effect` is allowed. */
export function assertExternalEffectAllowed(effect: ExternalEffect, env: NodeJS.ProcessEnv = process.env): void {
  if (!externalEffectAllowed(effect, env)) throw new ExternalEffectDisabledError(effect);
}
