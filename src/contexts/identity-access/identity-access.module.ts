import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { ApprovalsModule } from '../approvals/approvals.module';
import { OrganizationModule } from '../organization/organization.module';
import { PayrollModule } from '../payroll/payroll.module';
import * as auth from './application/auth.use-cases';
import { SessionIssuer } from './application/session-issuer';
import * as users from './application/users.use-cases';
import { PasswordHasher } from './infrastructure/credentials';
import { TokenService } from './infrastructure/token.service';
import { AuthController } from './presentation/auth.controller';
import { SessionCookies } from './presentation/session-cookies';
import { UsersController } from './presentation/users.controller';

@Module({
  imports: [JwtModule.register({}), OrganizationModule, PayrollModule, ApprovalsModule],
  controllers: [AuthController, UsersController],
  providers: [
    PasswordHasher,
    TokenService,
    SessionIssuer,
    SessionCookies,
    auth.RegisterAccountUseCase,
    auth.LoginUseCase,
    auth.VerifyTwoFactorLoginUseCase,
    auth.RefreshSessionUseCase,
    auth.LogoutUseCase,
    auth.GetSessionUseCase,
    auth.RequestLoginCodeUseCase,
    auth.VerifyLoginCodeUseCase,
    auth.SetupTwoFactorUseCase,
    auth.EnableTwoFactorUseCase,
    auth.ForgotPasswordUseCase,
    auth.ResetPasswordUseCase,
    users.ListUsersQuery,
    users.InviteUserUseCase,
    users.AcceptInvitationUseCase,
    users.ChangeUserRolesUseCase,
    users.RemoveUserAccessUseCase,
  ],
  exports: [PasswordHasher],
})
export class IdentityAccessModule {}
