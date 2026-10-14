/**
 * Geometry for the Cambio mark: a C made of card backs laid in an arc, the
 * opening on the right, the last card in the arc turned to the mint accent.
 *
 * Everything that draws the mark (the React logo in both modes, the favicon,
 * every icon size and the share images) reads these numbers, so no two
 * renderings can drift apart. Units are a 100 by 100 tile.
 *
 * Card proportions and colors follow the real card back in globals.css:
 * height 1.42 times width, corner radius 0.16 times width, a fine 135 degree
 * hatch inset 7.5 percent inside a white frame, shown at 85 percent opacity.
 */
export const LOGO_COLORS = {
  tile: "#f4f4f6", // --color-tile, the card back
  hatch: "#1a1a1f", // the card back stripe
  accent: "#4ff0a8", // --color-accent
  ground: "#000000", // --color-bg, the icon tile behind the mark
} as const;

export const CARD_ASPECT = 1.42;
export const CARD_RADIUS = 0.16;
export const HATCH_INSET = 0.075;
export const HATCH_RADIUS = 0.55;
export const HATCH_OPACITY = 0.85;
/** Stripe pitch and width relative to card width, taken from a 64px table tile (5.4px and 1.2px). */
export const HATCH_PITCH = 0.084;
export const HATCH_STRIPE = 0.019;
/** Corner radius of the rounded icon tile. */
export const TILE_RADIUS = 22;

export type LogoCount = 6 | 8;

interface Layout { radius: number; width: number; cx: number; cy: number; start: number; sweep: number; gap: number }

const LAYOUTS: Record<LogoCount, Layout> = {
  6: { radius: 28, width: 21, cx: 52, cy: 50, start: -58, sweep: 236, gap: 2.4 },
  8: { radius: 29, width: 16.5, cx: 52, cy: 50, start: -56, sweep: 248, gap: 2.2 },
};

export interface LogoCard {
  /** Center of the card in tile units. */
  x: number;
  y: number;
  /** Rotation in degrees, the card lying along the arc. */
  rotate: number;
  accent: boolean;
}

export interface LogoGeometry {
  count: LogoCount;
  width: number;
  height: number;
  radius: number;
  /** Dark outline drawn behind each card so overlapping cards stay distinct, standing in for the card shadow. */
  gap: number;
  cards: LogoCard[];
  /** Where the cards are dealt from in the animated mode: a deck at the center of the opening. */
  deck: { x: number; y: number; rotate: number };
}

export function logoGeometry(count: LogoCount): LogoGeometry {
  const l = LAYOUTS[count];
  const cards: LogoCard[] = [];
  for (let i = 0; i < count; i++) {
    const angle = l.start - i * (l.sweep / (count - 1));
    const rad = (angle * Math.PI) / 180;
    cards.push({
      x: round(l.cx + l.radius * Math.cos(rad)),
      y: round(l.cy + l.radius * Math.sin(rad)),
      rotate: round(angle),
      accent: i === count - 1,
    });
  }
  return { count, width: l.width, height: round(l.width * CARD_ASPECT), radius: round(l.width * CARD_RADIUS), gap: l.gap, cards, deck: { x: l.cx, y: l.cy, rotate: 0 } };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The mark as a standalone SVG document, for icons and share images.
 * `tile` draws the near black rounded tile behind it.
 */
export function logoSvg(count: LogoCount, { tile = true, id = "cambio" }: { tile?: boolean; id?: string } = {}): string {
  const g = logoGeometry(count);
  const { width: w, height: h } = g;
  const pitch = round(w * HATCH_PITCH);
  const stripe = round(w * HATCH_STRIPE);
  const ix = round(w * HATCH_INSET);
  const iy = round(h * HATCH_INSET);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">`,
    `<defs><pattern id="${id}-hatch" width="${pitch}" height="${pitch}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="${stripe}" height="${pitch}" fill="${LOGO_COLORS.hatch}"/></pattern></defs>`,
  ];
  if (tile) parts.push(`<rect width="100" height="100" rx="${TILE_RADIUS}" fill="${LOGO_COLORS.ground}"/>`);
  for (const c of g.cards) {
    parts.push(`<g transform="translate(${c.x} ${c.y}) rotate(${c.rotate})">`);
    parts.push(`<rect x="${-w / 2}" y="${round(-h / 2)}" width="${w}" height="${h}" rx="${g.radius}" fill="${c.accent ? LOGO_COLORS.accent : LOGO_COLORS.tile}" stroke="${LOGO_COLORS.ground}" stroke-width="${g.gap}" paint-order="stroke"/>`);
    if (!c.accent) parts.push(`<rect x="${round(-w / 2 + ix)}" y="${round(-h / 2 + iy)}" width="${round(w - 2 * ix)}" height="${round(h - 2 * iy)}" rx="${round(g.radius * HATCH_RADIUS)}" fill="url(#${id}-hatch)" opacity="${HATCH_OPACITY}"/>`);
    parts.push(`</g>`);
  }
  parts.push(`</svg>`);
  return parts.join("");
}
