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
    const bodyErrorStatus = typeof exception === 'object' && exception !== null && 'type' in exception
      ? exception.type === 'entity.too.large' ? 413 : exception.type === 'entity.parse.failed' ? 400 : undefined
      : undefined;
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : bodyErrorStatus ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const payload =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const message = status >= 500 ? 'Internal server error' : bodyErrorStatus === 413 ? 'Request body is too large' : bodyErrorStatus === 400 ? 'Invalid JSON body' :
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? (payload as { message: string | string[] }).message
        : 'Internal server error';
    const error = status >= 500 ? 'INTERNAL_SERVER_ERROR' :
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? String((payload as { error: string }).error)
            .toUpperCase()
            .replaceAll(' ', '_')
        : HttpStatus[status];

    response.setHeader('Cache-Control', 'private, no-store');
    response.status(status).json({ statusCode: status, error, message });
  }
}
