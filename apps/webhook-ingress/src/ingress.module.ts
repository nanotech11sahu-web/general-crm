import { Module } from '@nestjs/common';
import { defaultRegistry } from '@leaddesk/connectors-core';
import { DbModule } from '@leaddesk/platform';
import { HooksController, REGISTRY } from './hooks.controller';
import { createInboxQueue, INBOX_QUEUE } from './inbox-queue';

@Module({
  imports: [DbModule],
  controllers: [HooksController],
  providers: [
    { provide: REGISTRY, useFactory: defaultRegistry },
    { provide: INBOX_QUEUE, useFactory: () => createInboxQueue() },
  ],
})
export class IngressModule {}
