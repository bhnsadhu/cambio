import { describe, expect, it } from "vitest";
import { AVATAR_OPTIONS, SKIN_TONE_OPTIONS, avatarChoice, avatarIndex, avatarStyle, avatarTone, isAvatarId } from "./avatars";

describe("Persisted avatar choices", () => {
  it("keeps existing styles and assigned defaults unchanged", () => {
    expect(AVATAR_OPTIONS.map(({ label }) => label)).toEqual(["Quiff", "Curls", "Close crop", "Bob", "Silver", "Ponytail"]);
    for (const { id } of AVATAR_OPTIONS) {
      expect(avatarIndex("different-account", id)).toBe(id);
      expect(avatarStyle(id)).toBe(id);
      expect(avatarTone(id)).toBe(0);
    }
    expect(avatarIndex("a")).toBe(1);
    expect(avatarIndex("b", null)).toBe(2);
    expect(avatarIndex("a", 36)).toBe(1);
    expect(avatarIndex("a", -1)).toBe(1);
  });

  it("retains both choices for every style and tone without colliding with old ids", () => {
    const choices = new Set<number>();
    for (const style of AVATAR_OPTIONS) for (const tone of SKIN_TONE_OPTIONS) {
      const id = avatarChoice(style.id, tone.id);
      expect(isAvatarId(id)).toBe(true);
      expect(avatarStyle(id)).toBe(style.id);
      expect(avatarTone(id)).toBe(tone.id);
      expect(avatarIndex("any-account", id)).toBe(id);
      choices.add(id);
    }
    expect([...choices].sort((a, b) => a - b)).toEqual(Array.from({ length: 36 }, (_, id) => id));
    expect(SKIN_TONE_OPTIONS[0].image).toBe("/avatars/heads.png");
    expect(new Set(SKIN_TONE_OPTIONS.map(({ image }) => image)).size).toBe(6);
  });

  it.each([-1, 36, 1.5, "2", null, undefined, false, {}, [], NaN, Infinity])("rejects invalid persisted choice %j", (id) => {
    expect(isAvatarId(id)).toBe(false);
  });
});
