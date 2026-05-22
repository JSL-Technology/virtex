import { HttpException, HttpStatus } from '@nestjs/common';
import { AuthError } from '../enums/auth-error.enum';

export interface AuthExceptionPayload {
  message: AuthError | string;
  error: string;
  statusCode: number;
  meta?: Record<string, any>;
}

export class AuthException extends HttpException {
  constructor(
    message: AuthError | string,
    status: HttpStatus = HttpStatus.UNAUTHORIZED,
    meta?: Record<string, any>
  ) {
    const errorResponse: AuthExceptionPayload = {
      message,
      error: HttpStatus[status],
      statusCode: status,
      ...(meta && { meta }),
    };
    super(errorResponse, status);
  }
}
