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

import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false, // controlled by pino
      bodyLimit: 10 * 1024 * 1024, // 10MB
    }),
    {
      rawBody: true,
      bufferLogs: true,
    }
  );

  app.useLogger(app.get(Logger));
  const configService = app.get(ConfigService);

  // Security Headers using Fastify Helmet
  // styleSrc retains 'unsafe-inline' because Swagger UI injects inline styles at runtime.
  // All other directives follow strict deny-by-default; adjust per deployment context.
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // needed by Swagger UI
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  });

  await app.register(fastifyCookie);

  // Register Multipart with attachFieldsToBody: true to populate req.body
  await app.register(fastifyMultipart, {
     limits: {
         fileSize: 10 * 1024 * 1024, // 10MB
     },
     attachFieldsToBody: true,
  });

  const corsOrigins = configService.get<string>('CORS_ORIGIN', 'http://localhost:4200').split(',');

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
    }),
  );

  const apiPrefix = configService.get<string>('API_PREFIX', 'api/v1');
  app.setGlobalPrefix(apiPrefix);

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Virteex ERP API')
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

  const port = configService.get<number>('PORT', 3000);
  useContainer(app.select(AppModule), { fallbackOnErrors: true });
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Application is running on: ${await app.getUrl()}/${apiPrefix}`);
}
bootstrap();
