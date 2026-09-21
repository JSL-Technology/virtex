/**
 * The one question `auth` asks the organizations module at sign-in.
 *
 * `AuthService` needs to know whether a tenant requires a second factor of its members. Injecting
 * `OrgSettingsService` to find out would make `auth` depend on `organizations`, and the module
 * graph in this codebase deliberately runs the other way — `module-graph.spec.ts` and
 * `verify:boundaries` both hold that line.
 *
 * So the dependency is narrowed to its actual shape: one boolean, keyed by tenant. The same
 * pattern as `SessionInvalidatorPort`, `PasswordVerifierPort` and `SessionSwitchPort`.
 */
export abstract class MfaPolicyPort {
  /** Whether every member of this organization must hold a second factor. */
  abstract requiresMfa(organizationId: string): Promise<boolean>;
}
