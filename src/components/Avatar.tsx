import Image from "next/image";
import { avatarIndex, avatarStyle, avatarTone, SKIN_TONE_OPTIONS } from "@/lib/avatars";

/** The same account keeps its avatar across tables, friends and standings. */
export function Avatar({ identity, avatarId, size = 40, className = "" }: { identity: string; avatarId?: number | null; size?: number; className?: string }) {
  const index = avatarIndex(identity, avatarId);
  const style = avatarStyle(index);
  const tone = avatarTone(index);
  return <span aria-hidden="true" data-avatar-index={index} data-avatar-style={style} data-avatar-tone={tone} className={`relative inline-block shrink-0 overflow-hidden ${className}`} style={{ width: size, height: size, maskImage: "radial-gradient(ellipse at center, black 54%, transparent 75%)" }}>
    <Image src={SKIN_TONE_OPTIONS[tone].image} alt="" width={1536} height={1024} sizes={`${size * 3}px`} loading={size >= 64 ? "eager" : "lazy"} className="absolute max-w-none" style={{ width: "300%", height: "200%", left: `${-(style % 3) * 100}%`, top: `${-Math.floor(style / 3) * 100}%` }} />
  </span>;
}
