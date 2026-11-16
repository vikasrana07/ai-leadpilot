import { Controller, Get, Inject, Module, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../common/decorators.js';
import { DbService } from '../db/db.module.js';

@Controller('health')
class HealthController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  @Public()
  @Get()
  live() { return { status: 'ok' }; }

  @Public()
  @Get('ready')
  async ready() {
    try { await this.db.prisma.$queryRaw`SELECT 1`; } catch { throw new ServiceUnavailableException({ code: 'db_unavailable', message: 'Database unavailable' }); }
    return { status: 'ready' };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
