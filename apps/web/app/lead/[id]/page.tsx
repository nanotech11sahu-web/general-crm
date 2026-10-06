'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ApiError, api, openStream, refresh } from '../../../lib/api';

type Channel = 'whatsapp' | 'sms';
interface Channels { whatsapp: { connected: boolean }; sms: { connected: boolean } }
interface Conversation { _id: string; channel: Channel; windowExpiresAt?: string; unreadCount: number }
interface Message { _id: string; direction: 'in' | 'out'; body: string; status: string; source?: string; createdAt: string; error?: string }
interface Template { _id: string; name: string; channel: Channel; body: string }
interface LeadView { displayName: string; city?: string; ai?: { possibleDuplicates?: { leadId: string; name: string; same: string }[]; inbound?: { intent: string; summary: string; urgency: string }; summary?: string; temperature?: string; reasons?: string[]; score?: number; nextBestAction?: { channel: string; note: string } } }
interface Suggestion { _id: string; type: string; payload: any; confidence?: number; status: string }
const AI_ACTIONS: [string, string][] = [['summary', 'Summarise'], ['score', 'Score'], ['autofill', 'Fill fields'], ['assess', 'Full assessment'], ['reply-draft', 'Draft a reply'], ['inbound', 'Read last reply'], ['duplicates', 'Find duplicates'], ['revive', 'Re-engage idea']];
const describe = (s: Suggestion) => s.type === 'summary' ? s.payload.summary : s.type === 'scoring' ? `Score ${s.payload.score} (${s.payload.temperature}): ${(s.payload.reasons ?? []).join('; ')}` : s.type === 'autofill' ? `Fill: ${Object.entries(s.payload.fields ?? {}).map(([k, v]) => `${k} = ${v}`).join(', ')}` : s.type === 'assessment' ? `${s.payload.summary} · score ${s.payload.score} (${s.payload.temperature}) · ${s.payload.validity}${s.payload.nextBestAction ? ` · first action: ${s.payload.nextBestAction.channel} ${s.payload.nextBestAction.timing}` : ''}` : s.type === 'reply_draft' ? `“${s.payload.text}”${s.payload.reason ? ` — ${s.payload.reason}` : ''}` : s.type === 'inbound_intel' ? `Last reply: ${s.payload.summary} (${s.payload.intent}, ${s.payload.sentiment}${s.payload.urgency === 'high' ? ', urgent' : ''}). Try: ${s.payload.suggestedAction}` : s.type === 'duplicate' ? `Possibly the same person as ${(s.payload.candidates ?? []).map((c: any) => `${c.name} (${c.same}: ${c.reason})`).join('; ')}` : s.type === 'revival' ? `Re-engage via ${s.payload.channel}: ${s.payload.reason} Draft: “${s.payload.message}”` : s.type === 'next_action' ? `Next: ${s.payload.nextAction?.contextNote ?? ''}${s.payload.outcomeLabel ? ` (outcome: ${s.payload.outcomeLabel})` : ''}` : s.type;

