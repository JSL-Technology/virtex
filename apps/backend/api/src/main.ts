import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { useContainer } from 'class-validator';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { I18nService } from './app/i18n/i18n.service';
import { localizedValidationExceptionFactory } from './app/i18n/validation-messages';
import { DevSeederService } from './app/auth/services/dev-seeder.service';

import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';

/**
 * A-1 FIX: Resolve the Fastify `trustProxy` setting from the environment.
 *
 * Without trustProxy, `request.ip` behind a reverse proxy (Render/Cloudflare/nginx) is the
 * proxy's address for EVERY request. That silently defeats: ThrottlerGuard (one shared bucket
 * for the whole platform => self-DoS and zero brute-force protection), lockout attribution,
 * impossible-travel detection, geo-location, per-session IP display, and the IP binding of the
 * pending-2FA session.
 *
 * Accepted values, mirroring Fastify's own contract:
 *   - unset  => `1` in production (trust exactly one proxy hop), `false` in dev (direct socket).
 *   - "true" => trust every hop. ONLY safe when the app is unreachable except through the proxy;
 *               otherwise a client can spoof its IP by injecting X-Forwarded-For entries.
 *   - "2"    => trust N hops (use when chaining CDN + LB).
 *   - CIDR/IP list ("10.0.0.0/8,192.168.1.1") => trust only these proxies. Most precise option.
 */
