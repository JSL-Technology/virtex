import type { FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/cookie';

/**
 * The request and response types this application actually runs on.
 *
 * Thirteen backend files imported `Request` and `Response` from `express` while `main.ts` boots
 * the app with `FastifyAdapter`. Nothing broke, but only by luck: `@fastify/cookie` happens to
 * decorate the reply with a `cookie` alias next to `setCookie`
 * (node_modules/@fastify/cookie/plugin.js:143), and `reply.redirect(url)` happens to accept a
 * single argument. The compiler was therefore checking every handler against an API that is not
 * the one being called.
 *
 * That is a live hazard, not a tidiness complaint. `res.status(302).json(...)`, `res.locals`,
 * `res.send(body)` with Express's argument order, `req.get('header')` — all of them typecheck
 * against `express` and all of them are wrong here. The first one written fails in production
 * with a green build.
 *
 * `@fastify/cookie` is imported for its side effect: the plugin declares the module augmentation
 * that adds `cookies` to the request and `setCookie`/`clearCookie`/`cookie` to the reply.
 */
export type HttpRequest = FastifyRequest;
export type HttpResponse = FastifyReply;

/** A request whose principal has already been resolved by `JwtAuthGuard`. */
export type HttpRequestWithCookies = FastifyRequest & {
  cookies: Record<string, string | undefined>;
};
