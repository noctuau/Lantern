// A tiny MXP-speaking "game" for smoke tests: offers MXP with IAC DO MXP, waits for IAC WILL MXP,
// then sends formatted lines in open and secure modes. No login, no real game.
//
//   node scripts/fake-mxp.mjs [port]              (default 4101)
//   LANTERN_SMOKE="127.0.0.1|4101|C:\path\out.png" npx electron .
//
// It also prints a "(Y/n)" prompt 500 ms after connecting and echoes every line it receives, so
// LANTERN_SMOKE_AUTO="y\nlook" shows whether "Send on connect" lines land after the prompt.
import net from 'node:net';

const port = Number(process.argv[2] ?? 4101);
const IAC = 255, WILL = 251, WONT = 252, DO = 253, DONT = 254, SB = 250, SE = 240, MXP = 91;
const ESC = '\x1b';

const server = net.createServer((sock) => {
  let mxp = false;
  let buf = Buffer.alloc(0);
  const send = (s) => sock.write(s, 'latin1');
  sock.write(Buffer.from([IAC, DO, MXP]));
  // Like Haven: nothing readable for a moment, then the banner and a question in one packet.
  setTimeout(() => send('Welcome to the Fake MXP Hall.\r\nWould you like colour? (Y/n) '), 500);

  const formatted = () => {
    send(`${ESC}[1z<VERSION>`);
    send(`${ESC}[1z<SUPPORT>`);
    send(`${ESC}[1z<!ELEMENT RName '<COLOR #ffd27f><B>' FLAG="RoomName">`);
    send(`${ESC}[1z<RName>The Fake Hall</RName>\r\n`);
    send('You say, "<I>test</I>"\r\n');
    send(`${ESC}[1z<B>Bold</B>, <I>italic</I>, <U>underlined</U>, <S>struck</S> and <H>high</H> on a secure line.\r\n`);
    send('<COLOR red>red</COLOR>, <C #ff8700 #303030>amber on grey</C>, <FONT color=cornflowerblue>blue</FONT> on an open line.\r\n');
    send(`${ESC}[1z<SEND href="look sign">a sign you could click</SEND> and <A href="https://havenrpg.net">the Haven site</A>.\r\n`);
    send(`${ESC}[2zLocked line: <I>not a tag</I> &amp; stays literal.\r\n`);
    send('Open line: I <3 this, a < b, and <bogus>unknown tags</bogus> stay as text.\r\n');
    send(`${ESC}[32mGreen ANSI with <I>MXP italics</I> inside${ESC}[0m.\r\n`);
    send('Entities: &lt;b&gt; &amp; &quot;quoted&quot;&nbsp;done.\r\n');
    send('The <I>sp');
    setTimeout(() => send('lit</I> tag arrived in two packets.\r\n'), 150);
  };

  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    // Pull telnet commands out of the stream.
    const text = [];
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      if (b !== IAC) { text.push(b); continue; }
      const c = buf[i + 1];
      if (c === undefined) break;
      if (c === IAC) { text.push(IAC); i++; continue; }
      if (c === SB) { const end = buf.indexOf(Buffer.from([IAC, SE]), i); if (end === -1) break; i = end + 1; continue; }
      if (c === WILL || c === WONT || c === DO || c === DONT) {
        const opt = buf[i + 2];
        if (opt === undefined) break;
        if (opt === MXP && c === WILL && !mxp) { mxp = true; console.log('client WILL MXP'); setTimeout(formatted, 700); }   // after the banner
        if (opt === MXP && c === WONT) console.log('client WONT MXP');
        i += 2; continue;
      }
      i++;
    }
    buf = Buffer.alloc(0);
    const str = Buffer.from(text).toString('latin1');
    for (const line of str.split(/\r?\n/).slice(0, -1)) {
      if (line.startsWith(`${ESC}[1z<`)) { console.log('client replied:', line.slice(4)); continue; }
      console.log('received:', JSON.stringify(line));
      send(mxp ? `You say, "<I>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</I>"\r\n` : `You typed: ${line}\r\n`);
    }
  });
  sock.on('error', () => {});
});

server.listen(port, '127.0.0.1', () => console.log(`fake MXP game on 127.0.0.1:${port}`));
