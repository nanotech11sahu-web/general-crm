import { Types } from 'mongoose';
import { IForm } from '../models/Form';
import { FormSubmission } from '../models/FormSubmission';
import { Contact } from '../models/Contact';
import { TimelineEvent } from '../models/TimelineEvent';
import { emitPlatformEvent } from '../lib/eventBus';

export interface SubmitFormInput {
  form: IForm;
  data: Record<string, unknown>;
  meta: {
    ip?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    referrer?: string;
    userAgent?: string;
  };
}

function extractString(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export async function submitForm({ form, data, meta }: SubmitFormInput) {
  let contactId: Types.ObjectId | undefined;

  if (form.settings.autoCreateContact && !form.settings.skipContactCreation) {
    const email = extractString(data, ['email', 'Email']);
    const name = extractString(data, ['name', 'Name', 'fullName']) ?? email ?? 'Form Submission';
    const phone = extractString(data, ['phone', 'Phone']);

    let contact = email ? await Contact.findOne({ workspaceId: form.workspaceId, email }) : null;

    if (contact) {
      contact.attributionLatest = {
        source: 'Form',
        medium: meta.utmMedium,
        campaign: meta.utmCampaign,
        date: new Date(),
      };
      await contact.save();
    } else {
      contact = await Contact.create({
        workspaceId: form.workspaceId,
        name,
        email,
        phone,
        source: 'Form',
        lifecycleStage: form.settings.lifecycleStageOnSubmit || 'Lead',
        attributionFirst: { source: 'Form', medium: meta.utmMedium, campaign: meta.utmCampaign, date: new Date() },
        attributionLatest: { source: 'Form', medium: meta.utmMedium, campaign: meta.utmCampaign, date: new Date() },
      });
    }

    contactId = contact._id;

    await TimelineEvent.create({
      workspaceId: form.workspaceId,
      contactId: contact._id,
      type: 'form_submitted',
      message: `Submitted the "${form.name}" form.`,
      meta: { formId: String(form._id) },
    });
  }

  const submission = await FormSubmission.create({
    workspaceId: form.workspaceId,
    formId: form._id,
    contactId,
    data,
    meta,
  });

  emitPlatformEvent('form.submitted', {
    workspaceId: String(form.workspaceId),
    formId: String(form._id),
    contactId: contactId ? String(contactId) : undefined,
  });

  return submission;
}
