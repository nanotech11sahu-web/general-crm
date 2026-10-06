import { BadRequestException, Body, Controller, Get, Headers, Inject, Injectable, Module, Param, Post, Put, Query } from '@nestjs/common';
import { IsArray, IsIn, IsObject, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { exchangeEmbeddedSignupCode } from '@leaddesk/connectors';
import type { FetchLike } from '@leaddesk/connectors-core';
import type { KeyService } from '@leaddesk/crypto';
import { ConnectionService, DomainError, IntegrityService, LeadService, MessagingService } from '@leaddesk/domain';
import { KEY_SERVICE, TENANT_DB } from '@leaddesk/platform';
import { toObjectId, type TenantDb } from '@leaddesk/db';
import type { ConnectorRegistry } from '@leaddesk/connectors-core';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, RequirePermission } from '../common/guards';
import { ScopeService } from '../common/scope.service';
import { ConnectionsModule, HTTP_FETCH, REGISTRY } from '../connections/connections.module';
import { LeadsModule } from '../leads/leads.module';

const CHANNELS = ['whatsapp', 'sms'] as const;
class SendDto {
  @IsString() leadId!: string;
  @IsIn(CHANNELS as unknown as string[]) channel!: 'whatsapp' | 'sms';
  @IsOptional() @IsString() templateId?: string;
  @IsOptional() @IsString() @MaxLength(4096) body?: string;
  @IsOptional() @IsObject() vars?: Record<string, string>;
}
class TemplateDto {
  @IsIn(CHANNELS as unknown as string[]) channel!: 'whatsapp' | 'sms';
  @IsString() @MaxLength(60) name!: string;
  @IsString() @MinLength(1) @MaxLength(1024) body!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) variables?: string[];
  @IsOptional() @IsString() language?: string;
  @IsOptional() @IsIn(['utility', 'marketing', 'authentication']) category?: string;
  @IsOptional() @IsString() dltTemplateId?: string;
  @IsOptional() @IsString() dltHeader?: string;
  @IsOptional() @IsString() providerTemplateId?: string;
}
class TemplatePatchDto {
  @IsOptional() @IsString() @MaxLength(1024) body?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) variables?: string[];
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() dltTemplateId?: string;
  @IsOptional() @IsString() dltHeader?: string;
  @IsOptional() @IsString() providerTemplateId?: string;
}
class SignupDto {
  @IsString() @MinLength(5) code!: string;
  @Matches(/^\d{5,30}$/) wabaId!: string;
  @Matches(/^\d{5,30}$/) phoneNumberId!: string;
  @IsOptional() @IsString() @MaxLength(80) name?: string;
}

@Injectable()
export class MessagingFacade {
  readonly msg: MessagingService; readonly leads: LeadService; readonly conns: ConnectionService; readonly integrity: IntegrityService;
  constructor(
    @Inject(TENANT_DB) readonly db: TenantDb, @Inject(KEY_SERVICE) keys: KeyService, @Inject(REGISTRY) readonly registry: ConnectorRegistry,
    @Inject(HTTP_FETCH) readonly fetch: FetchLike | undefined, readonly scope: ScopeService, readonly audit: AuditService,
  ) {
    this.msg = new MessagingService(db, keys, registry); this.leads = new LeadService(db);
    this.conns = new ConnectionService(db, keys, registry); this.integrity = new IntegrityService(db, keys, registry);
  }
  async visibleLead(u: AuthUser, id: string) { const l: any = await this.leads.get(id); await this.scope.assertVisible(u, l); return l; }
  async visibleConversation(u: AuthUser, id: string) {
    const c: any = await this.db.repos.conversations.findById(id);
    if (!c) throw new DomainError('not_found', 'Conversation not found', undefined, 404);
    await this.visibleLead(u, String(c.leadId));
    return c;
  }
  async actorName(userId: string) { return ((await this.db.models.User.findById(userId, { name: 1 }).lean().exec()) as any)?.name as string | undefined; }
}

@Controller('v1')
export class MessagingController {
  constructor(private readonly f: MessagingFacade) {}

  /** Which channels are connected: the UI hides buttons for the rest. */
  @Get('channels') @RequirePermission('leads.read')
  channels() { return this.f.msg.channels(); }

  @Get('conversations') @RequirePermission('leads.read')
  async conversations(@CurrentUser() u: AuthUser, @Query('leadId') leadId?: string) {
    if (!leadId) throw new BadRequestException('leadId is required');
    await this.f.visibleLead(u, leadId);
    return this.f.msg.conversations(leadId);
  }

  @Get('conversations/:id/messages') @RequirePermission('leads.read')
  async messages(@CurrentUser() u: AuthUser, @Param('id') id: string) { await this.f.visibleConversation(u, id); return this.f.msg.messages(id); }

  @Post('conversations/:id/read') @RequirePermission('leads.write')
  async read(@CurrentUser() u: AuthUser, @Param('id') id: string) { await this.f.visibleConversation(u, id); await this.f.msg.markRead(id); return { ok: true }; }

