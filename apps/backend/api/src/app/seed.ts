import { NestFactory } from '@nestjs/core';
import { SeederModule } from './bi/seeder.module';
import { BiService } from './bi/bi.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(SeederModule, {
    logger: ['error', 'warn', 'log'],
  });

  const biService = app.get(BiService);

  console.log('Iniciando el proceso de seeding para la dimensión de tiempo...');

  try {
    if (process.env.DB_SYNCHRONIZE !== 'true') {
        console.warn(
            'ADVERTENCIA: DB_SYNCHRONIZE no está en "true". El script podría fallar si la tabla "dim_time" no existe.',
        );
    }

    await biService.populateTimeDimension('2020-01-01', '2025-12-31');
    console.log('✅ Seeding de la dimensión de tiempo completado exitosamente.');
  } catch (error) {
    console.error('❌ Error durante el proceso de seeding:', error);
    process.exit(1);
  } finally {
    await app.close();
    process.exit(0);
  }
}

bootstrap();
