export interface CalendarTemplateDefinition {
  key: string;
  name: string;
  category: string;
  durationMinutes: number;
  serviceCount: number;
  badge: string;
}

export const CALENDAR_TEMPLATE_CATEGORIES = [
  'Appointments & Services',
  'Group & Batch',
  'Hospitality',
  'Reservations',
  'Events & Ticketing',
  'Travel & Tourism',
  'Custom',
] as const;

/**
 * Data-driven template gallery. Every entry (aside from "Custom") is selectable
 * and pre-fills the same 6-step scratch wizard with category-appropriate defaults,
 * per the build spec's instruction to model the gallery as a JSON catalog even
 * where templates "reuse the scratch flow underneath."
 */
export const CALENDAR_TEMPLATE_CATALOG: CalendarTemplateDefinition[] = [
  // Appointments & Services (10)
  { key: 'consultation', name: '1:1 Consultation', category: 'Appointments & Services', durationMinutes: 30, serviceCount: 1, badge: '1:1' },
  { key: 'sales-call', name: 'Sales Discovery Call', category: 'Appointments & Services', durationMinutes: 30, serviceCount: 1, badge: '1:1' },
  { key: 'strategy-session', name: 'Strategy Session', category: 'Appointments & Services', durationMinutes: 60, serviceCount: 1, badge: '1:1' },
  { key: 'haircut', name: 'Salon Appointment', category: 'Appointments & Services', durationMinutes: 45, serviceCount: 3, badge: 'Service' },
  { key: 'dental-checkup', name: 'Dental Checkup', category: 'Appointments & Services', durationMinutes: 30, serviceCount: 2, badge: 'Service' },
  { key: 'physio-session', name: 'Physiotherapy Session', category: 'Appointments & Services', durationMinutes: 45, serviceCount: 2, badge: 'Service' },
  { key: 'legal-consult', name: 'Legal Consultation', category: 'Appointments & Services', durationMinutes: 45, serviceCount: 1, badge: '1:1' },
  { key: 'coaching-session', name: 'Coaching Session', category: 'Appointments & Services', durationMinutes: 60, serviceCount: 1, badge: '1:1' },
  { key: 'tax-filing', name: 'Tax Filing Appointment', category: 'Appointments & Services', durationMinutes: 30, serviceCount: 1, badge: '1:1' },
  { key: 'home-repair', name: 'Home Repair Visit', category: 'Appointments & Services', durationMinutes: 90, serviceCount: 4, badge: 'Service' },

  // Group & Batch (3)
  { key: 'group-class', name: 'Group Fitness Class', category: 'Group & Batch', durationMinutes: 60, serviceCount: 1, badge: 'Group' },
  { key: 'webinar-batch', name: 'Cohort Onboarding Batch', category: 'Group & Batch', durationMinutes: 90, serviceCount: 1, badge: 'Batch' },
  { key: 'workshop', name: 'Live Workshop', category: 'Group & Batch', durationMinutes: 120, serviceCount: 1, badge: 'Group' },

  // Hospitality (2)
  { key: 'table-booking', name: 'Restaurant Table Booking', category: 'Hospitality', durationMinutes: 90, serviceCount: 1, badge: 'Booking' },
  { key: 'spa-slot', name: 'Spa Slot Booking', category: 'Hospitality', durationMinutes: 60, serviceCount: 3, badge: 'Booking' },

  // Reservations (1)
  { key: 'room-reservation', name: 'Meeting Room Reservation', category: 'Reservations', durationMinutes: 60, serviceCount: 1, badge: 'Reservation' },

  // Events & Ticketing (5)
  { key: 'conference-ticket', name: 'Conference Ticketing', category: 'Events & Ticketing', durationMinutes: 480, serviceCount: 1, badge: 'Event' },
  { key: 'concert-ticket', name: 'Concert Ticketing', category: 'Events & Ticketing', durationMinutes: 180, serviceCount: 1, badge: 'Event' },
  { key: 'meetup', name: 'Community Meetup', category: 'Events & Ticketing', durationMinutes: 120, serviceCount: 1, badge: 'Event' },
  { key: 'expo-booth', name: 'Expo Booth Slot', category: 'Events & Ticketing', durationMinutes: 240, serviceCount: 1, badge: 'Event' },
  { key: 'product-launch', name: 'Product Launch Event', category: 'Events & Ticketing', durationMinutes: 90, serviceCount: 1, badge: 'Event' },

  // Travel & Tourism (2)
  { key: 'guided-tour', name: 'Guided Tour Booking', category: 'Travel & Tourism', durationMinutes: 180, serviceCount: 1, badge: 'Tour' },
  { key: 'car-rental', name: 'Car Rental Slot', category: 'Travel & Tourism', durationMinutes: 30, serviceCount: 1, badge: 'Rental' },

  // Custom (1 — the scratch flow itself)
  { key: 'scratch', name: 'Build From Scratch', category: 'Custom', durationMinutes: 30, serviceCount: 1, badge: 'Custom' },
];
