import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EinvoicingModule } from './einvoicing.module';
import { FiscalRegimeSettingsController } from './fiscal-regime-settings.controller';

/**
 * The e-invoicing configuration endpoints, as a leaf module.
 *
 * Saving the transmission credential demands re-authentication (`@RequireStepUp`), whose guard
 * needs `AuthModule`. `AuthModule` reaches `EinvoicingModule` through the modules it imports, so
 * importing it there would close a cycle; nothing imports this module, so it can import both
 * without one — and without a `forwardRef` that would only hide the cycle.
 */
@Module({
  imports: [EinvoicingModule, AuthModule],
  controllers: [FiscalRegimeSettingsController],
})
export class EinvoicingAdminModule {}
