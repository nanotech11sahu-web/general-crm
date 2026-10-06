import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthService, Tokens } from './auth.service';
import { CurrentUser, Public, RequirePermission } from '../common/guards';
import { REFRESH_COOKIE } from '../common/constants';
import { RateLimit } from '../hardening/hardening.module';
import { AllowRestricted } from '../billing/billing.module';
import type { AuthUser } from '../common/auth.types';

class SignupDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(10) @MaxLength(128) password!: string;
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsString() @MinLength(2) @MaxLength(120) tenantName!: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() industryPreset?: string;
}
class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MaxLength(128) password!: string;
  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @IsString() @MaxLength(40) totp?: string;
}
class CodeDto { @IsString() @MinLength(6) @MaxLength(40) code!: string }
class DisableDto { @IsString() @MaxLength(128) password!: string; @IsString() @MinLength(6) @MaxLength(40) code!: string }
class PasswordDto { @IsString() @MaxLength(128) current!: string; @IsString() @MinLength(10) @MaxLength(128) next!: string }
class InviteDto {
  @IsEmail() email!: string;
  @IsIn(['admin', 'manager', 'agent']) role!: 'admin' | 'manager' | 'agent';
  @IsOptional() @IsString() teamId?: string;
}
class ForgotDto { @IsEmail() @MaxLength(254) email!: string }
class ResetDto { @IsString() @MinLength(20) @MaxLength(200) token!: string; @IsString() @MinLength(10) @MaxLength(128) password!: string }
class EmailPrefsDto { @IsOptional() @IsBoolean() alerts?: boolean; @IsOptional() @IsBoolean() digest?: boolean }
class AcceptDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsString() @MinLength(10) @MaxLength(128) password!: string;
}

const COOKIE = REFRESH_COOKIE;
function setRefresh(res: Response, t: Tokens) {
  res.cookie(COOKIE, t.refreshToken, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/v1/auth', maxAge: 30 * 24 * 3600 * 1000 });
  return { accessToken: t.accessToken, tenantId: t.tenantId, role: t.role };
}

@Controller('v1')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @RateLimit('signup') @Post('auth/signup')
  async signup(@Body() b: SignupDto, @Res({ passthrough: true }) res: Response) { return setRefresh(res, await this.auth.signup(b)); }

  @Public() @RateLimit('login') @Post('auth/login') @HttpCode(200)
  async login(@Body() b: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) { return setRefresh(res, await this.auth.login(b, req.ip)); }

  @Public() @RateLimit('forgot') @Post('auth/forgot') @HttpCode(200)
  forgot(@Body() b: ForgotDto, @Req() req: Request) { return this.auth.forgotPassword(b.email, req.ip); }

  @Public() @RateLimit('reset') @Post('auth/reset') @HttpCode(200)
  reset(@Body() b: ResetDto) { return this.auth.resetPassword(b.token, b.password); }

  @AllowRestricted() @Get('me/email-preferences') emailPrefs(@CurrentUser() u: AuthUser) { return this.auth.emailPrefs(u.userId); }
  @AllowRestricted() @Post('me/email-preferences') @HttpCode(200) setEmailPrefs(@CurrentUser() u: AuthUser, @Body() b: EmailPrefsDto) { return this.auth.setEmailPrefs(u.userId, b); }

  @Public() @RateLimit('refresh') @Post('auth/refresh') @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return setRefresh(res, await this.auth.refresh(req.cookies?.[COOKIE]));
  }

  @Public() @Post('auth/logout') @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[COOKIE]);
    res.clearCookie(COOKIE, { path: '/v1/auth' });
  }

  /** Two-factor (TOTP). Setup returns the secret once; enabling needs a valid code and returns single-use recovery codes. */
  @AllowRestricted() @Post('auth/2fa/setup') totpSetup(@CurrentUser() u: AuthUser) { return this.auth.totpSetup(u.userId); }
  @AllowRestricted() @Post('auth/2fa/enable') totpEnable(@CurrentUser() u: AuthUser, @Body() b: CodeDto) { return this.auth.totpEnable(u.userId, b.code); }
  @AllowRestricted() @Post('auth/2fa/disable') @HttpCode(200) totpDisable(@CurrentUser() u: AuthUser, @Body() b: DisableDto) { return this.auth.totpDisable(u.userId, b.password, b.code); }
  @AllowRestricted() @Post('auth/logout-all') @HttpCode(200) async logoutAll(@CurrentUser() u: AuthUser, @Res({ passthrough: true }) res: Response) { const r = await this.auth.logoutAll(u.userId); res.clearCookie(COOKIE, { path: '/v1/auth' }); return r; }
  @AllowRestricted() @Post('auth/password') @HttpCode(200) async password(@CurrentUser() u: AuthUser, @Body() b: PasswordDto, @Res({ passthrough: true }) res: Response) { const r = await this.auth.changePassword(u.userId, b.current, b.next); res.clearCookie(COOKIE, { path: '/v1/auth' }); return r; }

  @Get('me')
  me(@CurrentUser() u: AuthUser) { return u; }

  @Post('invitations') @RequirePermission('users.invite')
  invite(@CurrentUser() u: AuthUser, @Body() b: InviteDto) { return this.auth.invite(u, b, u.tenantId); }

  @Public() @RateLimit('accept') @Post('invitations/:token/accept')
  async accept(@Param('token') token: string, @Body() b: AcceptDto, @Res({ passthrough: true }) res: Response) {
    return setRefresh(res, await this.auth.acceptInvitation(token, b));
  }
}
