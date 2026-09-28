import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { createChatWidget } from '../../lib/api/chatWidgets';
import { toast } from '../../stores/toastStore';
import { MessageCircle } from 'lucide-react';

const STEPS = ['Branding', 'Theme', 'Pre-Chat', 'Hours', 'Routing'] as const;
export type WizardStep = (typeof STEPS)[number];

export interface WizardState {
  name: string;
  companyName: string;
  primaryColor: string;
  position: 'bottom-right' | 'bottom-left';
  greeting: string;
  collectName: boolean;
  collectEmail: boolean;
  alwaysOn: boolean;
  timezone: string;
  assignTo: 'round_robin' | 'specific_agent' | 'team';
  fallbackMessage: string;
}

const INITIAL_STATE: WizardState = {
  name: '',
  companyName: '',
  primaryColor: '#4f46e5',
  position: 'bottom-right',
  greeting: 'Hi there! How can we help?',
  collectName: true,
  collectEmail: true,
  alwaysOn: true,
  timezone: 'Asia/Kolkata',
  assignTo: 'round_robin',
  fallbackMessage: "We'll get back to you as soon as possible.",
};

interface ChatWidgetWizardProps {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

export function ChatWidgetWizard({ open, onClose, onCreated }: ChatWidgetWizardProps) {
  const queryClient = useQueryClient();
  const [stepIndex, setStepIndex] = useState(0);
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [nameError, setNameError] = useState('');

  const step = STEPS[stepIndex];

  const mutation = useMutation({
    mutationFn: () =>
      createChatWidget({
        name: state.name,
        branding: { companyName: state.companyName },
        theme: { primaryColor: state.primaryColor, position: state.position },
        preChat: { greeting: state.greeting, collectName: state.collectName, collectEmail: state.collectEmail },
        hours: { alwaysOn: state.alwaysOn, timezone: state.timezone },
        routing: { assignTo: state.assignTo, fallbackMessage: state.fallbackMessage },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-widgets'] });
      toast('Chat widget created', { variant: 'success', description: state.name });
      reset();
      onCreated?.();
      onClose();
    },
    onError: () => setNameError('Could not create widget — the name may already be in use.'),
  });

  function reset() {
    setStepIndex(0);
    setState(INITIAL_STATE);
    setNameError('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  function goNext() {
    if (step === 'Branding') {
      if (!state.name.trim()) {
        setNameError('Widget name is required.');
        return;
      }
      if (!state.companyName.trim()) {
        setNameError('Company name is required.');
        return;
      }
    }
    setNameError('');
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }

  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  return (
    <Modal open={open} onClose={handleClose} title="Create Chat Widget">
      <div className="space-y-4">
        <div className="flex items-center gap-2" role="list" aria-label="Wizard steps">
          {STEPS.map((s, i) => (
            <div key={s} role="listitem" className="flex items-center gap-2">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                  i <= stepIndex ? 'bg-[var(--color-primary)] text-[var(--color-primary-fg)]' : 'bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]'
                }`}
              >
                {i + 1}
              </div>
              {i < STEPS.length - 1 && <div className="h-px w-4 bg-[var(--color-border)]" />}
            </div>
          ))}
        </div>
        <p className="text-sm font-medium text-[var(--color-text-muted)]">
          Step {stepIndex + 1} of {STEPS.length}: {step}
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            {step === 'Branding' && (
              <>
                <Input id="widget-name" label="Widget Name" required value={state.name} onChange={(e) => setState({ ...state, name: e.target.value })} />
                <Input id="widget-company-name" label="Company Name" required value={state.companyName} onChange={(e) => setState({ ...state, companyName: e.target.value })} />
                {nameError && <p className="text-sm text-[var(--color-danger)]">{nameError}</p>}
              </>
            )}
            {step === 'Theme' && (
              <>
                <label className="flex items-center justify-between text-sm">
                  <span>Primary color</span>
                  <input type="color" value={state.primaryColor} onChange={(e) => setState({ ...state, primaryColor: e.target.value })} />
                </label>
                <label className="flex items-center justify-between text-sm">
                  <span>Position</span>
                  <select
                    className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
                    value={state.position}
                    onChange={(e) => setState({ ...state, position: e.target.value as WizardState['position'] })}
                  >
                    <option value="bottom-right">Bottom right</option>
                    <option value="bottom-left">Bottom left</option>
                  </select>
                </label>
              </>
            )}
            {step === 'Pre-Chat' && (
              <>
                <Input id="widget-greeting" label="Greeting" value={state.greeting} onChange={(e) => setState({ ...state, greeting: e.target.value })} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={state.collectName} onChange={(e) => setState({ ...state, collectName: e.target.checked })} />
                  Collect visitor name
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={state.collectEmail} onChange={(e) => setState({ ...state, collectEmail: e.target.checked })} />
                  Collect visitor email
                </label>
              </>
            )}
            {step === 'Hours' && (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={state.alwaysOn} onChange={(e) => setState({ ...state, alwaysOn: e.target.checked })} />
                  Always online
                </label>
                <Input id="widget-timezone" label="Timezone" value={state.timezone} onChange={(e) => setState({ ...state, timezone: e.target.value })} />
              </>
            )}
            {step === 'Routing' && (
              <>
                <label className="flex items-center justify-between text-sm">
                  <span>Assign to</span>
                  <select
                    className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
                    value={state.assignTo}
                    onChange={(e) => setState({ ...state, assignTo: e.target.value as WizardState['assignTo'] })}
                  >
                    <option value="round_robin">Round robin</option>
                    <option value="specific_agent">Specific agent</option>
                    <option value="team">Team</option>
                  </select>
                </label>
                <Input id="widget-fallback-message" label="Fallback message" value={state.fallbackMessage} onChange={(e) => setState({ ...state, fallbackMessage: e.target.value })} />
              </>
            )}
          </div>

          <div className="flex items-end justify-center">
            <div className="relative h-64 w-full max-w-[220px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
              <p className="text-xs font-medium text-[var(--color-text-muted)]">Live Preview</p>
              <div
                className={`absolute bottom-3 ${state.position === 'bottom-right' ? 'right-3' : 'left-3'} w-44 rounded-[var(--radius-md)] bg-[var(--color-surface)] p-2 shadow-lg`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full text-white" style={{ backgroundColor: state.primaryColor }}>
                    <MessageCircle className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-xs font-semibold">{state.companyName || 'Your Company'}</span>
                  <span className="ml-auto h-2 w-2 rounded-full bg-green-500" title="Online" />
                </div>
                <p className="mt-1.5 text-[11px] text-[var(--color-text-muted)]">{state.greeting}</p>
                {state.collectName && <div className="mt-1.5 h-5 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[9px] leading-5 pl-1">Name</div>}
                {state.collectEmail && <div className="mt-1 h-5 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[9px] leading-5 pl-1">Email</div>}
                <button
                  type="button"
                  className="mt-1.5 h-6 w-full rounded text-[10px] font-medium text-white"
                  style={{ backgroundColor: state.primaryColor }}
                >
                  Start Chat
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-between pt-2">
          <Button variant="secondary" onClick={stepIndex === 0 ? handleClose : goBack}>
            {stepIndex === 0 ? 'Cancel' : 'Back'}
          </Button>
          {step === 'Routing' ? (
            <Button loading={mutation.isPending} onClick={() => mutation.mutate()}>
              Create Widget
            </Button>
          ) : (
            <Button onClick={goNext}>Continue</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
