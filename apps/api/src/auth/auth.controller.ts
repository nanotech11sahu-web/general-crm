import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthService, Tokens } from './auth.service';
import { CurrentUser, Public, RequirePermission } from '../common/guards';
import type { AuthUser } from '../common/auth.types';

class SignupDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(10) password!: string;
  @IsString() @MinLength(1) name!: string;
  @IsString() @MinLength(2) tenantName!: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() industryPreset?: string;
}
class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
  @IsOptional() @IsString() tenantId?: string;
}
class InviteDto {
  @IsEmail() email!: string;
  @IsIn(['admin', 'manager', 'agent']) role!: 'admin' | 'manager' | 'agent';
  @IsOptional() @IsString() teamId?: string;
}
class AcceptDto {
  @IsString() @MinLength(1) name!: string;
  @IsString() @MinLength(10) password!: string;
}

const COOKIE = 'ld_refresh';
function setRefresh(res: Response, t: Tokens) {
  res.cookie(COOKIE, t.refreshToken, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/v1/auth', maxAge: 30 * 24 * 3600 * 1000 });
  return { accessToken: t.accessToken, tenantId: t.tenantId, role: t.role };
}

@Controller('v1')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @Post('auth/signup')
  async signup(@Body() b: SignupDto, @Res({ passthrough: true }) res: Response) { return setRefresh(res, await this.auth.signup(b)); }

  @Public() @Post('auth/login') @HttpCode(200)
  async login(@Body() b: LoginDto, @Res({ passthrough: true }) res: Response) { return setRefresh(res, await this.auth.login(b)); }

  @Public() @Post('auth/refresh') @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return setRefresh(res, await this.auth.refresh(req.cookies?.[COOKIE]));
  }

  @Public() @Post('auth/logout') @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[COOKIE]);
    res.clearCookie(COOKIE, { path: '/v1/auth' });
  }

  @Get('me')
  me(@CurrentUser() u: AuthUser) { return u; }

  @Post('invitations') @RequirePermission('users.invite')
  invite(@CurrentUser() u: AuthUser, @Body() b: InviteDto) { return this.auth.invite(u, b, u.tenantId); }

  @Public() @Post('invitations/:token/accept')
  async accept(@Param('token') token: string, @Body() b: AcceptDto, @Res({ passthrough: true }) res: Response) {
    return setRefresh(res, await this.auth.acceptInvitation(token, b));
  }
}
