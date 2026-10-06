'use client';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { defaultDue, toIso } from '../lib/format';

export interface Outcome { _id: string; label: string; kind: string; requiresNextAction: boolean; defaultNextOffsetMin?: number | null }
export interface SheetTarget { leadId: string; leadName: string; callSessionId?: string; durationS?: number; taskId?: string }
export interface Suggestion { statusId: string | null; lostReasonId: string | null }

/** The outcome + next-action sheet. The server enforces the rules; this shows its messages next to the fields. */
export function OutcomeSheet({ target, outcomes, onDone, onSkipped, onCancel }: {
  target: SheetTarget; outcomes: Outcome[];
  onDone: (s: Suggestion) => void; onSkipped: (left: number) => void; onCancel: () => void;
}) {
  const [picked, setPicked] = useState<Outcome | null>(null);
  const [due, setDue] = useState(defaultDue()); const [note, setNote] = useState(''); const [type, setType] = useState('call');
  const [callNote, setCallNote] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [fields, setFields] = useState<Record<string, string>>({});
  const needsNext = !!picked?.requiresNextAction;
  useEffect(() => { if (picked) setDue(defaultDue(picked.defaultNextOffsetMin)); }, [picked]);
  const mins = useMemo(() => (target.durationS !== undefined ? Math.max(0, Math.round(target.durationS / 60)) : null), [target.durationS]);

  async function submit() {
    if (!picked) return;
    setBusy(true); setError(null); setFields({});
    try {
      const res = await api<{ suggestion: Suggestion }>(`/v1/leads/${target.leadId}/outcome`, { method: 'POST', body: {
        outcomeId: picked._id, note: callNote || undefined, callSessionId: target.callSessionId, taskId: target.taskId, durationS: target.durationS,
        next: needsNext ? { dueAt: toIso(due), contextNote: note, type } : undefined,
      } });
      onDone(res.suggestion);
    } catch (e) {
      if (e instanceof ApiError) { setError(e.message); setFields(e.details ?? {}); } else setError('Something went wrong. Try again.');
    } finally { setBusy(false); }
  }
  async function skip() {
    if (!target.callSessionId) return onCancel();
    try { const r = await api<{ skipsLeftToday: number }>(`/v1/calls/${target.callSessionId}/skip-outcome`, { method: 'POST' }); onSkipped(r.skipsLeftToday); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not skip'); }
  }

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Log outcome">
      <div>
        <h2>How did the call with {target.leadName} go?</h2>
        {mins !== null && <p className="reason">Call length ≈ {mins} min (self-reported)</p>}
        <div className="outcomes" role="group" aria-label="Outcome">
          {outcomes.map((o) => (<button key={o._id} type="button" aria-pressed={picked?._id === o._id} onClick={() => setPicked(o)}>{o.label}</button>))}
        </div>
        <label htmlFor="callNote">Notes (optional)</label>
        <textarea id="callNote" value={callNote} onChange={(e) => setCallNote(e.target.value)} />
        {needsNext && (
          <>
            <h2 style={{ marginTop: 16 }}>Next action</h2>
            <label htmlFor="due">When</label>
            <input id="due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
            {fields.dueAt && <p className="err">{fields.dueAt}</p>}
            <label htmlFor="type">How</label>
            <select id="type" value={type} onChange={(e) => setType(e.target.value)}>
              {['call', 'whatsapp', 'sms', 'visit', 'other'].map((t) => <option key={t}>{t}</option>)}
            </select>
            <label htmlFor="note">What to do and why</label>
            <textarea id="note" placeholder="e.g. Asked to call Friday after 6 PM about the 3BHK" value={note} onChange={(e) => setNote(e.target.value)} />
            {fields.contextNote && <p className="err">{fields.contextNote}</p>}
          </>
        )}
        {error && !fields.dueAt && !fields.contextNote && <p className="err" role="alert">{error}</p>}
        <div className="row" style={{ marginTop: 16 }}>
          <button className="primary big" disabled={!picked || busy} onClick={submit}>{busy ? 'Saving…' : 'Save and next lead'}</button>
          <button type="button" onClick={skip}>{target.callSessionId ? 'Skip for now' : 'Cancel'}</button>
        </div>
      </div>
    </div>
  );
}
