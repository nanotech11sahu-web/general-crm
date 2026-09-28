import { Schema, model, Document, Types } from 'mongoose';
import { MODULES, PERMISSION_ACTIONS, PermissionMap } from '../constants/modules';

export interface IRole extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  isSystem: boolean;
  permissions: PermissionMap;
  createdAt: Date;
  updatedAt: Date;
}

const modulePermissionSchema = new Schema(
  {
    read: { type: Boolean, default: false },
    create: { type: Boolean, default: false },
    edit: { type: Boolean, default: false },
    delete: { type: Boolean, default: false },
  },
  { _id: false },
);

const permissionMapSchema = new Schema(
  Object.fromEntries(MODULES.map((mod) => [mod, { type: modulePermissionSchema, default: () => ({}) }])),
  { _id: false },
);

const roleSchema = new Schema<IRole>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    isSystem: { type: Boolean, default: false },
    permissions: { type: permissionMapSchema, default: () => ({}) },
  },
  { timestamps: true },
);

roleSchema.index({ workspaceId: 1, name: 1 }, { unique: true });

export const Role = model<IRole>('Role', roleSchema);

export { MODULES, PERMISSION_ACTIONS };