const STATUS_TEXT: Record<string, string> = { queued: 'sending…', sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed', received: '' };
const ERRORS: Record<string, string> = {
  opted_out: 'This lead opted out of this channel.', window_closed: 'The 24-hour reply window is closed: send an approved template.',
  dlt_template_required: 'SMS needs an approved template.', channel_not_connected: 'This channel is not connected.',
  template_not_approved: 'That template is not approved yet.', quiet_hours: 'Messages are paused during quiet hours.',
};

/** One lead's conversation: read the thread, reply (free text inside the WhatsApp window, templates otherwise). */
export default function LeadThread() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [lead, setLead] = useState<LeadView | null>(null); const [channels, setChannels] = useState<Channels | null>(null);
  const [convs, setConvs] = useState<Conversation[]>([]); const [channel, setChannel] = useState<Channel>('whatsapp');
  const [messages, setMessages] = useState<Message[]>([]); const [templates, setTemplates] = useState<Template[]>([]);
  const [text, setText] = useState(''); const [tpl, setTpl] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [aiOn, setAiOn] = useState(false); const [sugg, setSugg] = useState<Suggestion[]>([]); const [aiBusy, setAiBusy] = useState(false);
  const keyRef = useRef<string>(''); const bottom = useRef<HTMLDivElement>(null);

  const conv = convs.find((c) => c.channel === channel);
  const windowOpen = !!conv?.windowExpiresAt && new Date(conv.windowExpiresAt).getTime() > Date.now();
  const mustUseTemplate = channel === 'sms' || !windowOpen;

  const loadThread = useCallback(async () => {
    const cs = await api<Conversation[]>(`/v1/conversations?leadId=${id}`).catch(() => [] as Conversation[]);
    setConvs(cs);
    const c = cs.find((x) => x.channel === channel) ?? cs[0];
    if (c) {
      if (c.channel !== channel) setChannel(c.channel);
      setMessages((await api<{ items: Message[] } | Message[]>(`/v1/conversations/${c._id}/messages`).then((r) => (Array.isArray(r) ? r : r.items)).catch(() => [])).slice().sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)));
      if (c.unreadCount) void api(`/v1/conversations/${c._id}/read`, { method: 'POST' }).catch(() => undefined);
    } else setMessages([]);
  }, [id, channel]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!(await refresh())) { router.replace('/login'); return; }
      if (!alive) return;
      const [l, ch, ts] = await Promise.all([api<LeadView>(`/v1/leads/${id}`), api<Channels>('/v1/channels'), api<Template[]>('/v1/templates?status=approved').catch(() => [])]);
      if (!alive) return;
      setLead(l); setChannels(ch); setTemplates(ts); setChannel(ch.whatsapp.connected ? 'whatsapp' : ch.sms.connected ? 'sms' : 'whatsapp');
      setReady(true);
    })().catch((e) => { if (e instanceof ApiError && e.status === 401) router.replace('/login'); else setError('Could not load this lead.'); });
    return () => { alive = false; };
  }, [id, router]);

  useEffect(() => { if (ready) void loadThread(); }, [ready, loadThread]);
  const loadAi = useCallback(async () => {
    const st = await api<{ enabled: boolean; killSwitch: boolean }>('/v1/ai/settings').catch(() => null);
    setAiOn(!!st?.enabled && !st.killSwitch);
    if (st?.enabled) setSugg(await api<Suggestion[]>(`/v1/ai/suggestions?leadId=${id}&status=pending`).catch(() => []));
  }, [id]);
  useEffect(() => { if (ready) void loadAi(); }, [ready, loadAi]);
  async function runAi(kind: string) {
    setAiBusy(true); setError(null);
    try { await api(`/v1/ai/leads/${id}/${kind}`, { method: 'POST' }); await loadAi(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'AI is unavailable. Carry on manually.'); }
    finally { setAiBusy(false); }
  }
  async function decide(sid: string, accept: boolean) {
    const sg = sugg.find((x) => x._id === sid); if (accept && sg?.type === 'reply_draft') { setText(sg.payload.text); if (sg.payload.needsHuman) setError('Check this draft before sending: ' + (sg.payload.reason ?? 'it may need your input')); }
    try { await api(`/v1/ai/suggestions/${sid}/${accept ? 'accept' : 'reject'}`, { method: 'POST' }); await loadAi(); if (accept) setLead(await api<LeadView>(`/v1/leads/${id}`)); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not apply that suggestion'); await loadAi(); }
  }
  useEffect(() => { bottom.current?.scrollIntoView?.({ block: 'end' }); }, [messages.length]);
  useEffect(() => {
    if (!ready) return;
    return openStream((type, data) => { if ((type === 'message.in') && data?.leadId === id) void loadThread(); });
  }, [ready, id, loadThread]);

  async function send() {
    if (busy) return;
    setBusy(true); setError(null);
    if (!keyRef.current) keyRef.current = crypto.randomUUID(); // a retried tap reuses the key => never sends twice
    try {
      await api('/v1/messages', { method: 'POST', headers: { 'idempotency-key': keyRef.current }, body: { leadId: id, channel, ...(mustUseTemplate ? { templateId: tpl } : { body: text }) } });
      keyRef.current = ''; setText(''); setTpl(''); await loadThread();
    } catch (e) {
      if (e instanceof ApiError && e.status < 500 && e.status !== 0) keyRef.current = ''; // a definite refusal: next attempt is a new message
      setError(e instanceof ApiError ? ERRORS[e.code] ?? e.message : 'Could not send. Check your connection and tap Send again.');
    } finally { setBusy(false); }
  }

  /** No platform channel: open the agent's own WhatsApp/SMS app (self-reported). */
  async function launch(ch: Channel) {
    try { const r = await api<{ url: string }>('/v1/messages/launch', { method: 'POST', body: { leadId: id, channel: ch, body: text || undefined } }); window.location.assign(r.url); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not open the app'); }
  }

  if (!ready) return <main><p className="reason">{error ?? 'Loading…'}</p></main>;
  const connected = channels && (channels.whatsapp.connected || channels.sms.connected);
  const choices = templates.filter((t) => t.channel === channel);

  return (
    <main>
      <div className="bar">
        <h1>{lead?.displayName ?? 'Lead'}</h1>
        <button onClick={() => router.push('/today')} style={{ minHeight: 36, padding: '0 12px' }}>Back</button>
      </div>
      {lead?.city && <p className="reason">{lead.city}</p>}
      {(lead?.ai?.possibleDuplicates ?? []).length > 0 && <p className="reason" data-testid="dup-note">Possible duplicate: {lead!.ai!.possibleDuplicates!.map((d) => <a key={d.leadId} href={`/lead/${d.leadId}`}>{d.name} ({d.same})</a>)}. Merging stays a manager action.</p>}
      {lead?.ai?.inbound?.urgency === 'high' && <p className="err" role="status">Urgent reply: {lead.ai.inbound.summary}</p>}
      {lead?.ai?.summary && <p className="reason" data-testid="ai-summary">{lead.ai.summary}{lead.ai.temperature ? ` (${lead.ai.temperature})` : ''}</p>}
      {aiOn && (
        <section className="card" aria-label="AI assistant"><h2>AI assistant</h2>
          <p className="reason">AI only suggests. Nothing changes until you accept.</p>
          <div className="row">{AI_ACTIONS.map(([k, label]) => <button key={k} disabled={aiBusy} onClick={() => runAi(k)}>{label}</button>)}</div>
          {sugg.map((x) => (
            <div key={x._id} data-testid="suggestion" style={{ marginTop: 10 }}>
              <p className="reason">{describe(x)}{x.confidence !== undefined ? ` · ${Math.round(x.confidence * 100)}% sure` : ''}</p>
              <div className="row"><button className="primary" onClick={() => decide(x._id, true)}>{x.type === 'reply_draft' ? 'Use this draft' : x.type === 'duplicate' ? 'Note it' : 'Accept'}</button><button onClick={() => decide(x._id, false)}>Dismiss</button></div>
            </div>
          ))}
        </section>
      )}
      {error && <p className="err" role="alert">{error}</p>}

      {!connected && (
        <div className="card">
          <h2>No messaging channel connected</h2>
          <p className="reason">Ask an admin to connect WhatsApp or SMS. Until then you can open your own apps (these messages are not tracked).</p>
          <div className="row"><button onClick={() => launch('whatsapp')}>Open WhatsApp</button><button onClick={() => launch('sms')}>Open SMS</button></div>
        </div>
      )}

      {connected && (
        <>
          <div className="row" role="tablist" aria-label="Channel">
            {(['whatsapp', 'sms'] as Channel[]).filter((c) => channels![c].connected).map((c) => (
              <button key={c} role="tab" aria-selected={channel === c} className={channel === c ? 'primary' : ''} onClick={() => setChannel(c)}>{c === 'sms' ? 'SMS' : 'WhatsApp'}</button>
            ))}
          </div>
          <div className="card" data-testid="thread" aria-live="polite" style={{ maxHeight: '45vh', overflowY: 'auto' }}>
            {messages.length === 0 && <p className="reason">No messages yet.</p>}
            {messages.map((m) => (
              <div key={m._id} data-direction={m.direction} style={{ display: 'flex', justifyContent: m.direction === 'out' ? 'flex-end' : 'flex-start', margin: '6px 0' }}>
                <div style={{ maxWidth: '80%', padding: '8px 12px', borderRadius: 12, background: m.direction === 'out' ? '#dbeafe' : '#f1f5f9', color: '#0f172a' }}>
                  <div>{m.body}</div>
                  <small style={{ opacity: 0.65 }}>{m.direction === 'out' ? `${m.source && m.source !== 'agent' ? 'automatic · ' : ''}${STATUS_TEXT[m.status] ?? m.status}${m.status === 'failed' && m.error ? `: ${m.error}` : ''}` : new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                </div>
              </div>
            ))}
            <div ref={bottom} />
          </div>

          <div className="card">
            {mustUseTemplate ? (
              <>
                <p className="reason">{channel === 'sms' ? 'SMS goes out from an approved template.' : 'The 24-hour window is closed. Send an approved template to restart the conversation.'}</p>
                <label htmlFor="tpl">Template</label>
                <select id="tpl" value={tpl} onChange={(e) => setTpl(e.target.value)}>
                  <option value="">Choose a template…</option>
                  {choices.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
                </select>
                {tpl && <p className="reason">{choices.find((t) => t._id === tpl)?.body}</p>}
              </>
            ) : (
              <>
                <label htmlFor="msg">Message</label>
                <textarea id="msg" rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={4096} />
              </>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="primary big" disabled={busy || (mustUseTemplate ? !tpl : !text.trim())} onClick={send}>{busy ? 'Sending…' : 'Send'}</button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
