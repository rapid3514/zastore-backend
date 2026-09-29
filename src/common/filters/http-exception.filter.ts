import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const message =
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? (payload as { message: string | string[] }).message
        : 'Internal server error';
    const error =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? String((payload as { error: string }).error)
            .toUpperCase()
            .replaceAll(' ', '_')
        : HttpStatus[status];

    response.status(status).json({ statusCode: status, error, message });
  }
}
