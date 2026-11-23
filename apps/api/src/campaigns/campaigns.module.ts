import { Module, forwardRef } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { ChannelsModule } from '../channels/channels.module.js';
import { OpsModule } from '../ops/ops.module.js';
import { CampaignsController } from './campaigns.controller.js';
import { CampaignsService } from './campaigns.service.js';

@Module({
  imports: [DbModule, AuditModule, ChannelsModule, forwardRef(() => OpsModule)],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
