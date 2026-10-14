import type { Role } from '@prisma/client';

import { ForbiddenError } from '../domain/errors';

/** Granular permissions (docs/05, 5.3). Roles are bundles of these. */
export const PERMISSIONS = [
  'organization.read',
  'organization.write',
  'employees.read',
  'employees.write',
  'employees.sensitive',
  'team.read',
  'contracts.read',
  'contracts.write',
  'contracts.approve',
  'attendance.read',
  'attendance.write',
  'attendance.approve',
  'leave.read',
  'leave.write',
  'leave.approve',
  'overtime.read',
  'overtime.write',
  'overtime.approve',
  'payroll.read',
  'payroll.inputs',
  'payroll.calculate',
  'payroll.approve',
  'payroll.close',
  'payments.read',
  'payments.prepare',
  'payments.approve',
  'compensation.read',
  'compensation.write',
  'compensation.approve',
  'tax.read',
  'tax.write',
  'performance.read',
  'performance.write',
  'training.read',
  'training.write',
  'recruitment.read',
  'recruitment.write',
  'disciplinary.read',
  'disciplinary.write',
  'safety.read',
  'safety.write',
  'invoices.read',
  'invoices.write',
  'invoices.approve',
  'communication.publish',
  'reports.read',
  'settings.read',
  'settings.write',
  'users.manage',
  'audit.read',
  'approvals.decide',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const all = (prefix: string) => PERMISSIONS.filter((permission) => permission.startsWith(prefix));
const reads = PERMISSIONS.filter((permission) => permission.endsWith('.read'));

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ACCOUNT_ADMIN: [...reads.filter((p) => p !== 'disciplinary.read'), 'organization.write', 'settings.write', 'users.manage', 'communication.publish'],
  HR_MANAGER: [
    ...reads,
    'organization.write',
    ...all('employees.'),
    ...all('contracts.'),
    ...all('attendance.'),
    ...all('leave.'),
    ...all('overtime.'),
    'payroll.inputs',
    ...all('compensation.'),
    ...all('performance.'),
    ...all('training.'),
    ...all('recruitment.'),
    ...all('disciplinary.'),
    ...all('safety.'),
    'communication.publish',
    'settings.write',
    'approvals.decide',
  ],
  HR_TECHNICIAN: [
    'organization.read',
    'employees.read',
    'employees.write',
    'contracts.read',
    'contracts.write',
    ...all('attendance.'),
    'leave.read',
    'leave.write',
    'overtime.read',
    'overtime.write',
    'performance.read',
    'training.read',
    'training.write',
    'safety.read',
    'safety.write',
    'reports.read',
    'approvals.decide',
  ],
  PAYROLL_PROCESSOR: [
    'organization.read',
    'employees.read',
    'employees.sensitive',
    'contracts.read',
    'attendance.read',
    'leave.read',
    'overtime.read',
    'payroll.read',
    'payroll.inputs',
    'payroll.calculate',
    'payments.read',
    'payments.prepare',
    'compensation.read',
    'compensation.write',
    'tax.read',
    'tax.write',
    'invoices.read',
    'invoices.write',
    'reports.read',
    'settings.read',
  ],
  FINANCIAL_APPROVER: [
    'organization.read',
    'employees.read',
    'employees.sensitive',
    'contracts.read',
    'payroll.read',
    'payroll.approve',
    'payroll.close',
    'payments.read',
    'payments.approve',
    'compensation.read',
    'compensation.approve',
    'tax.read',
    'invoices.read',
    'invoices.approve',
    'reports.read',
    'approvals.decide',
  ],
  LINE_MANAGER: ['organization.read', 'team.read', 'attendance.approve', 'leave.approve', 'overtime.approve', 'performance.read', 'performance.write', 'reports.read', 'approvals.decide'],
  RECRUITER: ['organization.read', ...all('recruitment.')],
  EMPLOYEE: [],
  AUDITOR: ['organization.read', 'employees.read', 'contracts.read', 'attendance.read', 'leave.read', 'overtime.read', 'payroll.read', 'payments.read', 'tax.read', 'reports.read', 'settings.read', 'audit.read'],
};

export function permissionsFor(roles: readonly Role[]): Set<Permission> {
  return new Set(roles.flatMap((role) => ROLE_PERMISSIONS[role]));
}

export interface Actor {
  userId: string;
  tenantId: string;
  companyId: string;
  employeeId: string | null;
  name: string;
  roles: Role[];
  permissions: Set<Permission>;
  ip?: string;
  userAgent?: string;
}

/** Authorization always happens in the use case (docs/09, 9.6 rule 5). */
export function authorize(actor: Actor, permission: Permission) {
  if (!actor.permissions.has(permission)) {
    throw new ForbiddenError(`Falta a permissão ${permission}`, 'missing_permission');
  }
}

export function can(actor: Actor, permission: Permission) {
  return actor.permissions.has(permission);
}
