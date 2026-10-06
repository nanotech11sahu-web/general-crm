import { Module } from '@nestjs/common';
import { createRegistry } from '@leaddesk/connectors';
import { DbModule } from '@leaddesk/platform';
import { HooksController, MetaHooksController, REGISTRY } from './hooks.controller';
import { createInboxQueue, INBOX_QUEUE } from './inbox-queue';

@Module({
  imports: [DbModule],
  controllers: [MetaHooksController, HooksController],
  providers: [
    { provide: REGISTRY, useFactory: () => createRegistry(process.env) },
    { provide: INBOX_QUEUE, useFactory: () => createInboxQueue() },
  ],
})
export class IngressModule {}
