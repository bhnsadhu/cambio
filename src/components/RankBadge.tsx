import { standingFor } from "@/lib/social/rank";

const FINISHES = [
  { edge: "#8f939e", face: "#262830", light: "#c4c7d0" },
  { edge: "#bc8a61", face: "#3c2b23", light: "#edbf97" },
  { edge: "#b7c2d0", face: "#2c333e", light: "#edf2f8" },
  { edge: "#dab966", face: "#3e3420", light: "#ffe6a0" },
  { edge: "#98c9c5", face: "#233b3c", light: "#dcf9f3" },
  { edge: "#99bbec", face: "#27374f", light: "#e0efff" },
  { edge: "#4ff0a8", face: "#173b2c", light: "#d1ffe8" },
] as const;

interface RankBadgeProps {
  points: number;
  size?: number;
  className?: string;
  /** Hide the badge from assistive technology when adjacent text names the tier. */
  decorative?: boolean;
}

/** Small, shape-distinct insignia for the existing standing tiers. */
export function RankBadge({ points, size = 20, className = "", decorative = false }: RankBadgeProps) {
  const { tier, index } = standingFor(points);
  const finish = FINISHES[index];

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={`inline-block shrink-0 align-middle ${className}`}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : `${tier.name} rank`}
      aria-hidden={decorative || undefined}
      focusable="false"
      data-rank={tier.name}
    >
      {decorative ? null : <title>{tier.name} rank</title>}
      <g strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round">
        {index === 0 ? (
          <>
            <circle cx="12" cy="12" r="9" fill={finish.face} stroke={finish.edge} />
            <path d="m12 7 4 5-4 5-4-5Z" fill={finish.edge} />
            <path d="m12 7 4 5h-4Z" fill={finish.light} />
          </>
        ) : index <= 3 ? (
          <>
            <path d="M12 2.5 20 6v6c0 4-3.5 7.3-8 9.5C7.5 19.3 4 16 4 12V6Z" fill={finish.face} stroke={finish.edge} />
            <path d="m7 7 5-2 5 2" stroke={finish.light} opacity=".65" />
            {index === 1 ? (
              <path d="m8 11 4 3 4-3v3l-4 3-4-3Z" fill={finish.edge} />
            ) : index === 2 ? (
              <>
                <path d="m8 9 4 2.5L16 9v2.5L12 14l-4-2.5Z" fill={finish.light} />
                <path d="m8 14 4 2.5 4-2.5v2L12 19l-4-3Z" fill={finish.edge} />
              </>
            ) : (
              <path d="m12 7.7 1.55 3.2 3.55.5-2.55 2.5.6 3.5L12 15.75 8.85 17.4l.6-3.5-2.55-2.5 3.55-.5Z" fill={finish.light} />
            )}
          </>
        ) : index === 4 ? (
          <>
            <path d="m12 2 8.5 5v10L12 22l-8.5-5V7Z" fill={finish.face} stroke={finish.edge} />
            <path d="m12 6 5 6-5 6-5-6Z" fill={finish.edge} />
            <path d="m12 6 5 6h-5Z" fill={finish.light} />
            <path d="M7 12h5v6" stroke={finish.light} opacity=".65" />
          </>
        ) : index === 5 ? (
          <>
            <path d="M7 3.5h10L22 10 12 22 2 10Z" fill={finish.face} stroke={finish.edge} />
            <path d="m7 3.5 5 6.5 5-6.5M2 10h20M7 3.5 6.5 10 12 22l5.5-12-.5-6.5" stroke={finish.edge} />
            <path d="m12 10 5-6.5.5 6.5Z" fill={finish.light} />
            <path d="M6.5 10H12v12Z" fill={finish.edge} opacity=".7" />
          </>
        ) : (
          <>
            <path d="m12 1.5 9 5.25v10.5l-9 5.25-9-5.25V6.75Z" fill={finish.face} stroke={finish.edge} />
            <path d="m6 8.5 3.5 2L12 6l2.5 4.5 3.5-2-1.5 7h-9Z" fill={finish.edge} />
            <path d="m12 6 2.5 4.5 3.5-2-1.5 7H12Z" fill={finish.light} opacity=".8" />
            <path d="M8 18h8" stroke={finish.edge} />
          </>
        )}
      </g>
    </svg>
  );
}
