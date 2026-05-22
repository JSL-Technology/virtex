import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { DataSource } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { AccountSegmentDefinition } from './entities/account-segment-definition.entity';

describe('Fix Organization Segments', () => {
  let dataSource: DataSource;
  let app: TestingModule;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should populate missing segment definitions for all organizations', async () => {
    const orgRepo = dataSource.getRepository(Organization);
    const segRepo = dataSource.getRepository(AccountSegmentDefinition);

    const orgs = await orgRepo.find();
    console.log(`Processing ${orgs.length} organizations...`);

    for (const org of orgs) {
      const existing = await segRepo.count({ where: { organizationId: org.id } });
      if (existing === 0) {
        console.log(`Fixing organization ${org.id} (${org.legalName})...`);
        const defaults = [
          { name: 'Nivel 1', length: 1, isRequired: true, order: 0 },
          { name: 'Nivel 2', length: 2, isRequired: true, order: 1 },
          { name: 'Nivel 3', length: 2, isRequired: true, order: 2 },
          { name: 'Nivel 4', length: 3, isRequired: true, order: 3 },
        ];
        const definitions = defaults.map(d => segRepo.create({ ...d, organizationId: org.id }));
        await segRepo.save(definitions);
        console.log(`Created ${definitions.length} segments for ${org.legalName}.`);
      } else {
        console.log(`Organization ${org.legalName} already has ${existing} segments.`);
      }
    }
  });
});
