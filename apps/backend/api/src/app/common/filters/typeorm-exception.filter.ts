
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { QueryFailedError, EntityNotFoundError } from 'typeorm';

@Catch(QueryFailedError, EntityNotFoundError)
export class TypeOrmExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(TypeOrmExceptionFilter.name);

  // Use the platform-agnostic HTTP adapter instead of Express-specific
  // response methods. The app runs on Fastify, where `reply.json()` does not
  // exist; `httpAdapter.reply()` works on both Express and Fastify.
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Error interno del servidor';
    let code = 'INTERNAL_ERROR';

    if (exception instanceof QueryFailedError) {
      const driverError = exception.driverError;
      // PostgreSQL error codes
      if (driverError?.code === '23505') { // Unique violation
        status = HttpStatus.CONFLICT;
        message = 'El registro ya existe (Conflicto de unicidad).';
        code = 'CONFLICT';
      } else if (driverError?.code === '23503') { // Foreign key violation
        status = HttpStatus.BAD_REQUEST;
        message = 'Operación inválida: referencia a entidad no existente.';
        code = 'FOREIGN_KEY_VIOLATION';
      } else {
        // Do not leak internal SQL details to the client; log them server-side.
        this.logger.error(`Database Error: ${exception.message}`, exception.stack);
      }
    } else if (exception instanceof EntityNotFoundError) {
      status = HttpStatus.NOT_FOUND;
      message = 'Recurso no encontrado';
      code = 'NOT_FOUND';
    } else {
      this.logger.error(`Unexpected Error: ${(exception as any).message}`, (exception as any).stack);
    }

    const responseBody = {
      statusCode: status,
      message,
      code,
      timestamp: new Date().toISOString(),
      path: httpAdapter.getRequestUrl(request),
    };

    httpAdapter.reply(ctx.getResponse(), responseBody, status);
  }
}
