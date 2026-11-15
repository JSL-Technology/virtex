export class SaasCacheKeyFactory {
  static limitVersion(orgId: string): string {
    return `org_limit_version:${orgId}`;
  }

  static limitCheck(orgId: string, version: number | string, resource: string): string {
    return `plan_limit_check:${orgId}:${version}:${resource}`;
  }

  static featureFlag(orgId: string, featureKey: string): string {
    return `feature_flag:${orgId}:${featureKey}`;
  }

  static warningDebounce(orgId: string, resource: string): string {
    return `debounce:limit_warning:${orgId}:${resource}`;
  }
}
