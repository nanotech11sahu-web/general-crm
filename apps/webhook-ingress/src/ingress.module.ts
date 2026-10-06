import { Module } from '@nestjs/common';
import { createRegistry } from '@leaddesk/connectors';
import { DbModule } from '@leaddesk/platform';
import { HealthController, HooksController, MetaHooksController, REGISTRY, WhatsAppHooksController } from './hooks.controller';
import { createInboxQueue, INBOX_QUEUE } from './inbox-queue';

@Module({
  imports: [DbModule],
  controllers: [HealthController, MetaHooksController, WhatsAppHooksController, HooksController],
  providers: [
    { provide: REGISTRY, useFactory: () => createRegistry(process.env) },
    { provide: INBOX_QUEUE, useFactory: () => createInboxQueue() },
  ],
})
export class IngressModule {}
