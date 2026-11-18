import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { alertSettingsSchema, DEFAULT_ALERT_SETTINGS, type AlertSettings } from '@leadpilot/validation';
import type { z } from 'zod';
import { CurrentAuth, NoTenant } from '../common/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DbService } from '../db/db.module.js';

/**
 * The signed-in person's own sound and desktop-alert settings. Personal (not per workspace) so the choice follows them across workspaces and
 * devices. The user id always comes from the session, never from the request, so nobody can read or change another person's settings.
 */
@NoTenant() @Controller('me/alert-settings')
export class AlertSettingsController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  @Get()
  async get(@CurrentAuth() a: AuthContext | undefined): Promise<AlertSettings> {
    const row = await this.db.prisma.userAlertSettings.findUnique({ where: { userId: (a as AuthContext).userId } });
    return row ? { soundEnabled: row.soundEnabled, soundVolume: row.soundVolume, desktopEnabled: row.desktopEnabled } : { ...DEFAULT_ALERT_SETTINGS };
  }

  @Put()
  async put(@CurrentAuth() a: AuthContext | undefined, @Body(new ZodPipe(alertSettingsSchema)) b: z.infer<typeof alertSettingsSchema>): Promise<AlertSettings> {
    const userId = (a as AuthContext).userId;
    await this.db.prisma.userAlertSettings.upsert({ where: { userId }, create: { userId, ...b }, update: b });
    return b;
  }
}
