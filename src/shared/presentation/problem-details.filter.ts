import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';

import { DomainError, ValidationError } from '../domain/errors';

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code?: string;
  errors?: Record<string, string[]>;
  instance?: string;
}

function zodFieldErrors(error: ZodError) {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

/** Every error leaves the API as RFC 9457 Problem Details with a stable `code` (docs/09, 9.12). */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const problem = this.toProblem(exception);
    problem.instance = request.originalUrl;

    if (problem.status >= 500) this.logger.error(exception instanceof Error ? exception.stack : exception);

    response.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof ValidationError) {
      return { type: 'about:blank', title: 'Dados inválidos', status: exception.status, detail: exception.message, code: exception.code, errors: exception.fieldErrors };
    }
    if (exception instanceof DomainError) {
      return { type: 'about:blank', title: exception.message, status: exception.status, detail: exception.message, code: exception.code };
    }
    if (exception instanceof ZodValidationException) {
      const error = exception.getZodError();
      return {
        type: 'about:blank',
        title: 'Dados inválidos',
        status: HttpStatus.BAD_REQUEST,
        detail: 'Verifique os campos assinalados',
        code: 'validation_failed',
        errors: error instanceof ZodError ? zodFieldErrors(error) : undefined,
      };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') return { type: 'about:blank', title: 'Registo duplicado', status: 409, detail: `Já existe um registo com ${String(exception.meta?.target ?? 'estes dados')}`, code: 'duplicate' };
      if (exception.code === 'P2025') return { type: 'about:blank', title: 'Registo não encontrado', status: 404, code: 'not_found' };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const detail = typeof body === 'string' ? body : ((body as { message?: string | string[] }).message?.toString() ?? exception.message);
      return { type: 'about:blank', title: exception.message, status, detail, code: status === 429 ? 'rate_limited' : `http_${status}` };
    }
    return { type: 'about:blank', title: 'Erro interno', status: 500, detail: 'Ocorreu um erro inesperado. Tente novamente.', code: 'internal_error' };
  }
}
