import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { DataSource } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { AccountSegmentDefinition } from './entities/account-segment-definition.entity';

describe('Database Inspection', () => {
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

  it('should list organizations and their segments', async () => {
    const orgRepo = dataSource.getRepository(Organization);
    const segRepo = dataSource.getRepository(AccountSegmentDefinition);

    const orgs = await orgRepo.find();
    console.log('INSPECTION_START_ORGS');
    console.log(JSON.stringify(orgs));
    console.log('INSPECTION_END_ORGS');

    const segments = await segRepo.find();
    console.log('INSPECTION_START_SEGMENTS');
    console.log(JSON.stringify(segments));
    console.log('INSPECTION_END_SEGMENTS');
  });
});
