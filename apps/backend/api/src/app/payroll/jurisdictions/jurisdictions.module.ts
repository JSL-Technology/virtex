import { Module } from '@nestjs/common';
import { JurisdictionRegistry } from './jurisdiction-registry';

/**
 * Leaf module exposing the payroll jurisdiction registry on its own.
 *
 * `JurisdictionRegistry` was a private provider of `PayrollModule`, which meant anything needing to
 * ask "what does this country's payroll law require?" had to import the whole payroll module — its
 * ten entities, its accounting and journal-entry dependencies, and the `forwardRef` cycles that
 * come with them. HCM needs exactly one thing from it: the country's `statutoryIdentifiers`, so it
 * can stop asserting the Dominican NSS format against every market's employees.
 *
 * The registry holds pure strategy objects and depends on nothing, so a leaf costs nothing and
 * breaks the cycle by construction. Same pattern as `LocalizationProvisioningModule` and
 * `OrgSettingsModule`.
 */
@Module({
  providers: [JurisdictionRegistry],
  exports: [JurisdictionRegistry],
})
export class JurisdictionsModule {}
