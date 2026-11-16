import { Module } from '@nestjs/common';
import { ScoringModule } from '../ai/scoring/scoring.module.js';
import { LeadImportService } from './lead-import.service.js';
import { LeadsController } from './leads.controller.js';
import { LeadsService } from './leads.service.js';

@Module({ imports: [ScoringModule], controllers: [LeadsController], providers: [LeadsService, LeadImportService], exports: [LeadsService] })
export class LeadsModule {}
