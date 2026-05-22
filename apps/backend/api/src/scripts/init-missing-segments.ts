import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app/app.module';
import { AccountSegmentsService } from '../app/chart-of-accounts/account-segments.service';
import { OrganizationsService } from '../app/organizations/organizations.service';
import { Organization } from '../app/organizations/entities/organization.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const segmentsService = app.get(AccountSegmentsService);
  const orgsService = app.get(OrganizationsService);
  const orgRepo = app.get<Repository<Organization>>(getRepositoryToken(Organization));

  console.log('--- Iniciando script de inicialización de segmentos ---');

  const organizations = await orgRepo.find();
  console.log(`Se encontraron ${organizations.length} organizaciones.`);

  let initializedCount = 0;
  for (const org of organizations) {
    const existingSegments = await segmentsService.findByOrg(org.id);
    if (existingSegments.length === 0) {
      console.log(`Inicializando segmentos para: ${org.legalName} (${org.id})`);
      await segmentsService.initializeDefault(org.id);
      initializedCount++;
    } else {
      console.log(`Organización ${org.legalName} ya tiene segmentos. Omitiendo.`);
    }
  }

  console.log(`--- Script finalizado. Organizaciones inicializadas: ${initializedCount} ---`);
  await app.close();
}

bootstrap().catch(err => {
  console.error('Error al ejecutar el script:', err);
  process.exit(1);
});
