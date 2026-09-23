/** Ordered to match the six heads in /public/avatars/heads.png. */
export const AVATAR_OPTIONS = [
  { id: 0, label: "Quiff" },
  { id: 1, label: "Curls" },
  { id: 2, label: "Close crop" },
  { id: 3, label: "Bob" },
  { id: 4, label: "Silver" },
  { id: 5, label: "Ponytail" },
] as const;

/** Tone zero preserves every avatar selected before skin tones were added. */
export const SKIN_TONE_OPTIONS = [
  { id: 0, label: "Default", color: null, image: "/avatars/heads.png" },
  { id: 1, label: "Light", color: "#f3d6c4", image: "/avatars/heads-light.png" },
  { id: 2, label: "Light medium", color: "#d9ab86", image: "/avatars/heads-light-medium.png" },
  { id: 3, label: "Medium", color: "#b97951", image: "/avatars/heads-medium.png" },
  { id: 4, label: "Deep", color: "#805035", image: "/avatars/heads-deep.png" },
  { id: 5, label: "Very deep", color: "#4f3024", image: "/avatars/heads-very-deep.png" },
] as const;

export function isAvatarId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < AVATAR_OPTIONS.length * SKIN_TONE_OPTIONS.length;
}

/** Style and tone share the existing persisted avatar field. */
export const avatarStyle = (id: number): number => id % AVATAR_OPTIONS.length;
export const avatarTone = (id: number): number => Math.floor(id / AVATAR_OPTIONS.length);
export const avatarChoice = (style: number, tone: number): number => tone * AVATAR_OPTIONS.length + style;

/** Existing profiles retain their familiar head until they select another. */
export function avatarIndex(identity: string, avatarId?: number | null): number {
  if (isAvatarId(avatarId)) return avatarId;
  let hash = 0;
  for (const char of identity) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return (hash >>> 0) % AVATAR_OPTIONS.length;
}
