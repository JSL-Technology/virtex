/**
 * Runtime policy for the extensions sandbox.
 *
 * Ported from the standalone `plugin-host` service (special-enigma) into the consolidated API.
 * The values are the security envelope every extension runs inside: which hosts it may reach, and
 * the memory/CPU/time budget the isolate is allowed to consume. Egress is deny-by-default — an
 * extension can only call out to hosts explicitly listed here (or granted per-tenant capabilities).
 *
 * Overridable via environment so an operator can tighten limits without a code change.
 */
const parseList = (value: string | undefined, fallback: string[]): string[] =>
  value
    ? value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : fallback;

const parseInt10 = (value: string | undefined, fallback: number): number => {
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const PLUGIN_POLICY = {
  egress: {
    allowlist: parseList(process.env['PLUGIN_EGRESS_ALLOWLIST'], [
      'api.virtex.io',
      'auth.virtex.io',
      'api.taxjar.com',
    ]),
    denyByDefault: true,
  },
  limits: {
    memoryMb: parseInt10(process.env['PLUGIN_MEMORY_LIMIT_MB'], 128),
    timeoutMs: parseInt10(process.env['PLUGIN_TIMEOUT_MS'], 1000),
    cpuPercentage: parseInt10(process.env['PLUGIN_CPU_PERCENTAGE'], 10),
  },
} as const;

export type PluginPolicy = typeof PLUGIN_POLICY;
