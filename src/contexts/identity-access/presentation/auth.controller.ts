import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { Public } from '@/shared/presentation/decorators';

import {
  EnableTwoFactorUseCase,
  ForgotPasswordUseCase,
  GetSessionUseCase,
  LoginUseCase,
  LogoutUseCase,
  RefreshSessionUseCase,
  RegisterAccountUseCase,
  RequestLoginCodeUseCase,
  ResetPasswordUseCase,
  SetupTwoFactorUseCase,
  VerifyLoginCodeUseCase,
  VerifyTwoFactorLoginUseCase,
} from '../application/auth.use-cases';
import { AcceptInvitationUseCase } from '../application/users.use-cases';
import {
  AcceptInvitationDto,
  ForgotPasswordDto,
  LoginDto,
  LoginResponseDto,
  OtpRequestDto,
  OtpVerifyDto,
  RegisterDto,
  ResetPasswordDto,
  SessionUserDto,
  TwoFactorCodeDto,
  TwoFactorSetupDto,
  TwoFactorVerifyDto,
} from './dto';
import { REFRESH_COOKIE, SessionCookies } from './session-cookies';

const info = (request: Request) => ({ ip: request.ip, userAgent: request.headers['user-agent'] });
const STRICT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly cookies: SessionCookies,
    private readonly registerAccount: RegisterAccountUseCase,
    private readonly login: LoginUseCase,
    private readonly verifyTwoFactorLogin: VerifyTwoFactorLoginUseCase,
    private readonly refreshSession: RefreshSessionUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly getSession: GetSessionUseCase,
    private readonly requestLoginCode: RequestLoginCodeUseCase,
    private readonly verifyLoginCode: VerifyLoginCodeUseCase,
    private readonly setupTwoFactor: SetupTwoFactorUseCase,
    private readonly enableTwoFactor: EnableTwoFactorUseCase,
    private readonly forgotPassword: ForgotPasswordUseCase,
    private readonly resetPassword: ResetPasswordUseCase,
    private readonly acceptInvitation: AcceptInvitationUseCase,
  ) {}

  @Public()
  @Throttle(STRICT)
  @Post('register')
  @ApiOperation({ summary: 'Criar conta', description: 'Cria a conta, a empresa, o utilizador responsável, as rubricas e os fluxos por omissão, e inicia a sessão.' })
  @ApiCreatedResponse({ type: LoginResponseDto })
  async register(@Body() body: RegisterDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const session = await this.registerAccount.execute(body, info(request));
    this.cookies.set(response, session);
    return { user: session.user, requiresTwoFactor: false };
  }

  @Public()
  @Throttle(STRICT)
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Entrar com e-mail e palavra-passe', description: 'Bloqueia a conta 15 minutos após 5 tentativas falhadas. Com 2FA activo devolve `challengeToken`.' })
  @ApiOkResponse({ type: LoginResponseDto })
  async signIn(@Body() body: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.login.execute(body, info(request));
    if (result.kind === 'two-factor') return { user: null, requiresTwoFactor: true, challengeToken: result.challengeToken };
    this.cookies.set(response, result.session);
    return { user: result.session.user, requiresTwoFactor: false };
  }

  @Public()
  @Throttle(STRICT)
  @Post('2fa/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Concluir a entrada com o código 2FA' })
  @ApiOkResponse({ type: LoginResponseDto })
  async verifyTwoFactor(@Body() body: TwoFactorVerifyDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const session = await this.verifyTwoFactorLogin.execute(body, info(request));
    this.cookies.set(response, session);
    return { user: session.user, requiresTwoFactor: false };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Renovar a sessão', description: 'Usa o cookie `refresh_token` (rotativo). Reutilizar um token já usado termina todas as sessões do utilizador.' })
  @ApiOkResponse({ type: SessionUserDto })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    try {
      const session = await this.refreshSession.execute((request.cookies as Record<string, string>)[REFRESH_COOKIE], info(request));
      this.cookies.set(response, session);
      return session.user;
    } catch (error) {
      // A dead session must not leave the session marker behind, or the web app would keep
      // treating the browser as signed in and bounce between /login and the dashboard.
      this.cookies.clear(response);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Terminar sessão' })
  @ApiNoContentResponse()
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.logoutUseCase.execute((request.cookies as Record<string, string>)[REFRESH_COOKIE]);
    this.cookies.clear(response);
  }

  @Get('me')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Utilizador da sessão actual' })
  @ApiOkResponse({ type: SessionUserDto })
  me() {
    return this.getSession.execute();
  }

  @Public()
  @Throttle(STRICT)
  @Post('otp/request')
  @HttpCode(204)
  @ApiOperation({ summary: 'Pedir código de acesso por SMS', description: 'Para trabalhadores sem e-mail. Responde sempre 204, para não revelar se o número existe.' })
  @ApiNoContentResponse()
  async requestOtp(@Body() body: OtpRequestDto) {
    await this.requestLoginCode.execute(body.phone);
  }

  @Public()
  @Throttle(STRICT)
  @Post('otp/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Entrar com o código recebido por SMS' })
  @ApiOkResponse({ type: LoginResponseDto })
  async verifyOtp(@Body() body: OtpVerifyDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const session = await this.verifyLoginCode.execute(body, info(request));
    this.cookies.set(response, session);
    return { user: session.user, requiresTwoFactor: false };
  }

  @Post('2fa/setup')
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Configurar autenticação de dois factores (TOTP)' })
  @ApiOkResponse({ type: TwoFactorSetupDto })
  setup2fa() {
    return this.setupTwoFactor.execute();
  }

  @Post('2fa/enable')
  @HttpCode(204)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Activar 2FA confirmando um código da aplicação autenticadora' })
  @ApiNoContentResponse()
  async enable2fa(@Body() body: TwoFactorCodeDto) {
    await this.enableTwoFactor.execute(body.code);
  }

  @Public()
  @Throttle(STRICT)
  @Post('password/forgot')
  @HttpCode(204)
  @ApiOperation({ summary: 'Pedir redefinição da palavra-passe', description: 'Envia uma ligação por e-mail (válida 30 min). Responde sempre 204.' })
  @ApiNoContentResponse()
  async forgot(@Body() body: ForgotPasswordDto) {
    await this.forgotPassword.execute(body.email);
  }

  @Public()
  @Throttle(STRICT)
  @Post('password/reset')
  @HttpCode(204)
  @ApiOperation({ summary: 'Definir nova palavra-passe', description: 'Termina todas as sessões abertas do utilizador.' })
  @ApiNoContentResponse()
  async reset(@Body() body: ResetPasswordDto) {
    await this.resetPassword.execute(body);
  }

  @Public()
  @Throttle(STRICT)
  @Post('invitations/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Aceitar convite', description: 'Cria o utilizador (se ainda não existir) e inicia a sessão.' })
  @ApiOkResponse({ type: LoginResponseDto })
  async accept(@Body() body: AcceptInvitationDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const session = await this.acceptInvitation.execute(body, info(request));
    this.cookies.set(response, session);
    return { user: session.user, requiresTwoFactor: false };
  }
}
