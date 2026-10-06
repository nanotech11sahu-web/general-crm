import { ConflictException, Inject, Injectable, UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { runAsSystem, runWithTenant, withTransaction, type SystemOps, type TenantDb } from '@leaddesk/db';
import type { Role } from '@leaddesk/shared';
import { BillingService, seedPreset } from '@leaddesk/domain';
import { AuditService } from '../audit/audit.service';
import { KEY_SERVICE, SYSTEM_OPS, TENANT_DB } from '@leaddesk/platform';
import { DomainError } from '@leaddesk/domain';
import type { RateConfig, RateStore } from '@leaddesk/platform';
import { openSecret, sealSecret, type KeyService } from '@leaddesk/crypto';
import { RATE_CONFIG, RATE_STORE } from '../hardening/hardening.module';
import { newTotpSecret, otpauthUrl, verifyTotp } from './totp';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const newToken = (tenantId: string) => `${tenantId}.${randomBytes(32).toString('base64url')}`;
const ROLE_RANK: Record<Role, number> = { agent: 0, manager: 1, admin: 2, owner: 3 };
const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;

export interface Tokens { accessToken: string; refreshToken: string; tenantId: string; role: Role }

@Injectable()
export class AuthService {
  constructor(
    @Inject(TENANT_DB) private readonly db: TenantDb,
    @Inject(SYSTEM_OPS) private readonly sys: SystemOps,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(KEY_SERVICE) private readonly keys: KeyService,
    @Inject(RATE_STORE) private readonly rates: RateStore,
    @Inject(RATE_CONFIG) private readonly cfg: RateConfig,
  ) {}

  async signup(i: { email: string; password: string; name: string; tenantName: string; country?: string; industryPreset?: string }): Promise<Tokens> {
    const email = i.email.toLowerCase();
    if (await this.sys.findUserByEmail(email)) throw new ConflictException('Email already registered');
    const passwordHash = await argon2.hash(i.password, { type: argon2.argon2id });
    const slug = `${i.tenantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${randomBytes(3).toString('hex')}`;
    const { Tenant, User } = this.db.models;
    const tenant = await Tenant.create({ name: i.tenantName, slug, country: i.country ?? 'IN', industryPreset: i.industryPreset ?? 'generic' });
    const user = await User.create({ email, passwordHash, name: i.name });
    const tenantId = String(tenant._id);
    return runWithTenant(tenantId, async () => {
      const m = await this.db.repos.memberships.create({ userId: user._id, role: 'owner' });
      await seedPreset(this.db.repos, i.industryPreset ?? 'generic');
      await new BillingService(this.db).ensureTrial(); // 14 days, everything unlocked
      await this.audit.record({ action: 'tenant.signup', entity: 'tenant', entityId: tenantId });
      return this.issue(String(user._id), tenantId, 'owner', String(m._id));
    });
  }

  /** Failed attempts are counted per account+IP and per account; once over the limit even the right password is refused until the window ends. */
  private lockKeys(email: string, ip: string) { return { a: `lf:${email}|${ip}`, b: `lf:${email}` }; }
  private async assertNotLocked(email: string, ip: string) {
    if (!this.cfg.enabled) return;
    const k = this.lockKeys(email, ip); const [a, b] = await Promise.all([this.rates.peek(k.a), this.rates.peek(k.b)]);
    const hit = (a && a.count >= this.cfg.lockout.perAccountIp ? a : null) ?? (b && b.count >= this.cfg.lockout.perAccount ? b : null);
    if (hit) { const retry = Math.max(1, Math.ceil((hit.resetAt - Date.now()) / 1000)); throw new DomainError('account_locked', 'Too many failed sign-in attempts. Try again later.', { retryAfterS: retry }, 429); }
  }
  private async recordFailure(email: string, ip: string) {
    if (!this.cfg.enabled) return;
    const k = this.lockKeys(email, ip); const w = this.cfg.lockout.windowS * 1000;
    await Promise.all([this.rates.hit(k.a, w), this.rates.hit(k.b, w)]);
  }

  async login(i: { email: string; password: string; tenantId?: string; totp?: string }, ip = 'unknown'): Promise<Tokens> {
    const email = i.email.toLowerCase();
    await this.assertNotLocked(email, ip);
    const user: any = await this.sys.findUserByEmail(email);
    // verify against a dummy hash when the user is unknown to keep timing uniform
    const ok = user?.passwordHash ? await argon2.verify(user.passwordHash, i.password) : (await argon2.hash('x'), false);
    if (!user || !ok || user.status !== 'active') { await this.recordFailure(email, ip); throw new UnauthorizedException('Invalid credentials'); }
    const memberships: any[] = await this.sys.listMemberships(user._id);
    const m = i.tenantId ? memberships.find((x) => String(x.tenantId) === i.tenantId) : memberships[0];
    if (!m) throw new UnauthorizedException('No active membership');
    if (user.totp?.enabledAt) {
      if (!i.totp) throw new UnauthorizedException({ code: 'totp_required', message: 'Enter the code from your authenticator app' });
      if (!(await this.checkSecondFactor(user, i.totp))) { await this.recordFailure(email, ip); throw new UnauthorizedException({ code: 'totp_invalid', message: 'That code did not work' }); }
    }
    await this.rates.reset(this.lockKeys(email, ip).a);
    return runWithTenant(String(m.tenantId), async () => {
      const t: any = await this.db.models.Tenant.findById(m.tenantId).lean().exec();
      if (t?.status && t.status !== 'active') throw new ForbiddenException('This workspace is not active');
      await this.audit.record({ action: 'auth.login', entity: 'user', entityId: String(user._id) });
      return this.issue(String(user._id), String(m.tenantId), m.role, String(m._id));
    });
  }

  // ---------- TOTP two-factor ----------
  private sealCtx(userId: string) { return { tenantId: 'user', connectionId: String(userId) }; }
  /** TOTP code (each time step usable once) or a single-use recovery code. */
  private async checkSecondFactor(user: any, code: string): Promise<boolean> {
    const trimmed = code.trim();
    if (/^\d{6}$/.test(trimmed)) {
      const secret = await openSecret(this.keys, this.sealCtx(user._id), { ciphertext: user.totp.secret.ciphertext, wrappedDek: user.totp.secret.wrappedDek });
      const step = verifyTotp(secret, trimmed, Date.now(), user.totp.lastStep ?? 0);
      if (step === null) return false;
      const r = await this.db.models.User.updateOne({ _id: user._id, $or: [{ 'totp.lastStep': { $lt: step } }, { 'totp.lastStep': null }, { 'totp.lastStep': { $exists: false } }] }, { $set: { 'totp.lastStep': step } });
      return r.modifiedCount === 1; // a concurrent reuse of the same code loses
    }
    const h = sha256(trimmed.toLowerCase().replace(/\s/g, ''));
    const r = await this.db.models.User.updateOne({ _id: user._id, recoveryHashes: h }, { $pull: { recoveryHashes: h } });
    return r.modifiedCount === 1;
  }
  async totpSetup(userId: string) {
    const user: any = await this.db.models.User.findById(userId).lean().exec();
    if (!user) throw new UnauthorizedException();
    if (user.totp?.enabledAt) throw new DomainError('totp_already_enabled', 'Two-factor is already on. Disable it first to re-enrol.', undefined, 409);
    const secret = newTotpSecret(); const sealed = await sealSecret(this.keys, this.sealCtx(userId), secret);
    await this.db.models.User.updateOne({ _id: userId }, { $set: { totpPending: { ciphertext: sealed.ciphertext, wrappedDek: sealed.wrappedDek, keyRef: sealed.keyRef } } });
    return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
  }
  async totpEnable(userId: string, code: string) {
    const user: any = await this.db.models.User.findById(userId).lean().exec();
    if (!user?.totpPending) throw new DomainError('totp_not_started', 'Start two-factor setup first', undefined, 409);
    const secret = await openSecret(this.keys, this.sealCtx(userId), { ciphertext: user.totpPending.ciphertext, wrappedDek: user.totpPending.wrappedDek });
    const step = verifyTotp(secret, code, Date.now(), 0);
    if (step === null) throw new DomainError('totp_invalid', 'That code did not match. Check your authenticator app clock.', undefined, 422);
    const recovery = Array.from({ length: 10 }, () => { const r = randomBytes(8).toString('hex'); return `${r.slice(0, 5)}-${r.slice(5, 10)}`; });
    await this.db.models.User.updateOne({ _id: userId }, { $set: { totp: { secret: user.totpPending, enabledAt: new Date(), lastStep: step }, recoveryHashes: recovery.map((c) => sha256(c)) }, $unset: { totpPending: 1 } });
    await this.audit.record({ action: 'auth.2fa_enabled', entity: 'user', entityId: userId });
    return { recoveryCodes: recovery }; // shown once
  }
  async totpDisable(userId: string, password: string, code: string) {
    const user: any = await this.db.models.User.findById(userId).lean().exec();
    if (!user?.totp?.enabledAt) throw new DomainError('totp_not_enabled', 'Two-factor is not on', undefined, 409);
    if (!(await argon2.verify(user.passwordHash, password)) || !(await this.checkSecondFactor(user, code))) throw new UnauthorizedException('Password or code is wrong');
    await this.db.models.User.updateOne({ _id: userId }, { $unset: { totp: 1, totpPending: 1, recoveryHashes: 1 } });
    await this.audit.record({ action: 'auth.2fa_disabled', entity: 'user', entityId: userId });
    return { ok: true };
  }

  // ---------- sessions ----------
  async logoutAll(userId: string) {
    await this.db.repos.refreshTokens.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await this.audit.record({ action: 'auth.logout_all', entity: 'user', entityId: userId });
    return { ok: true };
  }
  /** Changing the password signs out every other session. */
  async changePassword(userId: string, current: string, next: string) {
    const user: any = await this.db.models.User.findById(userId).lean().exec();
    if (!user || !(await argon2.verify(user.passwordHash, current))) throw new UnauthorizedException('Current password is wrong');
    await this.db.models.User.updateOne({ _id: userId }, { $set: { passwordHash: await argon2.hash(next, { type: argon2.argon2id }) } });
    await this.logoutAll(userId);
    await this.audit.record({ action: 'auth.password_changed', entity: 'user', entityId: userId });
    return { ok: true };
  }

  private async issue(userId: string, tenantId: string, role: Role, membershipId: string, family = randomBytes(8).toString('hex')): Promise<Tokens> {
    const accessToken = await this.jwt.signAsync({ sub: userId, tid: tenantId, role, mid: membershipId }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' });
    const refreshToken = newToken(tenantId);
    await this.db.repos.refreshTokens.create({ userId, family, tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + REFRESH_TTL_MS) });
    return { accessToken, refreshToken, tenantId, role };
  }

  /** Rotating refresh with reuse detection: replaying a rotated token revokes the whole family. */
  async refresh(token: string | undefined): Promise<Tokens> {
    const tenantId = token?.split('.')[0];
    if (!token || !tenantId || !/^[a-f0-9]{24}$/.test(tenantId)) throw new UnauthorizedException();
    return runWithTenant(tenantId, async () => {
      const rt: any = await this.db.repos.refreshTokens.findOne({ tokenHash: sha256(token) });
      if (!rt) throw new UnauthorizedException();
      if (rt.revokedAt) {
        await this.db.repos.refreshTokens.updateMany({ family: rt.family, revokedAt: null }, { $set: { revokedAt: new Date() } });
        await this.audit.record({ action: 'auth.refresh_reuse_detected', entity: 'user', entityId: String(rt.userId) });
        throw new UnauthorizedException();
      }
      if (rt.expiresAt < new Date()) throw new UnauthorizedException();
      const m: any = await this.db.repos.memberships.findOne({ userId: rt.userId, status: 'active' });
      if (!m) throw new UnauthorizedException();
      const [u, t]: any[] = await Promise.all([this.db.models.User.findById(rt.userId, { status: 1 }).lean().exec(), this.db.models.Tenant.findById(tenantId, { status: 1 }).lean().exec()]);
      if (!u || u.status !== 'active' || (t?.status && t.status !== 'active')) throw new UnauthorizedException(); // disabled users and suspended workspaces cannot mint new tokens
      const claimed = await this.db.repos.refreshTokens.updateOne({ _id: rt._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
      if (claimed.modifiedCount !== 1) throw new UnauthorizedException(); // lost a race
      return this.issue(String(rt.userId), tenantId, m.role, String(m._id), rt.family);
    });
  }

  async logout(token: string | undefined) {
    const tenantId = token?.split('.')[0];
    if (!token || !tenantId || !/^[a-f0-9]{24}$/.test(tenantId)) return;
    await runWithTenant(tenantId, async () => {
      const rt: any = await this.db.repos.refreshTokens.findOne({ tokenHash: sha256(token) });
      if (rt) await this.db.repos.refreshTokens.updateMany({ family: rt.family, revokedAt: null }, { $set: { revokedAt: new Date() } });
    });
  }

  /** Caller must already be inside the tenant context (interceptor). */
  async invite(by: { userId: string; role: Role }, i: { email: string; role: Exclude<Role, 'owner'>; teamId?: string }, tenantId: string) {
    if (ROLE_RANK[i.role] >= ROLE_RANK[by.role]) throw new ForbiddenException('Cannot invite a role at or above your own');
    await new BillingService(this.db).assertSeatAvailable(); // open invitations hold a seat
    const token = newToken(tenantId);
    await this.db.repos.invitations.create({
      email: i.email.toLowerCase(), role: i.role, teamId: i.teamId, tokenHash: sha256(token),
      invitedBy: by.userId, expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    });
    await this.audit.record({ action: 'user.invited', entity: 'invitation', meta: { email: i.email, role: i.role } });
    return { inviteToken: token }; // delivered as a link by the email connector in a later phase
  }

  async acceptInvitation(token: string, i: { name: string; password: string }): Promise<Tokens> {
    const tenantId = token.split('.')[0];
    if (!/^[a-f0-9]{24}$/.test(tenantId)) throw new BadRequestException('Invalid invitation');
    return runWithTenant(tenantId, () => withTransaction(this.db.conn, async (session) => {
      const inv: any = await this.db.repos.invitations.findOne({ tokenHash: sha256(token) });
      if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) throw new BadRequestException('Invalid or expired invitation');
      const { User } = this.db.models;
      let user: any = await runAsSystem('auth.acceptInvitation', () => User.findOne({ email: inv.email }).session(session).exec());
      if (!user) {
        const passwordHash = await argon2.hash(i.password, { type: argon2.argon2id });
        [user] = await User.create([{ email: inv.email, passwordHash, name: i.name }], { session });
      }
      const m = await this.db.repos.memberships.create({ userId: user._id, role: inv.role, teamId: inv.teamId });
      await this.db.repos.invitations.updateOne({ _id: inv._id }, { $set: { acceptedAt: new Date() } });
      await this.audit.record({ action: 'user.joined', entity: 'user', entityId: String(user._id) });
      return this.issue(String(user._id), tenantId, inv.role, String(m._id));
    }));
  }
}
