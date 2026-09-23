import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { AVATAR_CROPS } from "../src/lib/avatar-crops";

test("all avatar tones keep clear space around the head without a background halo", async ({ page, context }) => {
  const origin = process.env.E2E_APP_ORIGIN ?? "http://localhost:3100";
  const account = await context.request.post("/api/account", {
    headers: { origin },
    data: { username: `edges${randomBytes(5).toString("hex")}`, displayName: "Clear Avatars", password: "Avatar rendering password 42!" },
  });
  expect(account.status()).toBe(201);
  await page.goto("/me");
  await page.getByRole("button", { name: "Change avatar", exact: true }).click();
  const editor = page.getByRole("form", { name: "Avatar settings", exact: true });
  const choices = editor.locator('label:has(input[name="avatarId"]) [data-avatar-index]');
  await expect(choices).toHaveCount(6);

  // Reference empty space from the original artwork's alpha, independently
  // of the new vector clips. Stay away from antialiased boundary pixels.
  const probes = await page.evaluate(async (crops) => {
    const image = new Image();
    image.src = "/avatars/heads.png";
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const drawing = canvas.getContext("2d")!;
    drawing.drawImage(image, 0, 0);
    const pixels = drawing.getImageData(0, 0, canvas.width, canvas.height).data;
    return crops.map((crop) => {
      const points: [number, number][] = [];
      for (let y = 3; y < 53; y += 2) for (let x = 3; x < 53; x += 2) {
        const sx = Math.round(crop.x + (x + 0.5) * crop.width / 56);
        const sy = Math.round(crop.y + (y + 0.5) * crop.height / 56);
        let clear = true;
        for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) {
          if (pixels[((sy + dy) * canvas.width + sx + dx) * 4 + 3] !== 0) clear = false;
        }
        if (clear) points.push([x, y]);
      }
      return points;
    });
  }, AVATAR_CROPS.map(({ x, y, width, height }) => ({ x, y, width, height })));
  for (const points of probes) expect(points.length).toBeGreaterThan(10);

  for (const [tone, name] of ["Default", "Light", "Light medium", "Medium", "Deep", "Very deep"].entries()) {
    await editor.getByRole("group", { name: "Skin tone", exact: true }).getByRole("radio", { name, exact: true }).check();
    for (let style = 0; style < 6; style++) {
      const avatar = choices.nth(style);
      await expect(avatar).toHaveAttribute("data-avatar-index", String(tone * 6 + style));
      await expect.poll(() => avatar.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
      const box = (await avatar.boundingBox())!;
      expect(box.width).toBe(56); expect(box.height).toBe(56);
      const png = (await avatar.screenshot({ animations: "disabled" })).toString("base64");
      const difference = await page.evaluate(async ({ png, points }) => {
        const image = new Image(); image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = 56; canvas.height = 56;
        const drawing = canvas.getContext("2d")!; drawing.drawImage(image, 0, 0);
        const pixels = drawing.getImageData(0, 0, 56, 56).data;
        let halo = 0, foreground = 0;
        for (const [x, y] of points) for (let channel = 0; channel < 3; channel++) {
          halo = Math.max(halo, Math.abs(pixels[(y * 56 + x) * 4 + channel] - pixels[channel]));
        }
        for (let i = 0; i < pixels.length; i += 4) {
          if (Math.abs(pixels[i] - pixels[0]) + Math.abs(pixels[i + 1] - pixels[1]) + Math.abs(pixels[i + 2] - pixels[2]) > 30) foreground++;
        }
        return { halo, foreground };
      }, { png, points: probes[style] });
      expect(difference.halo, `${name}, style ${style}: empty space must match the panel`).toBeLessThanOrEqual(2);
      expect(difference.foreground, `${name}, style ${style}: head must remain visible`).toBeGreaterThan(500);
    }
    await editor.screenshot({ path: `test-results/avatar-edges-${tone}.png`, animations: "disabled" });
  }
});
