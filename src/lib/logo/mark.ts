/**
 * Geometry for the Cambio mark: a C made of eight card backs laid in an arc,
 * the opening on the right, overlapping like a spread. The arc is dealt from
 * its bottom end, around the left, to its top end, where the ace of spades
 * lies face up on top of the stack.
 *
 * Everything that draws the mark (the React logo in both modes, the favicon,
 * every icon size and the share images) reads these numbers, so no two
 * renderings can drift apart. Units are a 100 by 100 tile.
 *
 * Card proportions and colors follow the real cards in globals.css and
 * cards.tsx: height 1.42 times width, corner radius 0.16 times width, a fine
 * 135 degree hatch inset 7.5 percent inside a white frame at 85 percent
 * opacity, and a face with the rank at the top left and the suit at the
 * bottom left.
 */
export const LOGO_COLORS = {
  back: "#f4f4f6", // --color-tile, the card back
  hatch: "#1a1a1f", // the card back stripe
  face: "#f8f8f8", // --color-card
  ink: "#0a0a0a", // --color-card-ink
  ground: "#000000", // --color-bg, behind the mark and in the icon tile
} as const;

export const CARD_ASPECT = 1.42;
export const CARD_RADIUS = 0.16;
export const HATCH_INSET = 0.075;
export const HATCH_RADIUS = 0.55;
export const HATCH_OPACITY = 0.85;
/** Stripe pitch and width relative to card width, from a 64px table tile (5.4px and 1.2px). */
export const HATCH_PITCH = 0.084;
export const HATCH_STRIPE = 0.019;
/** The large face card's padding, rank and suit sizes relative to its width (10px, 24px and 20px on a 66px tile). */
export const FACE_PAD = 0.152;
export const FACE_RANK = 0.364;
export const FACE_SUIT = 0.303;
/** Corner radius of the rounded icon tile. */
export const TILE_RADIUS = 22;

export const LOGO_COUNT = 8;
const ARC = { radius: 29, width: 16.5, cx: 52, cy: 50, start: 56, sweep: 248, gap: 2.2 };

export interface LogoCard {
  /** Center of the card in tile units. */
  x: number;
  y: number;
  /** Rotation in degrees, the card lying along the arc. */
  rotate: number;
  /** The last card dealt: the ace of spades, face up, on top. */
  ace: boolean;
}

export interface LogoGeometry {
  width: number;
  height: number;
  radius: number;
  /** Dark outline around each card so overlapping cards stay distinct; it stands in for the card shadow, which black ground hides. */
  gap: number;
  /** In dealing order, which is also stacking order. */
  cards: LogoCard[];
  /** Where the animated mode deals from: the center of the C. */
  deck: { x: number; y: number };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
/** Same orientation either way round; keep the turn under half a circle so the ace reads upright. */
const upright = (deg: number) => ((deg + 540) % 360) - 180;

/** Axis aligned bounds of the cards, outlines included, for cards at the given centers. */
export function cardBounds(cards: readonly { x: number; y: number; rotate: number }[], width: number, height: number, gap: number) {
  const hw = width / 2 + gap / 2;
  const hh = height / 2 + gap / 2;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cards) {
    const r = (c.rotate * Math.PI) / 180;
    for (const [dx, dy] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
      const x = c.x + dx * Math.cos(r) - dy * Math.sin(r);
      const y = c.y + dx * Math.sin(r) + dy * Math.cos(r);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

/**
 * The arc is laid out, then shifted so the cards' visible shape, not the
 * arc's circle, is centered in the tile. Wherever the mark sits beside other
 * centered things, its ink is what lines up.
 */
export const LOGO: LogoGeometry = (() => {
  const height = round(ARC.width * CARD_ASPECT);
  const raw: LogoCard[] = [];
  for (let i = 0; i < LOGO_COUNT; i++) {
    const angle = ARC.start + i * (ARC.sweep / (LOGO_COUNT - 1));
    const rad = (angle * Math.PI) / 180;
    raw.push({
      x: ARC.cx + ARC.radius * Math.cos(rad),
      y: ARC.cy + ARC.radius * Math.sin(rad),
      rotate: round(upright(angle)),
      ace: i === LOGO_COUNT - 1,
    });
  }
  const box = cardBounds(raw, ARC.width, height, ARC.gap);
  const cards = raw.map((c) => ({ ...c, x: round(c.x + 50 - box.cx), y: round(c.y + 50 - box.cy) }));
  return { width: ARC.width, height, radius: round(ARC.width * CARD_RADIUS), gap: ARC.gap, cards, deck: { x: 50, y: 50 } };
})();

/** The font stack the face card uses (--font-sans), for the ace in standalone SVGs. */
const SANS = "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial, sans-serif";

/**
 * The mark as a standalone SVG document, for icons and share images.
 * `tile` draws the near black rounded tile behind it.
 */
export function logoSvg({ tile = true, id = "cambio" }: { tile?: boolean; id?: string } = {}): string {
  const { width: w, height: h, radius: r, gap } = LOGO;
  const pitch = round(w * HATCH_PITCH);
  const stripe = round(w * HATCH_STRIPE);
  const ix = round(w * HATCH_INSET);
  const iy = round(h * HATCH_INSET);
  const pad = round(w * FACE_PAD);
  const rank = round(w * FACE_RANK);
  const suit = round(w * FACE_SUIT);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">`,
    `<defs><pattern id="${id}-hatch" width="${pitch}" height="${pitch}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="${stripe}" height="${pitch}" fill="${LOGO_COLORS.hatch}"/></pattern></defs>`,
  ];
  if (tile) parts.push(`<rect width="100" height="100" rx="${TILE_RADIUS}" fill="${LOGO_COLORS.ground}"/>`);
  for (const c of LOGO.cards) {
    const left = round(-w / 2);
    const top = round(-h / 2);
    parts.push(`<g transform="translate(${c.x} ${c.y}) rotate(${c.rotate})">`);
    parts.push(`<rect x="${left}" y="${top}" width="${w}" height="${h}" rx="${r}" fill="${c.ace ? LOGO_COLORS.face : LOGO_COLORS.back}" stroke="${LOGO_COLORS.ground}" stroke-width="${gap}" paint-order="stroke"/>`);
    if (c.ace) {
      // Rank at the top left and suit at the bottom left, as FaceCard sets them.
      parts.push(`<text x="${round(left + pad)}" y="${round(top + pad + rank * 0.74)}" font-family="${SANS}" font-size="${rank}" font-weight="600" letter-spacing="${round(-rank * 0.02)}" fill="${LOGO_COLORS.ink}">A</text>`);
      parts.push(`<text x="${round(left + pad)}" y="${round(-top - pad - suit * 0.12)}" font-family="${SANS}" font-size="${suit}" fill="${LOGO_COLORS.ink}">♠</text>`);
    } else {
      parts.push(`<rect x="${round(left + ix)}" y="${round(top + iy)}" width="${round(w - 2 * ix)}" height="${round(h - 2 * iy)}" rx="${round(r * HATCH_RADIUS)}" fill="url(#${id}-hatch)" opacity="${HATCH_OPACITY}"/>`);
    }
    parts.push(`</g>`);
  }
  parts.push(`</svg>`);
  return parts.join("");
}
