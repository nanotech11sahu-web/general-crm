import { Schema, model, Document, Types } from 'mongoose';

export const LOCATION_TYPES = ['zoom', 'google_meet', 'phone', 'in_person'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const ASSIGNMENT_METHODS = ['round_robin', 'all_staff', 'specific'] as const;
export type AssignmentMethod = (typeof ASSIGNMENT_METHODS)[number];

export interface IAvailabilityWindow {
  day: number; // 0=Sunday .. 6=Saturday
  enabled: boolean;
  startTime: string; // "09:00"
  endTime: string; // "17:00"
}

export interface IBookingFormField {
  key: string;
  label: string;
  type: 'text' | 'email' | 'phone' | 'textarea' | 'select';
  required: boolean;
  options?: string[];
}

export interface IEventType extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  description?: string;
  durationMinutes: number;
  locationType: LocationType;
  locationDetails?: string;
  availability: IAvailabilityWindow[];
  timezone: string;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeHours: number;
  dateRangeDays: number;
  staffMembershipIds: Types.ObjectId[];
  assignmentMethod: AssignmentMethod;
  requirePayment: boolean;
  price: number;
  currency: string;
  requireApproval: boolean;
  confirmationMessage?: string;
  bookingFormFields: IBookingFormField[];
  templateKey: string;
  templateCategory: string;
  status: 'draft' | 'published';
  publicId: string;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const availabilityWindowSchema = new Schema<IAvailabilityWindow>(
  {
    day: { type: Number, required: true, min: 0, max: 6 },
    enabled: { type: Boolean, default: false },
    startTime: { type: String, default: '09:00' },
    endTime: { type: String, default: '17:00' },
  },
  { _id: false },
);

const bookingFormFieldSchema = new Schema<IBookingFormField>(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, enum: ['text', 'email', 'phone', 'textarea', 'select'], default: 'text' },
    required: { type: Boolean, default: false },
    options: [{ type: String }],
  },
  { _id: false },
);

function defaultAvailability(): IAvailabilityWindow[] {
  return [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    day,
    enabled: day >= 1 && day <= 5,
    startTime: '09:00',
    endTime: '17:00',
  }));
}

function defaultBookingFields(): IBookingFormField[] {
  return [
    { key: 'name', label: 'Full Name', type: 'text', required: true },
    { key: 'email', label: 'Email', type: 'email', required: true },
    { key: 'phone', label: 'Phone', type: 'phone', required: false },
  ];
}

const eventTypeSchema = new Schema<IEventType>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String },
    durationMinutes: { type: Number, default: 30 },
    locationType: { type: String, enum: LOCATION_TYPES, default: 'zoom' },
    locationDetails: { type: String },
    availability: { type: [availabilityWindowSchema], default: defaultAvailability },
    timezone: { type: String, default: 'Asia/Kolkata' },
    bufferBeforeMinutes: { type: Number, default: 0 },
    bufferAfterMinutes: { type: Number, default: 0 },
    minNoticeHours: { type: Number, default: 1 },
    dateRangeDays: { type: Number, default: 30 },
    staffMembershipIds: [{ type: Schema.Types.ObjectId, ref: 'Membership' }],
    assignmentMethod: { type: String, enum: ASSIGNMENT_METHODS, default: 'round_robin' },
    requirePayment: { type: Boolean, default: false },
    price: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    requireApproval: { type: Boolean, default: false },
    confirmationMessage: { type: String },
    bookingFormFields: { type: [bookingFormFieldSchema], default: defaultBookingFields },
    templateKey: { type: String, default: 'scratch' },
    templateCategory: { type: String, default: 'Custom' },
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    publicId: { type: String, required: true, unique: true },
    archived: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

export const EventType = model<IEventType>('EventType', eventTypeSchema);
