import { Module } from '@nestjs/common';
import { LeadsModule } from '../../leads/leads.module.js';
import { GoogleSheetsController } from './google-sheets.controller.js';
import { GoogleSheetsService } from './google-sheets.service.js';

@Module({
  imports: [LeadsModule],
  controllers: [GoogleSheetsController],
  providers: [GoogleSheetsService],
  exports: [GoogleSheetsService],
})
export class GoogleSheetsModule {}
