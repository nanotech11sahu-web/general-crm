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
import { OAuthModule } from './oauth/oauth.module';
import { DoModule } from './do/do.module';
import { RoutingModule } from './routing/routing.module';
import { RealtimeModule } from './realtime/realtime.module';
import { MessagingModule } from './messaging/messaging.module';
import { CadencesModule } from './cadences/cadences.module';
import { PulseModule } from './pulse/pulse.module';
import { AiModule } from './ai/ai.module';
import { OpsModule } from './ops/ops.module';
import { PrivacyModule } from './privacy/privacy.module';
import { BillingModule, SubscriptionGuard } from './billing/billing.module';
import { PlatformModule } from './platform/platform.module';
import { HardeningModule, RateLimitGuard } from './hardening/hardening.module';

@Module({
  imports: [DbModule, HardeningModule, CommonModule, AuditModule, AuthModule, ConnectionsModule, LeadsModule, UsersModule, ImportsModule, NotificationsModule, OAuthModule, DoModule, RoutingModule, RealtimeModule, MessagingModule, CadencesModule, PulseModule, AiModule, OpsModule, PrivacyModule, BillingModule, PlatformModule],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: SubscriptionGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
