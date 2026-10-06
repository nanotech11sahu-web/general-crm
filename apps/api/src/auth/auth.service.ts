import { ConflictException, Inject, Injectable, UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { runAsSystem, runWithTenant, withTransaction, type SystemOps, type TenantDb } from '@leaddesk/db';
import type { Role } from '@leaddesk/shared';
import { AuditService } from '../audit/audit.service';
import { SYSTEM_OPS, TENANT_DB } from '@leaddesk/platform';

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
      await this.audit.record({ action: 'tenant.signup', entity: 'tenant', entityId: tenantId });
      return this.issue(String(user._id), tenantId, 'owner', String(m._id));
    });
  }

  async login(i: { email: string; password: string; tenantId?: string }): Promise<Tokens> {
    const user: any = await this.sys.findUserByEmail(i.email);
    // verify against a dummy hash when the user is unknown to keep timing uniform
    const ok = user?.passwordHash ? await argon2.verify(user.passwordHash, i.password) : (await argon2.hash('x'), false);
    if (!user || !ok || user.status !== 'active') throw new UnauthorizedException('Invalid credentials');
    const memberships: any[] = await this.sys.listMemberships(user._id);
    const m = i.tenantId ? memberships.find((x) => String(x.tenantId) === i.tenantId) : memberships[0];
    if (!m) throw new UnauthorizedException('No active membership');
    return runWithTenant(String(m.tenantId), async () => {
      await this.audit.record({ action: 'auth.login', entity: 'user', entityId: String(user._id) });
      return this.issue(String(user._id), String(m.tenantId), m.role, String(m._id));
    });
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
