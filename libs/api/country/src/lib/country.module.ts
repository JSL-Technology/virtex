import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CountryController } from './controllers/country.controller';
import { CountryService } from './services/country.service';
import { CountryConfig } from './entities/country-config.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CountryConfig])],
  controllers: [CountryController],
  providers: [CountryService],
  exports: [CountryService],
})
export class CountryModule {}
