import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { DataSource } from 'typeorm';
import { Organization } from './app/organizations/entities/organization.entity';
import { AccountSegmentDefinition } from './app/chart-of-accounts/entities/account-segment-definition.entity';

async function bootstrap() {
  try {
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    const dataSource = app.get(DataSource);

    const orgRepo = dataSource.getRepository(Organization);
    const segRepo = dataSource.getRepository(AccountSegmentDefinition);

    const orgs = await orgRepo.find();
    console.log(JSON.stringify({ type: 'organizations', data: orgs }));

    const results = [];
    for (const org of orgs) {
      const segments = await segRepo.find({ where: { organizationId: org.id }, order: { order: 'ASC' } });
      results.push({ orgId: org.id, orgName: org.legalName, segmentCount: segments.length, segments });
    }
    console.log(JSON.stringify({ type: 'segments', data: results }));

    await app.close();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

bootstrap();
