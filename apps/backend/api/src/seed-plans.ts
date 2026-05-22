
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app/app.module';
import { SaasService } from './app/saas/saas.service';

async function bootstrap() {
  const logger = new Logger('SeedPlans');
  try {
    const app = await NestFactory.createApplicationContext(AppModule);
    const saasService = app.get(SaasService);

    logger.log('Starting SaaS Plans Seeding...');
    await saasService.seedPlans();
    logger.log('SaaS Plans Seeding Completed Successfully.');

    await app.close();
    process.exit(0);
  } catch (error) {
    logger.error('Seeding failed', error);
    process.exit(1);
  }
}

bootstrap();
