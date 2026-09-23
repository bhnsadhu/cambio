/** House bots keep the same character in every table and round. */
const BOT_AVATAR_IDS = { Cameron: 0, Camila: 1, Cami: 5, Camille: 3 } as const;

export function botAvatarId(name: string): number | null {
  return Object.hasOwn(BOT_AVATAR_IDS, name)
    ? BOT_AVATAR_IDS[name as keyof typeof BOT_AVATAR_IDS]
    : null;
}
