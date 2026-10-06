import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule, JwtAuthGuard, PermissionGuard } from './common/guards';
import { UsersModule } from './users/users.module';
import { TenantContextInterceptor } from './common/tenant-context.interceptor';
import { ConnectionsModule } from './connections/connections.module';
import { DbModule } from '@leaddesk/platform';
import { LeadsModule } from './leads/leads.module';
import { ImportsModule } from './imports/imports.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [DbModule, CommonModule, AuditModule, AuthModule, ConnectionsModule, LeadsModule, UsersModule, ImportsModule, NotificationsModule],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
