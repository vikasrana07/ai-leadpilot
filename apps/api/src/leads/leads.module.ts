import { Module } from '@nestjs/common';
import { LeadImportService } from './lead-import.service.js';
import { LeadsController } from './leads.controller.js';
import { LeadsService } from './leads.service.js';

@Module({ controllers: [LeadsController], providers: [LeadsService, LeadImportService], exports: [LeadsService] })
export class LeadsModule {}
