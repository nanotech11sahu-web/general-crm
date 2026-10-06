import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard, PermissionGuard } from './common/guards';
import { TenantContextInterceptor } from './common/tenant-context.interceptor';
import { ConnectionsModule } from './connections/connections.module';
import { DbModule } from '@leaddesk/platform';

@Module({
  imports: [DbModule, AuditModule, AuthModule, ConnectionsModule],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
