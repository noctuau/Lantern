/**
 * Telnet session for MUD/MUSH servers.
 *
 * Handles option negotiation, MCCP2 (zlib) decompression, GMCP, TTYPE/MTTS,
 * NAWS, ECHO (password masking) and EOR/GA prompt markers. Emits decoded text.
 */
import { Socket } from 'node:net';
import { EventEmitter } from 'node:events';
import zlib from 'node:zlib';

export const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250;
export const GA = 249, SE = 240, EOR = 239;

export const OPT = {
  ECHO: 1, SGA: 3, TTYPE: 24, EOR: 25, NAWS: 31, CHARSET: 42,
  MSDP: 69, MSSP: 70, MCCP1: 85, MCCP2: 86, MSP: 90, MXP: 91, ATCP: 200, GMCP: 201,
} as const;

export interface TelnetOptions {
  host: string;
  port: number;
  encoding?: string;      // 'utf-8' | 'latin1'
  termType?: string;      // reported via TTYPE
  width?: number;
  height?: number;
  gmcpHello?: Record<string, string>;
  gmcpSupports?: string[];
}

export type TelnetStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

type ParseState = 'data' | 'iac' | 'will' | 'wont' | 'do' | 'dont' | 'sb' | 'sbiac';

export class TelnetSession extends EventEmitter {
  private sock: Socket | null = null;
  private inflater: zlib.Inflate | null = null;
  private decoder: TextDecoder;
  private state: ParseState = 'data';
  private sbBuf: number[] = [];
  private textBuf: number[] = [];
  private ttypeIndex = 0;
  private opts: TelnetOptions;
  private width: number;
  private height: number;
  private nawsEnabled = false;
  serverEcho = false;      // true while the server has taken over echo (password entry)
  compressed = false;
  gmcpEnabled = false;
  bytesIn = 0;

  constructor(opts: TelnetOptions) {
    super();
    this.opts = opts;
    this.width = opts.width ?? 100;
    this.height = opts.height ?? 40;
    this.decoder = new TextDecoder(opts.encoding || 'utf-8', { fatal: false });
  }

  connect() {
    this.emit('status', 'connecting' as TelnetStatus);
    this.sock = new Socket();
    this.sock.setNoDelay(true);
    this.sock.setKeepAlive(true, 30_000);
    this.sock.on('connect', () => this.emit('status', 'connected' as TelnetStatus));
    this.sock.on('data', (chunk: Buffer) => this.onRaw(chunk));
    this.sock.on('close', () => {
      this.flushText();
      this.emit('status', 'disconnected' as TelnetStatus);
      this.cleanup();
    });
    this.sock.on('error', (err: Error) => this.emit('status', 'error' as TelnetStatus, err.message));
    this.sock.connect(this.opts.port, this.opts.host);
  }

  disconnect() {
    this.sock?.end();
    this.sock?.destroy();
  }

  /** Send a line of user input (CR LF appended). */
  sendLine(text: string) {
    this.sendRaw(this.encode(text + '\r\n'));
  }

  sendRaw(buf: Buffer) {
    if (!this.sock || this.sock.destroyed) return;
    const out: number[] = [];
    for (const b of buf) { if (b === IAC) out.push(IAC); out.push(b); }
    this.sock.write(Buffer.from(out));
  }

  sendGmcp(pkg: string, data?: unknown) {
    if (!this.gmcpEnabled) return;
    const payload = data === undefined ? pkg : `${pkg} ${JSON.stringify(data)}`;
    this.sendSub(OPT.GMCP, Buffer.from(payload, 'utf-8'));
  }

  resize(width: number, height: number) {
    this.width = width; this.height = height;
    if (this.nawsEnabled) this.sendNaws();
  }

  private encode(text: string): Buffer {
    const enc = (this.opts.encoding || 'utf-8').toLowerCase();
    if (enc === 'utf-8' || enc === 'utf8') return Buffer.from(text, 'utf-8');
    return Buffer.from(text, 'latin1');
  }

  private cleanup() {
    this.inflater?.close();
    this.inflater = null;
    this.compressed = false;
    this.sock = null;
  }

  private onRaw(chunk: Buffer) {
    this.bytesIn += chunk.length;
    if (this.compressed && this.inflater) {
      this.inflater.write(chunk);
    } else {
      this.parse(chunk);
    }
  }

  private startCompression() {
    this.compressed = true;
    this.inflater = zlib.createInflate();
    this.inflater.on('data', (d: Buffer) => this.parse(d));
    this.inflater.on('error', (e: Error) => {
      this.emit('info', `MCCP decompression error: ${e.message}`);
      this.compressed = false;
    });
    this.emit('info', 'MCCP2 compression enabled');
  }

