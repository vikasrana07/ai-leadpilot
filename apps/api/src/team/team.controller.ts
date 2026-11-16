import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { changeMemberStatusSchema, changeRoleSchema, inviteSchema, type InviteInput } from '@leadpilot/validation';
import type { SystemRoleKey } from '@leadpilot/shared-types';
import { CurrentTenant, RequirePermissions } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { TeamService } from './team.service.js';

@Controller('team')
export class TeamController {
  constructor(@Inject(TeamService) private readonly team: TeamService) {}

  @Get('members') @RequirePermissions('team:read')
  members(@CurrentTenant() ctx: TenantRequestContext) { return this.team.listMembers(ctx); }

  @Get('invitations') @RequirePermissions('team:invite')
  invitations(@CurrentTenant() ctx: TenantRequestContext) { return this.team.listInvitations(ctx); }

  @Post('invitations') @HttpCode(201) @RequirePermissions('team:invite')
  invite(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(inviteSchema)) body: InviteInput) { return this.team.invite(ctx, body); }

  @Delete('invitations/:id') @HttpCode(204) @RequirePermissions('team:invite')
  revoke(@CurrentTenant() ctx: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.team.revokeInvitation(ctx, id); }

  @Patch('members/:id/role') @RequirePermissions('team:manage')
  role(@CurrentTenant() ctx: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(changeRoleSchema)) body: { roleKey: SystemRoleKey }) {
    return this.team.changeRole(ctx, id, body.roleKey);
  }

  @Patch('members/:id/status') @RequirePermissions('team:manage')
  status(@CurrentTenant() ctx: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(changeMemberStatusSchema)) body: { status: 'ACTIVE' | 'DEACTIVATED' }) {
    return this.team.changeStatus(ctx, id, body.status);
  }
}
