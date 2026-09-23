import Image from "next/image";

/** The same account keeps its avatar across tables, friends and standings. */
export function Avatar({ identity, size = 40, className = "" }: { identity: string; size?: number; className?: string }) {
  let hash = 0;
  for (const char of identity) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  const index = (hash >>> 0) % 6;
  return <span aria-hidden="true" className={`relative inline-block shrink-0 overflow-hidden ${className}`} style={{ width: size, height: size, maskImage: "radial-gradient(ellipse at center, black 54%, transparent 75%)" }}>
    <Image src="/avatars/heads.png" alt="" width={1536} height={1024} sizes={`${size * 3}px`} loading={size >= 64 ? "eager" : "lazy"} className="absolute max-w-none" style={{ width: "300%", height: "200%", left: `${-(index % 3) * 100}%`, top: `${-Math.floor(index / 3) * 100}%` }} />
  </span>;
}
