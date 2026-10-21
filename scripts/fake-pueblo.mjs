// A tiny Pueblo-enhanced "game" for smoke tests: announces Pueblo, waits for PUEBLOCLIENT,
// switches to HTML mode and sends formatted lines. No login, no real game.
//
//   node scripts/fake-pueblo.mjs [port]            (default 4100)
//   LANTERN_SMOKE="127.0.0.1|4100|C:\path\out.png" npx electron .
//
// Every command it receives after the handshake is echoed back as a formatted "You say" line,
// so the smoke run's automatic `look` also produces an italic line.
import net from 'node:net';

const port = Number(process.argv[2] ?? 4100);

const server = net.createServer((sock) => {
  let html = false;
  let buf = '';
  const send = (s) => sock.write(s);
  send('Welcome to the Fake Pueblo Hall.\r\n');
  send('This world is Pueblo 1.10 enhanced.\r\n');
  send('Type anything; waiting for PUEBLOCLIENT...\r\n');

  sock.on('data', (d) => {
    buf += d.toString('latin1');
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      // Telnet negotiation bytes are not expected (we never offer any), but strip IAC sequences anyway.
      const cmd = line.replace(/\xff[\xfb-\xfe]./g, '').replace(/\xff\xff/g, '\xff');
      if (!html && /^PUEBLOCLIENT/i.test(cmd)) {
        html = true;
        send('</xch_mudtext><img xch_mode=html>');
        send('You say, "<i>test</i>"<br>\r\n');
        send('Juliet smiles. "<b>Bold</b>, <i>italic</i> and <u>underlined</u>, all at once."<br>\r\n');
        send('<font color="#ff8700">Amber</font> and <font color=cornflowerblue>blue</font> and <font color=red>red</font> text; &lt;3 &amp; a &lt; b stay literal.<br>\r\n');
        send('\x1b[32mGreen ANSI with <i>Pueblo italics</i> inside\x1b[0m.<br>\r\n');
        send('Read more at <a href="https://havenrpg.net">the Haven site</a>.<br>\r\n');
        send('<xch_alert>An alert tag</xch_alert> and a <send href="look">send tag</send> are dropped.<br>\r\n');
        send('The <i>sp');
        setTimeout(() => send('lit</i> tag arrived in two packets.<br>\r\n'), 150);
        continue;
      }
      if (html) send(`You say, "<i>${cmd.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</i>"<br>\r\n`);
      else send(`${cmd}? Nothing happens.\r\n`);
    }
  });
  sock.on('error', () => {});
});

server.listen(port, '127.0.0.1', () => console.log(`fake Pueblo game on 127.0.0.1:${port}`));
