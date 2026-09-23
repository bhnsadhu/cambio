/** House bots keep the same character in every table and round. */
const BOT_AVATAR_IDS = { Cameron: 0, Camila: 1, Cami: 5, Camille: 3 } as const;
export const BOT_NAMES = Object.keys(BOT_AVATAR_IDS) as readonly (keyof typeof BOT_AVATAR_IDS)[];

export function isBotName(name: string): boolean {
  return BOT_NAMES.some((bot) => bot.toLowerCase() === name.toLowerCase());
}

export function botAvatarId(name: string): number | null {
  return Object.hasOwn(BOT_AVATAR_IDS, name)
    ? BOT_AVATAR_IDS[name as keyof typeof BOT_AVATAR_IDS]
    : null;
}
