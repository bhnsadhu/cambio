import Image from "next/image";
import { useId } from "react";
import { avatarIndex, avatarStyle, avatarTone, SKIN_TONE_OPTIONS } from "@/lib/avatars";
import { AVATAR_CROPS } from "@/lib/avatar-crops";

/** The same account keeps its avatar across tables, friends and standings. */
export function Avatar({ identity, avatarId, size = 40, className = "" }: { identity: string; avatarId?: number | null; size?: number; className?: string }) {
  const index = avatarIndex(identity, avatarId);
  const style = avatarStyle(index);
  const tone = avatarTone(index);
  const clipId = useId();
  const crop = AVATAR_CROPS[style];
  // Keep the head's proportions and a consistent frame across every tone.
  const edge = Math.max(crop.width, crop.height);
  const x = crop.x - (edge - crop.width) / 2;
  const y = crop.y - (edge - crop.height) / 2;
  return <span aria-hidden="true" data-avatar-index={index} data-avatar-style={style} data-avatar-tone={tone} className={`relative inline-block shrink-0 ${className}`} style={{ width: size, height: size }}>
    <svg width="0" height="0" className="absolute" focusable="false">
      <defs>
        <clipPath id={clipId} clipPathUnits="objectBoundingBox">
          <path d={crop.path} transform={`scale(${1 / edge}) translate(${-x} ${-y})`} />
        </clipPath>
      </defs>
    </svg>
    <span className="relative block size-full overflow-hidden" style={{ clipPath: `url(#${clipId})` }}>
      <Image src={SKIN_TONE_OPTIONS[tone].image} alt="" width={1536} height={1024} sizes={`${Math.ceil(size * 1536 / edge)}px`} quality={90} loading={size >= 64 ? "eager" : "lazy"} className="absolute max-w-none" style={{ width: `${1536 / edge * 100}%`, height: `${1024 / edge * 100}%`, left: `${-x / edge * 100}%`, top: `${-y / edge * 100}%` }} />
    </span>
  </span>;
}
