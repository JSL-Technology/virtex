import { HttpException, HttpStatus } from '@nestjs/common';
import { SaasResource } from '../enums/saas-resource.enum';

export enum SaasErrorCode {
  LIMIT_REACHED = 'SAAS_LIMIT_REACHED',
  FEATURE_NOT_ENABLED = 'SAAS_FEATURE_NOT_ENABLED',
  ORGANIZATION_NOT_FOUND = 'SAAS_ORGANIZATION_NOT_FOUND',
  PLAN_NOT_FOUND = 'SAAS_PLAN_NOT_FOUND',
}

export class SaasException extends HttpException {
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
