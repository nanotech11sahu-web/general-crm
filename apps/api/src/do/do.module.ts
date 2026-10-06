import { Body, Controller, ForbiddenException, Get, Inject, Injectable, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { DoService } from '@leaddesk/domain';
import { TENANT_DB } from '@leaddesk/platform';
import type { TenantDb } from '@leaddesk/db';
import { can } from '@leaddesk/shared';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, RequirePermission } from '../common/guards';
import { ScopeService } from '../common/scope.service';
import { LeadsModule } from '../leads/leads.module';

class NextDto {
  @IsDateString() dueAt!: string;
  @IsString() @MinLength(1) @MaxLength(500) contextNote!: string;
  @IsOptional() @IsIn(['call', 'whatsapp', 'sms', 'visit', 'other']) type?: 'call' | 'whatsapp' | 'sms' | 'visit' | 'other';
}
class CreateTaskDto extends NextDto { @IsString() leadId!: string; @IsOptional() @IsString() assigneeId?: string }
class PatchTaskDto {
  @IsIn(['complete', 'reschedule', 'cancel']) action!: 'complete' | 'reschedule' | 'cancel';
  @IsOptional() @IsDateString() dueAt?: string;
  @IsOptional() @IsString() @MaxLength(500) contextNote?: string;
}
class DialDto { @IsString() leadId!: string }
class EndCallDto { @IsOptional() @IsNumber() @Min(0) @Max(4 * 3600) durationS?: number }
class OutcomeDto {
  @IsString() outcomeId!: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsString() callSessionId?: string;
  @IsOptional() @IsString() taskId?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(4 * 3600) durationS?: number;
  @IsOptional() next?: NextDto;
  @IsOptional() @IsString() statusId?: string;
  @IsOptional() @IsString() lostReasonId?: string;
}

@Injectable()
export class DoFacade {
  readonly svc: DoService;
  constructor(@Inject(TENANT_DB) readonly db: TenantDb, readonly scope: ScopeService) { this.svc = new DoService(db); }

  async lead(u: AuthUser, id: string) {
    const l: any = await this.svc.getLead(id);
    await this.scope.assertVisible(u, l);
    return l;
  }
  /** Agents act on their own tasks; managers+ on anyone's. */
  async task(u: AuthUser, id: string) {
    const t: any = await this.svc.getTask(id);
    if (String(t.assigneeId) !== u.userId && !can(u.role, 'leads.reassign')) throw new ForbiddenException('Not your task');
    return t;
  }
}

@Controller('v1')
export class DoController {
  constructor(private readonly f: DoFacade) {}

  @Get('outcomes') @RequirePermission('leads.read')
  outcomes() { return this.f.db.repos.outcomes.find({ active: true }, { sort: { _id: 1 } }); }

  /** The agent's ordered work list. Every item says why it is there. */
  @Get('do/queue') @RequirePermission('leads.read')
  queue(@CurrentUser() u: AuthUser, @Query('limit') limit?: string) { return this.f.svc.queue(u.userId, { limit: limit ? Number(limit) : undefined }); }

  @Post('tasks') @RequirePermission('leads.write')
  async createTask(@CurrentUser() u: AuthUser, @Body() b: CreateTaskDto) {
    await this.f.lead(u, b.leadId);
    if (b.assigneeId && b.assigneeId !== u.userId && !can(u.role, 'leads.reassign')) throw new ForbiddenException('Only managers can assign tasks to others');
    return this.f.svc.createTask({ leadId: b.leadId, assigneeId: b.assigneeId, next: b });
  }

  @Get('tasks') @RequirePermission('leads.read')
  async tasks(@CurrentUser() u: AuthUser, @Query('status') status?: string, @Query('leadId') leadId?: string, @Query('assigneeId') assigneeId?: string) {
    const who = can(u.role, 'leads.reassign') ? assigneeId : u.userId; // agents only ever list their own
    if (leadId) await this.f.lead(u, leadId);
    return this.f.svc.listTasks({ assigneeId: who, leadId, status });
  }

  @Patch('tasks/:id') @RequirePermission('leads.write')
  async patchTask(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: PatchTaskDto) {
    await this.f.task(u, id);
    if (b.action === 'complete') return this.f.svc.completeTask(id);
    if (b.action === 'cancel') { await this.f.svc.cancelTask(id); return { ok: true }; }
    return this.f.svc.rescheduleTask(id, { dueAt: b.dueAt!, contextNote: b.contextNote });
  }

  @Post('calls') @RequirePermission('leads.write')
  async dial(@CurrentUser() u: AuthUser, @Body() b: DialDto) { await this.f.lead(u, b.leadId); return this.f.svc.startCall(b.leadId); }

  @Post('calls/:id/end') @RequirePermission('leads.write')
  end(@Param('id') id: string, @Body() b: EndCallDto) { return this.f.svc.endCall(id, b); }

  @Post('calls/:id/skip-outcome') @RequirePermission('leads.write')
  skip(@Param('id') id: string) { return this.f.svc.skipOutcome(id); }

  @Post('leads/:id/outcome') @RequirePermission('leads.write')
  async outcome(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: OutcomeDto) {
    await this.f.lead(u, id);
    return this.f.svc.logOutcome({ leadId: id, ...b });
  }
}

@Module({ imports: [LeadsModule], controllers: [DoController], providers: [DoFacade] })
export class DoModule {}
