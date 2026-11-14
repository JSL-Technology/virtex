import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/**
 * Imports no business module, by design: what can be searched registers itself
 * (`contracts/search`), and `ContractsModule` is global. The three imports that used to be here —
 * invoices, inventory, customers — were two of the module cycles the boundary check reports.
 */
@Module({
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
