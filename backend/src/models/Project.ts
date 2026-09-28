import { Schema, model, Document, Types } from 'mongoose';

export const PROJECT_STATUSES = ['Pending', 'In Progress', 'Review', 'Completed', 'Blocked'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const;
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number];

export interface IProject extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  title: string;
  description?: string;
  contactId?: Types.ObjectId;
  status: ProjectStatus;
  priority: ProjectPriority;
  category?: string;
  assigneeId?: Types.ObjectId;
  deadline?: Date;
  dueTime?: string;
  tagIds: Types.ObjectId[];
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const projectSchema = new Schema<IProject>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', index: true },
    status: { type: String, enum: PROJECT_STATUSES, default: 'Pending' },
    priority: { type: String, enum: PROJECT_PRIORITIES, default: 'Medium' },
    category: { type: String, trim: true },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User' },
    deadline: { type: Date },
    dueTime: { type: String },
    tagIds: [{ type: Schema.Types.ObjectId, ref: 'Tag' }],
    archived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

projectSchema.index({ workspaceId: 1, status: 1, archived: 1 });

export const Project = model<IProject>('Project', projectSchema);
