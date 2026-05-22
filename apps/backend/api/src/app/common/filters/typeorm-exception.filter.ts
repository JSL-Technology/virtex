
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  Logger,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { QueryFailedError, EntityNotFoundError } from 'typeorm';
import { Response } from 'express';

@Catch(QueryFailedError, EntityNotFoundError)
export class TypeOrmExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(TypeOrmExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
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
        this.logger.error(`Database Error: ${exception.message}`, exception.stack);
      }
    } else if (exception instanceof EntityNotFoundError) {
      status = HttpStatus.NOT_FOUND;
      message = 'Recurso no encontrado';
      code = 'NOT_FOUND';
    } else {
      this.logger.error(`Unexpected Error: ${(exception as any).message}`, (exception as any).stack);
    }

    response.status(status).json({
      statusCode: status,
      message,
      code,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
