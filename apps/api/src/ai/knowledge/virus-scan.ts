import net from 'node:net';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../common/tokens.js';
import type { Env } from '../../config/env.js';

export type ScanResult = { clean: true } | { clean: false; threat: string };
export class ScannerUnavailableError extends Error {}
export interface VirusScanner { scan(data: Buffer): Promise<ScanResult> }
export const VIRUS_SCANNER = Symbol('VIRUS_SCANNER');

/** Standard antivirus test string (EICAR). Harmless; every AV engine flags it. */
export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** ClamAV over its TCP `INSTREAM` protocol. Fails CLOSED: if the scanner cannot be reached the upload is refused. */
@Injectable()
export class ClamAvScanner implements VirusScanner {
  private readonly host: string; private readonly port: number;
  constructor(@Inject(ENV) env: Env) { this.host = env.CLAMAV_HOST; this.port = env.CLAMAV_PORT; }

  scan(data: Buffer): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: this.host, port: this.port });
      let out = '';
      const fail = (m: string) => { sock.destroy(); reject(new ScannerUnavailableError(m)); };
      sock.setTimeout(30_000, () => fail('Virus scanner timed out'));
      sock.on('error', (e) => fail(`Virus scanner unavailable: ${e.message}`));
      sock.on('data', (d) => { out += d.toString('utf8'); });
      sock.on('close', () => {
        const line = out.replace(/\0/g, '').trim();
        if (/OK$/.test(line)) resolve({ clean: true });
        else if (/FOUND$/.test(line)) resolve({ clean: false, threat: line.replace(/^stream:\s*/, '').replace(/\s*FOUND$/, '') });
        else reject(new ScannerUnavailableError(`Unexpected scanner response: ${line.slice(0, 80)}`));
      });
      sock.on('connect', () => {
        sock.write('zINSTREAM\0');
        for (let i = 0; i < data.length; i += 65536) { const chunk = data.subarray(i, i + 65536); const len = Buffer.alloc(4); len.writeUInt32BE(chunk.length); sock.write(len); sock.write(chunk); }
        sock.write(Buffer.alloc(4)); // zero-length chunk terminates the stream
      });
    });
  }
}

/** Dev/test stand-in: flags only the EICAR test string. Refused in production by env validation. */
@Injectable()
export class MockScanner implements VirusScanner {
  unavailable = false;
  async scan(data: Buffer): Promise<ScanResult> {
    if (this.unavailable) throw new ScannerUnavailableError('Virus scanner unavailable');
    return data.includes(Buffer.from(EICAR)) ? { clean: false, threat: 'Eicar-Test-Signature' } : { clean: true };
  }
}
