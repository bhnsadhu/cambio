/**
 * Regenerates every brand asset from the one logo geometry in
 * src/lib/logo/mark.ts, rasterized by the same Chromium the tests use.
 *
 *   npm run brand:assets
 *
 * Writes the favicon (ICO and SVG), the 16 and 32 pixel icons, the Apple
 * touch icon, the 192 and 512 pixel app icons, the 1200 by 630 share image,
 * a square GitHub social preview, and the logo used in the readme.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';
import { logoSvg } from '../src/lib/logo/mark.ts';

const SITE_HOST = 'cambio.bhanusadhu.com';
const HEADLINE = ['The memory card game,', 'live with friends.'];
const TAGLINE = 'One code. Your friends. Game on.';

const write = (path, data) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(`wrote ${path}`);
};

/** An ICO file holding PNG images, which every current browser reads. */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const sized = (svg, size) => svg.replace('<svg ', `<svg width="${size}" height="${size}" `);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function png(html, width, height, { transparent = false } = {}) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:${transparent ? 'transparent' : '#000'}}</style></head><body>${html}</body></html>`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width, height } });
}

const icon = (size) => png(sized(logoSvg(), size), size, size, { transparent: true });

// Favicon and icons.
const svg = logoSvg();
write('src/app/icon.svg', svg + '\n');
const [i16, i32] = [await icon(16), await icon(32)];
write('src/app/favicon.ico', ico([{ size: 16, data: i16 }, { size: 32, data: i32 }]));
write('src/app/icon1.png', i32);
write('src/app/icon2.png', i16);
write('src/app/apple-icon.png', await png(sized(logoSvg(), 180), 180, 180));
write('public/icons/icon-192.png', await icon(192));
write('public/icons/icon-512.png', await icon(512));
write('docs/brand/logo.svg', svg + '\n');

// Share image: the existing headline and tagline beside the mark, on the app's black.
const fonts = '<link rel="preconnect" href="https://fonts.gstatic.com"><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700&display=block" rel="stylesheet">';
// Single quoted, because these go inside double quoted style attributes.
const sans = "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial, sans-serif";
const display = `'Plus Jakarta Sans', ${sans}`;
const share = `${fonts}
<div style="position:relative;width:1200px;height:630px;background:#000;color:#fff;font-family:${sans}">
  <div style="position:absolute;left:72px;top:84px;display:flex;align-items:center;gap:14px">
    <div style="width:40px;height:40px">${sized(logoSvg({ tile: false, id: 'kicker' }), 40)}</div>
    <span style="color:#4ff0a8;font-size:21px;font-weight:600;letter-spacing:3px">LET’S PLAY</span>
  </div>
  <div style="position:absolute;left:68px;top:162px;font-family:${display};font-size:108px;font-weight:700;letter-spacing:-5px;line-height:1">Cambio</div>
  <div style="position:absolute;left:72px;top:292px;font-family:${display};font-size:38px;font-weight:600;letter-spacing:-0.8px;line-height:1.25">${HEADLINE.join('<br>')}</div>
  <div style="position:absolute;left:72px;top:412px;font-size:23px;color:#a6a6af">${TAGLINE}</div>
  <div style="position:absolute;left:72px;top:518px;display:flex;align-items:center;gap:13px;font-size:21px;color:#a6a6af"><span style="width:28px;height:3px;border-radius:2px;background:#4ff0a8"></span>${SITE_HOST}</div>
  <div style="position:absolute;left:690px;top:75px;width:480px;height:480px">${sized(logoSvg({ tile: false, id: 'hero' }), 480)}</div>
</div>`;
write('public/social/cambio-share.png', await png(share, 1200, 630));

// GitHub social preview, square: the mark over the name and headline.
const github = `${fonts}
<div style="width:1280px;height:1280px;background:#000;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:${sans}">
  <div style="width:560px;height:560px">${sized(logoSvg({ tile: false, id: 'gh' }), 560)}</div>
  <div style="margin-top:40px;font-family:${display};font-size:132px;font-weight:700;letter-spacing:-6px;line-height:1">Cambio</div>
  <div style="margin-top:28px;font-family:${display};font-size:44px;font-weight:600;letter-spacing:-0.8px;color:#fff">${HEADLINE.join(' ')}</div>
  <div style="margin-top:18px;font-size:30px;color:#a6a6af">${TAGLINE}</div>
</div>`;
write('docs/brand/github-social-preview.png', await png(github, 1280, 1280));

await browser.close();
