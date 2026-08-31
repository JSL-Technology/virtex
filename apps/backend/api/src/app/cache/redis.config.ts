import { ConfigService } from '@nestjs/config';

/**
 * One description of how to reach Redis, read by everything that reaches it.
 *
 * `CacheModule`, `QueuesModule` and the throttler each built their own connection from
 * `REDIS_HOST` and `REDIS_PORT` and nothing else. No username, no password, no TLS — so every
 * managed Redis on the market (ElastiCache with AUTH, Upstash, Redis Cloud, Render, Azure Cache)
 * was unreachable, and the only deployable configuration was an unauthenticated Redis on a
 * private network. That is not a hardening gap, it is a deployment that cannot be performed.
 *
 * `REDIS_URL` takes precedence when present because that is the single variable every managed
 * provider hands out; the discrete variables remain for local development and for operators who
 * prefer them.
 */

export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  /** Present only when TLS is on; `{}` is what ioredis and node-redis both read as "use TLS". */
  tls?: Record<string, never>;
}

/** True when the deployment asked for TLS, either explicitly or through a `rediss://` URL. */
function usesTls(config: ConfigService): boolean {
  const url = config.get<string>('REDIS_URL');
  if (url?.startsWith('rediss://')) return true;
  return config.get<boolean>('REDIS_TLS', false) === true;
}

/**
 * Connection options in the shape ioredis and node-redis both accept.
 * Used by BullMQ and by the throttler's Redis storage.
 */
export function redisConnectionOptions(config: ConfigService): RedisConnectionOptions {
  const url = config.get<string>('REDIS_URL');

  if (url) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 6379,
      ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
      ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
      ...(usesTls(config) ? { tls: {} as Record<string, never> } : {}),
    };
  }

  const username = config.get<string>('REDIS_USERNAME');
  const password = config.get<string>('REDIS_PASSWORD');

  return {
    host: config.get<string>('REDIS_HOST', 'localhost'),
    port: config.get<number>('REDIS_PORT', 6379),
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(usesTls(config) ? { tls: {} as Record<string, never> } : {}),
  };
}

/** The same connection as a URL, which is what Keyv's Redis store takes. */
export function redisUrl(config: ConfigService): string {
  const explicit = config.get<string>('REDIS_URL');
  if (explicit) return explicit;

  const { host, port, username, password } = redisConnectionOptions(config);
  const scheme = usesTls(config) ? 'rediss' : 'redis';
  const credentials =
    username || password
      ? `${encodeURIComponent(username ?? '')}:${encodeURIComponent(password ?? '')}@`
      : '';

  return `${scheme}://${credentials}${host}:${port}`;
}
