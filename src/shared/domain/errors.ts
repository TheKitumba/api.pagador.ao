/**
 * Domain errors. The presentation layer maps them to RFC 9457 Problem Details;
 * `code` is stable so the frontend can translate it.
 */
export abstract class DomainError extends Error {
  abstract readonly status: number;
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  readonly status = 404;
  constructor(entity: string, id?: string) {
    super(id ? `${entity} ${id} não encontrado(a)` : `${entity} não encontrado(a)`, 'not_found');
  }
}

export class ForbiddenError extends DomainError {
  readonly status = 403;
  constructor(message = 'Não tem permissão para esta operação', code = 'forbidden') {
    super(message, code);
  }
}

export class UnauthorizedError extends DomainError {
  readonly status = 401;
  constructor(message = 'Sessão inválida ou expirada', code = 'unauthorized') {
    super(message, code);
  }
}

export class ValidationError extends DomainError {
  readonly status = 422;
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string[]> = {},
    code = 'validation_failed',
  ) {
    super(message, code);
  }
}

export class BusinessRuleViolation extends DomainError {
  readonly status = 409;
  constructor(message: string, code: string) {
    super(message, code);
  }
}

export class ConflictError extends DomainError {
  readonly status = 409;
  constructor(message: string, code = 'conflict') {
    super(message, code);
  }
}
