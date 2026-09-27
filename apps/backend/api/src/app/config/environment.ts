/**
 * The one place that decides whether this process is a real deployment.
 *
 * Allow-list based: development fallbacks are permitted ONLY when NODE_ENV is explicitly
 * `development` or `test`. Every other value — `staging`, `prod`, `qa`, or unset — is treated as a
 * real deployment. The inverse rule (`NODE_ENV === 'production'`) once let a staging box fall
 * through to hardcoded development secrets and become token-forgeable.
 *
 * It lives in the platform layer because the cache, the column encryption, the tenancy check and
 * the extension sandbox all gate on it, and none of them may depend on Identity. `verify:env-gating`
 * refuses any other NODE_ENV comparison in the codebase.
 */
const DEV_LIKE_ENVIRONMENTS = new Set(['development', 'test']);

export function isDevLikeEnvironment(): boolean {
  return DEV_LIKE_ENVIRONMENTS.has((process.env['NODE_ENV'] ?? '').toLowerCase());
}
