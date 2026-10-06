import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { DomainError } from '@leaddesk/domain';
import { TENANT_DB, type RateStore } from '@leaddesk/platform';
import type { TenantDb } from '@leaddesk/db';
import { AuditService } from '../audit/audit.service';
import { MembershipCache } from '../common/guards';
import { RATE_STORE } from '../hardening/hardening.module';

export interface StoredPasskey { id: string; publicKey: string; counter: number; transports?: string[]; name: string; createdAt: Date; lastUsedAt?: Date; deviceType?: string; backedUp?: boolean }
const CHALLENGE_TTL_S = 300; const MAX_PASSKEYS = 10;
const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');

/**
 * Passkeys (WebAuthn) as a second factor next to the password. Challenges are signed, expire after five minutes and are single use.
 * Only "none" attestation is requested: we do not need to know the authenticator model, only that the same device signs later.
 */
@Injectable()
export class PasskeyService {
  constructor(@Inject(TENANT_DB) private readonly db: TenantDb, private readonly jwt: JwtService, @Inject(RATE_STORE) private readonly rates: RateStore, private readonly audit: AuditService, private readonly members: MembershipCache) {}

  /** The relying party must match the browser origin exactly; set WEBAUTHN_ORIGIN / WEBAUTHN_RP_ID if the app is served from a different host than PUBLIC_APP_URL. */
  rp() {
    const origin = (process.env.WEBAUTHN_ORIGIN ?? process.env.PUBLIC_APP_URL ?? 'http://localhost:3400').replace(/\/$/, '');
    return { origin, id: process.env.WEBAUTHN_RP_ID ?? new URL(origin).hostname, name: 'LeadDesk' };
  }
  private async token(purpose: 'reg' | 'auth', userId: string, challenge: string) {
    return this.jwt.signAsync({ ch: challenge, p: purpose, u: userId, n: randomBytes(12).toString('base64url') }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: CHALLENGE_TTL_S });
  }
  /** Verifies the signed challenge and spends it (a response can be replayed neither within nor after its lifetime). */
  private async open(purpose: 'reg' | 'auth', userId: string, token: string): Promise<string> {
    let p: any; try { p = await this.jwt.verifyAsync(token, { secret: process.env.JWT_ACCESS_SECRET }); } catch { throw new BadRequestException('This passkey request expired. Start again.'); }
    if (p.p !== purpose || p.u !== userId) throw new BadRequestException('This passkey request does not belong to you');
    const hit = await this.rates.hit(`wa:${p.n}`, CHALLENGE_TTL_S * 1000);
    if (hit.count > 1) throw new BadRequestException('This passkey request was already used. Start again.');
    return p.ch as string;
  }
  private async user(userId: string): Promise<any> {
    const u: any = await this.db.models.User.findById(userId).lean().exec(); if (!u) throw new UnauthorizedException(); return u;
  }

  async registerOptions(userId: string) {
    const u = await this.user(userId); const list: StoredPasskey[] = u.passkeys ?? [];
    if (list.length >= MAX_PASSKEYS) throw new DomainError('limit_reached', `You can register up to ${MAX_PASSKEYS} passkeys`, undefined, 409);
    const rp = this.rp();
    const options = await generateRegistrationOptions({ rpName: rp.name, rpID: rp.id, userName: u.email, userDisplayName: u.name, userID: Buffer.from(String(u._id)), attestationType: 'none', excludeCredentials: list.map((k) => ({ id: k.id, transports: k.transports as any })), authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' } });
    return { options, challengeToken: await this.token('reg', userId, options.challenge) };
  }
  async registerVerify(userId: string, i: { challengeToken: string; response: RegistrationResponseJSON; name?: string }) {
    const challenge = await this.open('reg', userId, i.challengeToken); const rp = this.rp();
    let v; try { v = await verifyRegistrationResponse({ response: i.response, expectedChallenge: challenge, expectedOrigin: rp.origin, expectedRPID: rp.id, requireUserVerification: false }); }
    catch (e: any) { throw new DomainError('passkey_invalid', 'The passkey could not be verified', { reason: String(e?.message ?? e).slice(0, 160) }, 400); }
    if (!v.verified || !v.registrationInfo) throw new DomainError('passkey_invalid', 'The passkey could not be verified', undefined, 400);
    const c = v.registrationInfo.credential;
    const doc: StoredPasskey = { id: c.id, publicKey: b64u(c.publicKey), counter: c.counter, transports: c.transports as string[] | undefined, name: (i.name ?? '').trim().slice(0, 40) || 'Passkey', createdAt: new Date(), deviceType: v.registrationInfo.credentialDeviceType, backedUp: v.registrationInfo.credentialBackedUp };
    const r = await this.db.models.User.updateOne({ _id: userId, 'passkeys.id': { $ne: doc.id } }, { $push: { passkeys: doc } });
    if (r.modifiedCount !== 1) throw new DomainError('passkey_exists', 'This passkey is already registered', undefined, 409);
    this.members.clear();
    await this.audit.record({ action: 'auth.passkey_added', entity: 'user', entityId: userId });
    return this.list(userId);
  }
  async list(userId: string) { const u = await this.user(userId); return ((u.passkeys ?? []) as StoredPasskey[]).map((k) => ({ id: k.id, name: k.name, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt ?? null, deviceType: k.deviceType ?? null, backedUp: !!k.backedUp })); }
  async remove(userId: string, id: string, password: string) {
    const u = await this.user(userId);
    if (!u.passwordHash || !(await argon2.verify(u.passwordHash, password))) throw new UnauthorizedException('Password is wrong');
    const r = await this.db.models.User.updateOne({ _id: userId, 'passkeys.id': id }, { $pull: { passkeys: { id } } });
    if (r.matchedCount !== 1) throw new DomainError('not_found', 'Passkey not found', undefined, 404);
    this.members.clear();
    await this.audit.record({ action: 'auth.passkey_removed', entity: 'user', entityId: userId });
    return this.list(userId);
  }

  /** Options the browser needs to sign in with one of the person's passkeys (returned after the password has been accepted). */
  async loginOptions(user: any) {
    const options = await generateAuthenticationOptions({ rpID: this.rp().id, allowCredentials: ((user.passkeys ?? []) as StoredPasskey[]).map((k) => ({ id: k.id, transports: k.transports as any })), userVerification: 'preferred' });
    return { options, challengeToken: await this.token('auth', String(user._id), options.challenge) };
  }
  async verifyLogin(user: any, i: { challengeToken: string; response: AuthenticationResponseJSON }): Promise<boolean> {
    let challenge: string; try { challenge = await this.open('auth', String(user._id), i.challengeToken); } catch { return false; }
    const key = ((user.passkeys ?? []) as StoredPasskey[]).find((k) => k.id === i.response?.id); if (!key) return false;
    const rp = this.rp();
    try {
      const v = await verifyAuthenticationResponse({ response: i.response, expectedChallenge: challenge, expectedOrigin: rp.origin, expectedRPID: rp.id, requireUserVerification: false, credential: { id: key.id, publicKey: Buffer.from(key.publicKey, 'base64url'), counter: key.counter, transports: key.transports as any } });
      if (!v.verified) return false;
      // a counter that does not move forward (when the authenticator uses one) means a cloned authenticator: refuse
      const r = await this.db.models.User.updateOne({ _id: user._id, passkeys: { $elemMatch: { id: key.id, counter: key.counter } } }, { $set: { 'passkeys.$.counter': v.authenticationInfo.newCounter, 'passkeys.$.lastUsedAt': new Date() } });
      return r.modifiedCount === 1;
    } catch { return false; }
  }
}
