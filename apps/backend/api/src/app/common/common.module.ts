import { Module } from '@nestjs/common';
import { CommonController } from './controllers/common.controller';
import { ConfigController } from './controllers/config.controller';

/**
 * Imports nothing. `common` is platform, and platform depends on no business module.
 *
 * It used to import `UsersModule`, `OrganizationsModule` and `LocalizationModule` — three module
 * cycles' worth of coupling for nothing: the imports were left behind when the two account- and
 * tax-id-enumeration probes were removed from `CommonController`, which is now an empty shell, and
 * `ConfigController` answers two static lists that need no provider at all.
 */
@Module({
  controllers: [CommonController, ConfigController],
})
export class CommonModule {}
