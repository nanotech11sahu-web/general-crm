import { EventEmitter } from 'events';

class EventBus extends EventEmitter {}

export const eventBus = new EventBus();
eventBus.setMaxListeners(200);

export type PlatformEvent =
  | 'contact.created'
  | 'contact.updated'
  | 'contact.lifecycleStageChanged'
  | 'contact.stageChanged'
  | 'contact.tagAdded'
  | 'form.submitted'
  | 'calendar.appointmentBooked'
  | 'calendar.appointmentCancelled'
  | 'calendar.appointmentRescheduled'
  | 'calendar.noShow'
  | 'calendar.showUp'
  | 'finance.invoiceCreated'
  | 'finance.invoicePaid'
  | 'finance.invoiceOverdue'
  | 'finance.subscriptionCreated'
  | 'finance.subscriptionPaid'
  | 'finance.subscriptionOverdue'
  | 'finance.subscriptionCancelled'
  | 'finance.installmentCreated'
  | 'finance.installmentPaid'
  | 'finance.installmentOverdue'
  | 'finance.oneTimePayment'
  | 'community.courseAccessGranted'
  | 'community.enrollment'
  | 'inbox.messageReceived';

export interface PlatformEventPayload {
  workspaceId: string;
  contactId?: string;
  [key: string]: unknown;
}

export function emitPlatformEvent(event: PlatformEvent, payload: PlatformEventPayload): void {
  eventBus.emit(event, payload);
}
