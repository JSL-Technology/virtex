import { HttpException, HttpStatus } from '@nestjs/common';
import { SaasResource } from '../enums/saas-resource.enum';
import { LOCALIZED_ERROR } from '../../i18n/localized.exception';

export enum SaasErrorCode {
  LIMIT_REACHED = 'SAAS_LIMIT_REACHED',
  FEATURE_NOT_ENABLED = 'SAAS_FEATURE_NOT_ENABLED',
  ORGANIZATION_NOT_FOUND = 'SAAS_ORGANIZATION_NOT_FOUND',
  PLAN_NOT_FOUND = 'SAAS_PLAN_NOT_FOUND',
}

/**
 * What each refusal says to the reader. These exceptions carried English text the exception filter
 * could not translate, so a plan limit reached the screen as the generic «You do not have
 * permission to perform this action» — the wrong reason, and no way forward.
 */
const MESSAGE_KEYS: Readonly<Record<SaasErrorCode, string>> = {
  [SaasErrorCode.LIMIT_REACHED]: 'saas.plan_limit_reached',
  [SaasErrorCode.FEATURE_NOT_ENABLED]: 'saas.plan_feature_not_enabled',
  [SaasErrorCode.ORGANIZATION_NOT_FOUND]: 'saas.no_active_plan',
  [SaasErrorCode.PLAN_NOT_FOUND]: 'saas.no_active_plan',
};

export class SaasException extends HttpException {
  declare readonly [LOCALIZED_ERROR]: true;
  declare readonly messageKey: string;
  declare readonly params: Record<string, unknown>;

  constructor(
    public readonly code: SaasErrorCode,
    public readonly resource?: SaasResource | string,
    message?: string,
    status: HttpStatus = HttpStatus.FORBIDDEN
  ) {
    super(
      {
        statusCode: status,
        message: message || code,
        error: code,
        resource: resource,
      },
      status
    );
    // Localized, keeping the SaaS code as the error code: the transition remedies match on it
    // (`SAAS_LIMIT_REACHED` → «Review plan»).
    Object.assign(this, {
      [LOCALIZED_ERROR]: true as const,
      messageKey: MESSAGE_KEYS[code],
      params: {
        resource: code === SaasErrorCode.LIMIT_REACHED && resource ? `saas.resources.${resource}` : (resource ?? ''),
      },
    });
  }
}

export class SaasLimitReachedException extends SaasException {
  constructor(resource: SaasResource) {
    super(
      SaasErrorCode.LIMIT_REACHED,
      resource,
      `Limit reached for resource: ${resource}`,
      HttpStatus.FORBIDDEN
    );
  }
}

export class SaasFeatureNotEnabledException extends SaasException {
  constructor(feature: string) {
    super(
      SaasErrorCode.FEATURE_NOT_ENABLED,
      feature,
      `Feature not enabled: ${feature}`,
      HttpStatus.FORBIDDEN
    );
  }
}

/**
 * The organization has no plan, so nothing entitles it to a metered operation.
 *
 * This is a provisioning fault rather than a quota problem: signup assigns a plan, and every
 * other path that creates an organization inherits one. Reaching this state means something
 * upstream did not complete — which is exactly why the previous behaviour (log a warning and
 * allow the operation) was wrong. An unprovisioned tenant was the one with no limits at all.
 */
export class SaasNoPlanException extends SaasException {
  constructor(organizationId: string) {
    super(
      SaasErrorCode.PLAN_NOT_FOUND,
      organizationId,
      'The organization has no active plan.',
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
