// Unit tests for image-link detection (src/lib/lightbox.ts): direct image URLs are recognised even
// with CDN query strings / fragments, while pages and non-image links are not. Run:
//   node scripts/test-lightbox.mjs
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

await build({ entryPoints: ['src/lib/lightbox.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/lightbox-test.mjs', logLevel: 'silent' });
const { isImageUrl } = await import(pathToFileURL('dist-electron/lightbox-test.mjs').href);

let n = 0;
const ok = (msg) => { n++; if (process.env.V) console.log('ok', msg); };
const yes = (u) => { assert.equal(isImageUrl(u), true, `should match: ${u}`); ok(u); };
const no = (u) => { assert.equal(isImageUrl(u), false, `should NOT match: ${u}`); ok(u); };

// plain direct images, each extension
yes('https://example.com/cat.png');
yes('https://example.com/cat.jpg');
yes('https://example.com/cat.jpeg');
yes('https://example.com/cat.gif');
yes('https://example.com/cat.webp');
yes('https://example.com/pic.bmp');
yes('https://example.com/logo.svg');
yes('https://example.com/shot.avif');

// case-insensitive extension
yes('https://example.com/CAT.PNG');
yes('https://example.com/Photo.JPeG');

// CDN links hang a query string (and sometimes a fragment) off the end — strip before the check
yes('https://cdn.discordapp.com/attachments/1/2/portrait.png?ex=abc&is=def&hm=0123');
yes('https://i.imgur.com/abcd.jpg?1');
yes('https://example.com/map.webp#zoomed');
yes('https://example.com/a.png?v=2#top');

// http too (linkify only hands us http(s); the lightbox itself handles a load failure)
yes('http://old.example.com/sprite.gif');

// not images: pages, album links, other files
no('https://imgur.com/gallery/abcd');       // a page, not the image
no('https://example.com/');
no('https://havenrpg.net/news');
no('https://example.com/report.pdf');
no('https://example.com/song.mp3');
no('https://example.com/pngtext');           // no dot before "png"
no('https://example.com/image.png.html');    // real extension is .html
no('https://example.com/photos?type=png');   // "png" only in the query, not the path

console.log(`lightbox: ${n} assertions passed`);
