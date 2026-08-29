/**
 * Boot the Nest application context and shut it down.
 *
 * A successful webpack build proves the code compiles; it proves nothing about dependency
 * injection. A missing provider, an unexported service, an unresolvable circular import — all of
 * those compile cleanly and fail on the first request in production. This resolves the entire
 * module graph, which is the only way to find them before a deploy does.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../apps/backend/api/src/app/app.module';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  console.log('\n✓ Module graph resolved: every provider in the application injected cleanly.');
  await app.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('\n✗ Module graph failed to resolve:\n');
  console.error(error);
  process.exit(1);
});
