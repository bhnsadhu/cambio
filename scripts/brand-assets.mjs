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
import { LOGO, logoSvg } from '../src/lib/logo/mark.ts';

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

/** The cards' own outline, outlines included, so layouts align to the cards and not to the tile's padding. */
function markBounds() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const hw = LOGO.width / 2 + LOGO.gap / 2;
  const hh = LOGO.height / 2 + LOGO.gap / 2;
  for (const c of LOGO.cards) {
    const r = (c.rotate * Math.PI) / 180;
    for (const [dx, dy] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
      const x = c.x + dx * Math.cos(r) - dy * Math.sin(r);
      const y = c.y + dx * Math.sin(r) + dy * Math.cos(r);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The bare mark cropped to its cards, `height` pixels tall. */
function tightMark(height, id) {
  const b = markBounds();
  const width = Math.round((height * b.w) / b.h);
  const svg = logoSvg({ tile: false, id }).replace('viewBox="0 0 100 100"', `viewBox="${b.x} ${b.y} ${b.w} ${b.h}" width="${width}" height="${height}"`);
  return { svg, width, height };
}

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

// Share image: the mark on the left, its opening toward the name, headline and tagline,
// the pair centered as one group on the app's black.
const fonts = '<link rel="preconnect" href="https://fonts.gstatic.com"><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700&display=block" rel="stylesheet">';
// Single quoted, because these go inside double quoted style attributes.
const sans = "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial, sans-serif";
const display = `'Plus Jakarta Sans', ${sans}`;
const shareMark = tightMark(452, 'share');
const share = `${fonts}
<div style="width:1200px;height:630px;background:#000;color:#fff;font-family:${sans};display:flex;align-items:center;justify-content:center;gap:76px;padding-right:10px;box-sizing:border-box">
  <div style="width:${shareMark.width}px;height:${shareMark.height}px;flex:none">${shareMark.svg}</div>
  <div style="display:flex;flex-direction:column;align-items:flex-start;padding-top:4px">
    <div style="color:#4ff0a8;font-size:21px;font-weight:600;letter-spacing:3px;line-height:1">LET’S PLAY</div>
    <div style="margin-top:22px;margin-left:-4px;font-family:${display};font-size:108px;font-weight:700;letter-spacing:-5px;line-height:1">Cambio</div>
    <div style="margin-top:24px;font-family:${display};font-size:38px;font-weight:600;letter-spacing:-0.8px;line-height:1.25">${HEADLINE.join('<br>')}</div>
    <div style="margin-top:22px;font-size:23px;line-height:1.3;color:#a6a6af">${TAGLINE}</div>
  </div>
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
