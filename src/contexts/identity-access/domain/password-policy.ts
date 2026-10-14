import { ValidationError } from '@/shared/domain/errors';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

/** Password complexity policy (docs/05, 5.6). */
export function assertStrongPassword(password: string) {
  const problems: string[] = [];
  if (password.length < 8) problems.push('Pelo menos 8 caracteres');
  if (!/[A-Za-z]/.test(password)) problems.push('Pelo menos uma letra');
  if (!/\d/.test(password)) problems.push('Pelo menos um número');
  if (problems.length) throw new ValidationError('Palavra-passe fraca', { password: problems }, 'weak_password');
}
