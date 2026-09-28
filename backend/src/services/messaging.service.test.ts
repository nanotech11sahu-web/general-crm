import { createOwnerContext } from '../test/helpers';
import { Contact } from '../models/Contact';
import { sendEmail, sendWhatsApp } from './messaging.service';
import { processInboundWhatsAppMessage, matchOptOutKeyword } from './optOut.service';
import { EmailLog } from '../models/EmailLog';
import { WhatsAppLog } from '../models/WhatsAppLog';

describe('matchOptOutKeyword', () => {
  it.each(['STOP', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END', 'stop', 'unsubscribe'])('recognizes "%s" as an opt-out keyword', (word) => {
    expect(matchOptOutKeyword(word)).toBe(word.toUpperCase());
  });

  it('does not match ordinary messages', () => {
    expect(matchOptOutKeyword('Hi, tell me more please')).toBeNull();
    expect(matchOptOutKeyword('please stop calling me so much')).toBeNull(); // exact-match only, not substring
  });
});

describe('Opt-out suppression (Phase 4 core DoD)', () => {
  it('an inbound STOP message opts the contact out and suppresses all future WhatsApp sends', async () => {
    const { workspace, demoContact } = await createOwnerContext();

    const beforeOptOut = await sendWhatsApp(String(workspace._id), String(demoContact._id), 'Hello!', 'campaign');
    expect(beforeOptOut).toBe('sent');

    const result = await processInboundWhatsAppMessage(String(workspace._id), String(demoContact._id), 'STOP');
    expect(result.optedOut).toBe(true);
    expect(result.keyword).toBe('STOP');

    const afterOptOut = await sendWhatsApp(String(workspace._id), String(demoContact._id), 'Are you still there?', 'campaign');
    expect(afterOptOut).toBe('suppressed_optout');

    const logs = await WhatsAppLog.find({ contactId: demoContact._id }).sort({ createdAt: 1 });
    expect(logs.map((l) => l.status)).toEqual(['sent', 'suppressed_optout']);
  });

  it('recognizes every configured opt-out keyword, not just STOP', async () => {
    const { workspace, demoContact } = await createOwnerContext();
    await processInboundWhatsAppMessage(String(workspace._id), String(demoContact._id), 'unsubscribe');
    const result = await sendWhatsApp(String(workspace._id), String(demoContact._id), 'ping', 'workflow');
    expect(result).toBe('suppressed_optout');
  });

  it('leaves a contact opted-in when the inbound message is not a recognized keyword', async () => {
    const { workspace, demoContact } = await createOwnerContext();
    const result = await processInboundWhatsAppMessage(String(workspace._id), String(demoContact._id), 'Sure, sounds good');
    expect(result.optedOut).toBe(false);
    const send = await sendWhatsApp(String(workspace._id), String(demoContact._id), 'Following up', 'campaign');
    expect(send).toBe('sent');
  });

  it('suppresses email sends for a contact with email DND enabled, independent of opt-out', async () => {
    const { workspace, demoContact } = await createOwnerContext();
    await Contact.findByIdAndUpdate(demoContact._id, { $set: { 'dnd.email': true } });
    const result = await sendEmail(String(workspace._id), String(demoContact._id), 'Hello', 'campaign');
    expect(result).toBe('suppressed_dnd');
    const log = await EmailLog.findOne({ contactId: demoContact._id });
    expect(log?.status).toBe('suppressed_dnd');
  });

  it('suppresses everything when blockAll DND is set', async () => {
    const { workspace, demoContact } = await createOwnerContext();
    await Contact.findByIdAndUpdate(demoContact._id, { $set: { 'dnd.blockAll': true } });
    expect(await sendEmail(String(workspace._id), String(demoContact._id), 'Hi', 'campaign')).toBe('suppressed_dnd');
    expect(await sendWhatsApp(String(workspace._id), String(demoContact._id), 'Hi', 'campaign')).toBe('suppressed_dnd');
  });
});
