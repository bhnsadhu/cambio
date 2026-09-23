# Avatar skin-tone artwork

The existing six avatar identities are preserved in five additional skin-tone sheets. The default sheet, `public/avatars/heads.png`, is unchanged. Each variant contains the same six heads in the original three-column, two-row grid at 1536 × 1024 pixels.

Generated with the built-in `image_gen` edit tool using `heads.png` as the edit target for every variant. Each output was visually inspected for the original character order, silhouette, framing, hairstyles, expressions, eyes, beard, jewelry, background and shading. Dimensions were checked with `sips`.

## Saved assets

| Tone | File | Requested midtone |
| --- | --- | --- |
| Light | `public/avatars/heads-light.png` | `#f1c6a7` |
| Light-medium | `public/avatars/heads-light-medium.png` | `#dca27b` |
| Medium | `public/avatars/heads-medium.png` | `#ba7b53` |
| Deep | `public/avatars/heads-deep.png` | `#895337` |
| Very deep | `public/avatars/heads-very-deep.png` | `#593725` |

These color references specify the intended midtone; the rendered skin retains highlights and shadows. The artwork changes exposed skin independently of hair, eyes, mouth, accessories and background. No whole-image color filter is used.

## Rendering without a halo

The original sheet contains a transparent head silhouette; the tone sheets are opaque and retain a blurred studio background. `src/lib/avatar-crops.ts` traces the original alpha boundaries as vector contours. `Avatar` applies the same contour and square crop to every tone of a style, so only the head is visible and changing tones cannot introduce the baked background. The renderer uses no radial fade or blur. Images use quality 90 with source sizes calculated for the cropped sprite, keeping the face and hair sharp at small display sizes.

`e2e/avatar-rendering.spec.ts` checks all 36 combinations against clear regions in the original alpha channel, verifies that the head stays visible, and captures each tone's six-style picker for visual review. The original asset pixels remain unchanged.

## Final prompt set

Every call used the prompt below with the substitutions in the table. All calls referenced the original default sheet, never another generated tone.

```text
Use case: identity-preserve.
Asset type: production avatar sprite sheet for a website, 1536×1024 pixels, same 3-column by 2-row layout as the input.
Input image: edit target. Preserve this entire image and every pixel's arrangement as closely as possible.
Primary request: change ONLY the exposed skin color of ALL SIX heads to a consistently {TONE_DESCRIPTION}, keeping realistic highlights and shadows. Face, ears, and small exposed neck areas must all match. This is one skin-tone variant of the SAME characters, not six new avatars.
Invariants: EXACT same six character identities, head silhouettes and face geometry, hair shapes and colors, brows, pupils, expressions, mouths, tongues, earrings and hair accessory, lighting direction, dark blurred backgrounds, grid positions, scales, camera and crop. The shaved head is hair and must remain dark. Beard and gray hair remain gray. Maintain every character in its original tile and keep the original 3:2 image aspect ratio. All exposed skin should be {EXPOSED_SKIN_TONE} in this variant regardless of its original tone. No text, frames, labels, new objects or other changes.
```

| Asset suffix | TONE_DESCRIPTION | EXPOSED_SKIN_TONE |
| --- | --- | --- |
| light | LIGHT skin tone with warm peach midtone approximately #f1c6a7 | light |
| light-medium | LIGHT-MEDIUM skin tone with warm golden tan midtone approximately #dca27b | light-medium |
| medium | MEDIUM skin tone with warm medium brown midtone approximately #ba7b53 | medium brown |
| deep | DEEP skin tone with rich deep brown midtone approximately #895337 | deep brown |
| very-deep | VERY DEEP skin tone with rich dark brown midtone approximately #593725 | very deep dark brown |

## Generated originals

The project copies are the deliverables. Built-in output originals remain at:

```text
/Users/bhanusadhu/.codex/generated_images/01a0cc02-b4ec-7981-a6ba-a0924f141b9d/
  exec-c07d93b1-5c5d-43fe-8fc5-6e578a8e4488.png  light
  exec-d72b42ee-cb06-4e90-87a8-094cf41d6b62.png  light-medium
  exec-7c0ebd74-dd61-4505-b199-414dc27f9746.png  medium
  exec-e75c5238-291b-4086-8605-f56569cf8d8d.png  deep
  exec-f6c3c4b5-d4c2-49cc-aad8-fc9de1b506fc.png  very-deep
```
