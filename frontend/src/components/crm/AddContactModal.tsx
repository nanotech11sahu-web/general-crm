import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { createContact } from '../../lib/api/contacts';
import { toast } from '../../stores/toastStore';

interface AddContactModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
}

export function AddContactModal({ open, onClose, onCreated }: AddContactModalProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', city: '' });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => createContact(form),
    onSuccess: (contact) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      toast('Contact created', { variant: 'success', description: contact.name });
      setForm({ name: '', email: '', phone: '', company: '', city: '' });
      onCreated?.(contact._id);
      onClose();
    },
    onError: () => setError('Could not create contact. Check the fields and try again.'),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Lead"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={mutation.isPending} disabled={!form.name} onClick={() => mutation.mutate()}>
            Create contact
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <Input label="Company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
        <Input label="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
      </div>
    </Modal>
  );
}