  private parse(buf: Buffer) {
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      switch (this.state) {
        case 'data':
          if (b === IAC) this.state = 'iac';
          else this.textBuf.push(b);
          break;
        case 'iac':
          switch (b) {
            case IAC: this.textBuf.push(IAC); this.state = 'data'; break;
            case WILL: this.state = 'will'; break;
            case WONT: this.state = 'wont'; break;
            case DO: this.state = 'do'; break;
            case DONT: this.state = 'dont'; break;
            case SB: this.state = 'sb'; this.sbBuf = []; break;
            case GA: case EOR:
              this.flushText();
              this.emit('prompt');
              this.state = 'data';
              break;
            default: this.state = 'data';
          }
          break;
        case 'will': this.onWill(b); this.state = 'data'; break;
        case 'wont': this.onWont(b); this.state = 'data'; break;
        case 'do': this.onDo(b); this.state = 'data'; break;
        case 'dont': this.state = 'data'; break;
        case 'sb':
          if (b === IAC) this.state = 'sbiac';
          else this.sbBuf.push(b);
          break;
        case 'sbiac':
          if (b === IAC) { this.sbBuf.push(IAC); this.state = 'sb'; }
          else if (b === SE) {
            this.onSub(this.sbBuf);
            this.state = 'data';
            // MCCP2: everything after SB MCCP2 IAC SE is zlib-compressed.
            if (this.sbBuf[0] === OPT.MCCP2 && !this.compressed) {
              this.flushText();
              this.startCompression();
              const rest = buf.subarray(i + 1);
              if (rest.length) this.inflater!.write(rest);
              return;
            }
          } else { this.state = 'sb'; }
          break;
      }
    }
    this.flushText();
  }

  private flushText() {
    if (!this.textBuf.length) return;
    const bytes = Uint8Array.from(this.textBuf);
    this.textBuf = [];
    const text = this.decoder.decode(bytes, { stream: true });
    if (text) this.emit('text', text);
  }

  private cmd(code: number, opt: number) {
    this.sock?.write(Buffer.from([IAC, code, opt]));
  }

  private sendSub(opt: number, payload: Buffer) {
    const out: number[] = [IAC, SB, opt];
    for (const b of payload) { if (b === IAC) out.push(IAC); out.push(b); }
    out.push(IAC, SE);
    this.sock?.write(Buffer.from(out));
  }

  private onWill(opt: number) {
    switch (opt) {
      case OPT.ECHO:
        this.serverEcho = true; this.emit('echo', false); this.cmd(DO, opt); break;
      case OPT.SGA: case OPT.EOR: case OPT.MCCP2:
        this.cmd(DO, opt); break;
      case OPT.GMCP:
        this.gmcpEnabled = true;
        this.cmd(DO, opt);
        this.sendGmcp('Core.Hello', this.opts.gmcpHello ?? { client: 'Lantern', version: '0.1.0' });
        this.sendGmcp('Core.Supports.Set', this.opts.gmcpSupports ?? ['Char 1', 'Char.Vitals 1', 'Room 1', 'Comm 1']);
        break;
      default: this.cmd(DONT, opt);
    }
  }

  private onWont(opt: number) {
    if (opt === OPT.ECHO) { this.serverEcho = false; this.emit('echo', true); this.cmd(DONT, opt); }
    else if (opt === OPT.MCCP2) { this.cmd(DONT, opt); }
  }

  private onDo(opt: number) {
    switch (opt) {
      case OPT.TTYPE: this.cmd(WILL, opt); break;
      case OPT.NAWS: this.nawsEnabled = true; this.cmd(WILL, opt); this.sendNaws(); break;
      case OPT.SGA: this.cmd(WILL, opt); break;
      default: this.cmd(WONT, opt);
    }
  }

  private sendNaws() {
    const w = this.width, h = this.height;
    this.sendSub(OPT.NAWS, Buffer.from([w >> 8, w & 0xff, h >> 8, h & 0xff]));
  }

  private onSub(data: number[]) {
    const opt = data[0];
    const body = data.slice(1);
    if (opt === OPT.TTYPE && body[0] === 1 /* SEND */) {
      // MTTS cycle: client name, then ANSI, then capability bitmask (ANSI+UTF-8+256col+truecolor).
      const names = [(this.opts.termType ?? 'LANTERN').toUpperCase(), 'ANSI', 'MTTS 269'];
      const name = names[Math.min(this.ttypeIndex, names.length - 1)];
      this.ttypeIndex++;
      this.sendSub(OPT.TTYPE, Buffer.from([0 /* IS */, ...Buffer.from(name, 'ascii')]));
    } else if (opt === OPT.GMCP) {
      const str = Buffer.from(body).toString('utf-8');
      const sp = str.indexOf(' ');
      const pkg = sp === -1 ? str : str.slice(0, sp);
      let payload: unknown = null;
      if (sp !== -1) { try { payload = JSON.parse(str.slice(sp + 1)); } catch { payload = str.slice(sp + 1); } }
      this.emit('gmcp', pkg, payload);
    } else if (opt === OPT.MSSP) {
      this.emit('mssp', Buffer.from(body).toString('latin1'));
    }
  }
}
