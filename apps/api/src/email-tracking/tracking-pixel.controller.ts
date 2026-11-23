import {
  Controller,
  Get,
  Inject,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators.js';
import { EmailTrackingService } from './email-tracking.service.js';

// 1x1 transparent GIF (43 bytes)
const TRANSPARENT_GIF_BUFFER = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

@Controller('track')
export class TrackingPixelController {
  constructor(
    @Inject(EmailTrackingService) private readonly tracking: EmailTrackingService,
  ) {}

  /**
   * Transparent 1x1 pixel endpoint for email open tracking.
   * Returns cache-control no-store headers and increments email open count.
   */
  @Public()
  @SkipThrottle()
  @Get('open/:token')
  async open(
    @Param('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
    const ua = req.headers['user-agent'] as string | undefined;

    try {
      await this.tracking.recordOpenToken(token, ip, ua);
    } catch {
      // Open pixel must never fail with an error visible to the email client
    }

    res.set({
      'Content-Type': 'image/gif',
      'Content-Length': TRANSPARENT_GIF_BUFFER.length.toString(),
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.end(TRANSPARENT_GIF_BUFFER);
  }

  /**
   * Link click redirect endpoint.
   * Verifies the cryptographic HMAC token, records the click event, and redirects to the target destination.
   */
  @Public()
  @SkipThrottle()
  @Get('click/:token')
  async click(
    @Param('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
    const ua = req.headers['user-agent'] as string | undefined;

    const destination = await this.tracking.recordClickToken(token, ip, ua);
    res.redirect(302, destination);
  }
}
