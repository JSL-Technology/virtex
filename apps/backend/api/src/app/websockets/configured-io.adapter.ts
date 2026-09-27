import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

import { CorsOrigins } from '../shared/http/cors-origins';

/**
 * The Socket.IO server, with its allowed origins taken from configuration.
 *
 * ## Why an adapter and not the decorator
 *
 * `@WebSocketGateway({ cors: ... })` is evaluated when the class is IMPORTED, which happens before
 * `ConfigModule` has loaded `.env` — so a decorator that tried to read the configuration would
 * read whatever `process.env` happened to hold at import time, and silently fall back in exactly
 * the deployments that matter. That is why the origin ended up hardcoded in the first place.
 *
 * An adapter is constructed from the running application, after configuration is resolved, and the
 * options it returns override whatever the decorator declared. So the gateway keeps a bare
 * decorator and this decides — one rule, applied where the rule can actually be read.
 *
 * `credentials: true` is required: the handshake authenticates with the same httpOnly cookies the
 * HTTP API uses, and a browser will not attach them to a cross-origin upgrade without it. That is
 * also precisely why the origin list must not include a value nobody chose.
 */
export class ConfiguredIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origins: CorsOrigins,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: {
        // The same list `app.enableCors` was given. Not a wildcard: with `credentials: true` a
        // wildcard is rejected by browsers anyway, and reflecting the request's own origin would
        // make the allow-list decorative.
        origin: [...this.origins.http],
        credentials: true,
      },
    });
  }
}
