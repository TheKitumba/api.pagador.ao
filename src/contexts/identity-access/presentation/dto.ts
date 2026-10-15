import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { timestamp } from '@/shared/presentation/zod';

const role = z.enum(['ACCOUNT_ADMIN', 'HR_MANAGER', 'HR_TECHNICIAN', 'PAYROLL_PROCESSOR', 'FINANCIAL_APPROVER', 'LINE_MANAGER', 'RECRUITER', 'EMPLOYEE', 'AUDITOR']);

export const sessionUserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  tenantId: z.uuid(),
  companyId: z.uuid().nullable(),
  employeeId: z.uuid().nullable(),
  roles: z.array(role),
  permissions: z.array(z.string()).describe('Permissões efectivas (para mostrar/ocultar acções na interface)'),
  twoFactorEnabled: z.boolean(),
});

export class SessionUserDto extends createZodDto(sessionUserSchema) {}

export class RegisterDto extends createZodDto(
  z.object({
    name: z.string().trim().min(3).describe('Nome do responsável'),
    email: z.email(),
    password: z.string().min(8),
    company: z.object({
      name: z.string().trim().min(2).describe('Denominação social'),
      nif: z.string().regex(/^\d{10}$/).describe('NIF da empresa (10 dígitos)'),
      size: z.string().describe('Dimensão, ex.: "11–50 trabalhadores"'),
      province: z.string().describe('Província da sede'),
    }),
  }),
) {}

export class LoginDto extends createZodDto(
  z.object({
    email: z.email(),
    password: z.string().min(1),
    tenantId: z.uuid().optional().describe('Conta a abrir, quando o utilizador pertence a várias'),
  }),
) {}

export class LoginResponseDto extends createZodDto(
  z.object({
    user: sessionUserSchema.nullable(),
    requiresTwoFactor: z.boolean(),
    challengeToken: z.string().optional().describe('Enviar com o código em POST /v1/auth/2fa/verify'),
  }),
) {}

export class TwoFactorVerifyDto extends createZodDto(z.object({ challengeToken: z.string(), code: z.string().regex(/^\d{6}$/) })) {}
export class TwoFactorCodeDto extends createZodDto(z.object({ code: z.string().regex(/^\d{6}$/) })) {}
export class TwoFactorSetupDto extends createZodDto(z.object({ secret: z.string(), otpauthUrl: z.string().describe('Mostrar como QR code na aplicação autenticadora') })) {}

export class OtpRequestDto extends createZodDto(z.object({ phone: z.string().describe('+244 9XX XXX XXX') })) {}
export class OtpVerifyDto extends createZodDto(z.object({ phone: z.string(), code: z.string().regex(/^\d{6}$/) })) {}

export class ForgotPasswordDto extends createZodDto(z.object({ email: z.email() })) {}
export class ResetPasswordDto extends createZodDto(z.object({ token: z.string().min(10), password: z.string().min(8) })) {}

export class InviteUserDto extends createZodDto(z.object({ email: z.email(), roles: z.array(role).min(1) })) {}
export class AcceptInvitationDto extends createZodDto(z.object({ token: z.string().min(10), name: z.string().trim().min(3), password: z.string().min(8) })) {}
export class ChangeRolesDto extends createZodDto(z.object({ roles: z.array(role).min(1), employeeId: z.uuid().nullable().optional().describe('Ligação ao trabalhador (portal)') })) {}
export class UserIdParam extends createZodDto(z.object({ userId: z.uuid() })) {}

export class UsersResponseDto extends createZodDto(
  z.object({
    users: z.array(
      z.object({
        userId: z.uuid(),
        name: z.string(),
        email: z.string().nullable(),
        phone: z.string().nullable(),
        roles: z.array(role),
        employeeId: z.uuid().nullable(),
        twoFactorEnabled: z.boolean(),
        lastLoginAt: timestamp.nullable(),
        expiresAt: timestamp.nullable(),
      }),
    ),
    pendingInvitations: z.array(z.object({ id: z.uuid(), email: z.string(), roles: z.array(role), expiresAt: timestamp })),
  }),
  { codec: true },
) {}

export class RolesResponseDto extends createZodDto(z.array(z.object({ role, permissions: z.array(z.string()) }))) {}
