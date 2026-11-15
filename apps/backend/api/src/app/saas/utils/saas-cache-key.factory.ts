export class SaasCacheKeyFactory {
  static limitVersion(orgId: string): string {
    return `org_limit_version:${orgId}`;
  }

  static limitCheck(orgId: string, version: number | string, resource: string): string {
    return `plan_limit_check:${orgId}:${version}:${resource}`;
  }

  /** Every capability the organization's plan grants, under one key per cache generation. */
  static planFeatures(orgId: string, version: number | string): string {
    return `plan_features:${orgId}:${version}`;
  }

  static warningDebounce(orgId: string, resource: string): string {
    return `debounce:limit_warning:${orgId}:${resource}`;
  }
}