export function parseTrustProxy(raw?: string): boolean | number | string[] {
  const value = raw?.trim();
  if (!value) {
    return process.env['NODE_ENV'] === 'production' ? 1 : false;
  }
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false, // controlled by pino
      bodyLimit: 10 * 1024 * 1024, // 10MB
      trustProxy: parseTrustProxy(process.env['TRUST_PROXY']),
    }),
    {
      rawBody: true,
      bufferLogs: true,
    }
  );

  app.useLogger(app.get(Logger));
  const configService = app.get(ConfigService);

  const isProduction = configService.get('NODE_ENV') === 'production';

  // H17 FIX: Harden security headers.
  // Production: explicit HSTS + remove unsafe-inline from script-src.
  // Dev: keep unsafe-inline so Angular CLI dev server works without nonce plumbing.
  // styleSrc retains 'unsafe-inline' because Swagger UI injects inline styles at runtime.
  // connectSrc includes CORS_ORIGIN so Socket.IO / WebSocket connections from the frontend
  // are not blocked when the frontend runs on a different origin (H-11).
  const corsOriginHeader = configService.get<string>('CORS_ORIGIN', 'http://localhost:4200');
  const corsOrigins = corsOriginHeader.split(',').map((o) => o.trim());
  const wsOrigins = corsOrigins.map((o) => o.replace(/^http/, 'ws'));

  await app.register(fastifyHelmet, {
    // HSTS: 1 year, include subdomains, preload — applied in production only.
    strictTransportSecurity: isProduction
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // needed by Swagger UI inline styles
        // Production: remove unsafe-inline from scripts; Angular must emit hashes/nonces via build config.
        scriptSrc: isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        // connectSrc must allow the frontend origin(s) + their ws:// counterparts for Socket.IO.
        connectSrc: ["'self'", ...corsOrigins, ...wsOrigins],
        fontSrc: ["'self'", 'https:', 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(isProduction ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(fastifyCookie);

  // Register Multipart with attachFieldsToBody: true to populate req.body
  await app.register(fastifyMultipart, {
     limits: {
         fileSize: 10 * 1024 * 1024, // 10MB
     },
     attachFieldsToBody: true,
  });

  // H-01 FIX: corsOrigins already declared at top of bootstrap — reuse it here (CWE-703)
  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      /**
       * One error per field — chosen, not taken.
       *
       * An empty `address` on the signup form breaks three rules at once: "must be shorter than
       * 200 characters", "La dirección fiscal es obligatoria." and "must be text". Only the second
       * is true of what happened; the client joins them with commas, so the customer read a
       * contradiction on the form that takes their money. One message per field is right.
       *
       * `stopAtFirstError` was how that was done, on the stated grounds that "constraints are
       * evaluated in declaration order, and the DTOs declare presence before shape". They are not.
       * A property decorator is applied bottom-up, so `class-validator` registers them in REVERSE,
       * and the survivor was the LAST rule written — the one the DTOs deliberately put last
       * because it explains least. Against this server: a request with no `terminalId` was told
       * the field "cannot be longer than 120 characters", and the signup form with no
       * organization name, that it "must be at least 2 characters long". Both fields were absent.
       *
       * So the pipe now reports everything and `explanatoryConstraints` picks, from the value
       * rather than from the order: an absent field is reported as required, and a present one by
       * the most fundamental rule it breaks. That choice lives beside the catalogue lookups it
       * feeds, and is tested there.
       */
      /**
       * Validation failures are answered in the reader's language.
       *
       * The factory needs the catalogue, and the catalogue is a provider, so the pipe is built
       * here from the running application rather than declared as `APP_PIPE`: `useGlobalPipes`
       * with an instance is the only form that can take a dependency resolved from the injector.
       */
      exceptionFactory: localizedValidationExceptionFactory(app.get(I18nService)),
    }),
  );

  const apiPrefix = configService.get<string>('API_PREFIX', 'api/v1');
  app.setGlobalPrefix(apiPrefix);

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Virtex API')
      .setDescription('Enterprise Resource Planning API')
      .setVersion('1.0')
      .addTag('Auth')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);

    // Basic-auth gate for Swagger in non-production environments.
    // Set SWAGGER_USER and SWAGGER_PASSWORD env vars; if password is unset, docs are inaccessible.
    const swaggerUser = configService.get<string>('SWAGGER_USER', 'admin');
    const swaggerPassword = configService.get<string>('SWAGGER_PASSWORD', '');
    const fastifyInstance = app.getHttpAdapter().getInstance() as any;
    fastifyInstance.addHook('onRequest', async (request: any, reply: any) => {
      if (!request.url?.startsWith('/api/docs')) return;
      const authHeader: string | undefined = request.headers['authorization'];
      if (!authHeader?.startsWith('Basic ') || !swaggerPassword) {
        reply
          .header('WWW-Authenticate', 'Basic realm="Swagger Docs"')
          .status(401)
          .send('Unauthorized');
        return;
      }
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
      const colonIdx = decoded.indexOf(':');
      const user = decoded.slice(0, colonIdx);
      const pass = decoded.slice(colonIdx + 1);
      if (user !== swaggerUser || pass !== swaggerPassword) {
        reply
          .header('WWW-Authenticate', 'Basic realm="Swagger Docs"')
          .status(401)
          .send('Unauthorized');
      }
    });
  }

  // Lifecycle hooks run here, BEFORE anything below reads reference data.
  //
  // `LocalizationService.onModuleInit()` is what seeds `fiscal_regions`, and Nest runs init hooks
  // from `app.init()` — which `listen()` used to trigger, further down. So on a fresh database the
  // dev seeder below ran against an empty `fiscal_regions`: it resolved no region for the country,
  // `applyFiscalPackage` rejected the tenant, and the fallback produced an administrator whose
  // organization had no chart of accounts, no taxes, no ledger, no journals and no open periods —
  // a login that cannot post a debit, while a tenant created by the real signup (which resolves
  // its region at request time, long after boot) gets all of it. `listen()` reuses this
  // initialisation, so this only fixes the ordering; it does not initialise twice.
  useContainer(app.select(AppModule), { fallbackOnErrors: true });
  await app.init();

  // Development convenience: seed a ready-to-use administrator so a login exists on a fresh
  // database, without registering one by hand each time. Hard-gated to non-production (and the
  // service refuses to run in production as well — defence in depth); opt out with DEV_SEED=false.
  if (
    configService.get<string>('NODE_ENV') !== 'production' &&
    configService.get<string>('DEV_SEED') !== 'false'
  ) {
    try {
      await app.get(DevSeederService).seed();
    } catch (err) {
      console.warn('Dev seed skipped:', err instanceof Error ? err.message : err);
    }
  }

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Application is running on: ${await app.getUrl()}/${apiPrefix}`);
}
bootstrap();