  /** `Idempotency-Key` is mandatory: a retried tap must never send twice. */
  @Post('messages') @RequirePermission('leads.write')
  async send(@CurrentUser() u: AuthUser, @Body() b: SendDto, @Headers('idempotency-key') key?: string) {
    if (!key || key.length < 8 || key.length > 128) throw new BadRequestException('Idempotency-Key header (8-128 chars) is required');
    await this.f.visibleLead(u, b.leadId);
    return this.f.msg.send({ ...b, idempotencyKey: `u:${u.userId}:${key}`, source: 'agent', actorName: await this.f.actorName(u.userId) });
  }

  /**
   * No Cloud API / DLT connection? Open the agent's own WhatsApp or SMS app instead. The timeline entry is
   * labelled self-reported (we cannot see delivery). Reduced custody: the number reaches the phone via the link.
   */
  @Post('messages/launch') @RequirePermission('leads.write')
  async launch(@CurrentUser() u: AuthUser, @Body() b: SendDto) {
    const lead = await this.f.visibleLead(u, b.leadId);
    if ((await this.f.msg.channels())[b.channel].connected) throw new DomainError('use_connected_channel', `${b.channel} is connected: send through the platform`, undefined, 409);
    const phone = (lead.contacts ?? []).find((c: any) => c.kind === 'phone' && !(c.optedOutChannels ?? []).includes(b.channel));
    if (!phone) throw new DomainError('no_phone', 'No reachable phone number (missing or opted out)');
    const text = (b.body ?? '').slice(0, 1000);
    const digits = phone.valueNorm.replace(/\D/g, '');
    const url = b.channel === 'whatsapp' ? `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}` : `sms:+${digits}${text ? `?body=${encodeURIComponent(text)}` : ''}`;
    await this.f.db.repos.activities.create({ leadId: lead._id, type: 'message_out', actorId: toObjectId(u.userId), channel: b.channel, payload: { selfReported: true, channel: b.channel, preview: text.slice(0, 120) }, occurredAt: new Date() });
    return { url, selfReported: true };
  }

  // ---- templates ----
  @Get('templates') @RequirePermission('leads.read')
  templates(@Query('channel') channel?: string, @Query('status') status?: string) {
    const f: Record<string, unknown> = {}; if (channel) f.channel = channel; if (status) f.status = status;
    return this.f.db.repos.templates.find(f, { sort: { name: 1 }, limit: 500 });
  }
  @Post('templates') @RequirePermission('rules.manage')
  async createTemplate(@Body() b: TemplateDto) { const t = await this.f.msg.createTemplate(b); await this.f.audit.record({ action: 'template.created', entity: 'template', entityId: String((t as any)._id) }); return t; }
  @Put('templates/:id') @RequirePermission('rules.manage')
  updateTemplate(@Param('id') id: string, @Body() b: TemplatePatchDto) { return this.f.msg.updateTemplate(id, b); }
  @Post('templates/sync') @RequirePermission('rules.manage')
  syncTemplates() { return this.f.msg.syncTemplates(); }
  @Post('templates/:id/submit') @RequirePermission('rules.manage')
  async submit(@Param('id') id: string) { const t = await this.f.msg.submitTemplate(id); await this.f.audit.record({ action: 'template.submitted', entity: 'template', entityId: id }); return t; }
  @Post('templates/:id/approve') @RequirePermission('rules.manage')
  async approve(@Param('id') id: string) { const t = await this.f.msg.approveSmsTemplate(id); await this.f.audit.record({ action: 'template.dlt_approved', entity: 'template', entityId: id }); return t; }

  /**
   * WhatsApp Embedded Signup (v4): the browser flow returns an authorization code plus the WABA / phone number the
   * customer chose. Requires the platform to be a Meta Tech Provider; the paste-your-own-token path (POST
   * /v1/connections with provider "whatsapp-cloud") is the fallback.
   */
  @Post('oauth/whatsapp/embedded-signup') @RequirePermission('connections.manage')
  async embeddedSignup(@Body() b: SignupDto) {
    if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) throw new DomainError('not_configured', 'Meta app credentials are not configured');
    const { accessToken } = await exchangeEmbeddedSignupCode({ appId: process.env.META_APP_ID, appSecret: process.env.META_APP_SECRET, verifyToken: '', graphVersion: process.env.META_GRAPH_VERSION, fetch: this.f.fetch }, b.code);
    const out = await this.f.conns.create({ provider: 'whatsapp-cloud', name: b.name ?? 'WhatsApp Business', credentials: { accessToken }, config: { wabaId: b.wabaId, phoneNumberId: b.phoneNumberId } });
    const hb = await this.f.integrity.heartbeat(out.connection.id); // also subscribes our app to the WABA
    await this.f.audit.record({ action: 'connection.embedded_signup', entity: 'connection', entityId: out.connection.id });
    return { connection: await this.f.conns.get(out.connection.id).then((c) => this.f.conns.view(c)), status: hb.status, resubscribed: !!hb.resubscribed };
  }
}

@Module({ imports: [ConnectionsModule, LeadsModule], controllers: [MessagingController], providers: [MessagingFacade], exports: [MessagingFacade] })
export class MessagingModule {}
