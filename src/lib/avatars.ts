/** Ordered to match the six heads in /public/avatars/heads.png. */
export const AVATAR_OPTIONS = [
  { id: 0, label: "Quiff" },
  { id: 1, label: "Curls" },
  { id: 2, label: "Close crop" },
  { id: 3, label: "Bob" },
  { id: 4, label: "Silver" },
  { id: 5, label: "Ponytail" },
] as const;

export function isAvatarId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < AVATAR_OPTIONS.length;
}

/** Existing profiles retain their familiar head until they select another. */
export function avatarIndex(identity: string, avatarId?: number | null): number {
  if (isAvatarId(avatarId)) return avatarId;
  let hash = 0;
  for (const char of identity) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return (hash >>> 0) % AVATAR_OPTIONS.length;
}
