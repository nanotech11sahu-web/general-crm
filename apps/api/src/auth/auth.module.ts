import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasskeyService } from './passkeys';

@Module({ imports: [JwtModule.register({})], controllers: [AuthController], providers: [AuthService, PasskeyService], exports: [JwtModule] })
export class AuthModule {}
