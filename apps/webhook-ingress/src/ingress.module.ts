import { Module } from '@nestjs/common';
import { createRegistry } from '@leaddesk/connectors';
import { paymentProviderFromEnv } from '@leaddesk/domain';
import { DbModule } from '@leaddesk/platform';
import { BillingHooksController, HealthController, HooksController, MetaHooksController, PAYMENT_PROVIDER, REGISTRY, WhatsAppHooksController } from './hooks.controller';
import { createInboxQueue, INBOX_QUEUE } from './inbox-queue';

@Module({
  imports: [DbModule],
  controllers: [HealthController, BillingHooksController, MetaHooksController, WhatsAppHooksController, HooksController],
  providers: [
    { provide: REGISTRY, useFactory: () => createRegistry(process.env) },
    { provide: PAYMENT_PROVIDER, useFactory: () => paymentProviderFromEnv(process.env) },
    { provide: INBOX_QUEUE, useFactory: () => createInboxQueue() },
  ],
})
export class IngressModule {}
