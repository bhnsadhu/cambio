# Visual reference and avatar artwork

Cambio uses these actual Offsuit screens for its colors, avatar treatment, and visual details, adapted to a desktop website layout:

- [Official Google Play leaderboard screenshot](https://play-lh.googleusercontent.com/tcNesVdAEppNUiS-o_x4s3aVbhIT2r_E-EdsySeOjOVJy3RCGJIhjcaDPXsUR6qAHxJApmB2ow46Ly_QJ7PO=w1080): black canvas, open rows, placement then avatar then player name, muted points underneath.
- [Statistics screenshot from Offsuit's official account](https://pbs.twimg.com/ext_tw_video_thumb/1844027329166684160/pu/img/kokRezv9Aw7be8kc.jpg): quiet heading, thin rounded outlines, compact value-over-label groups, generous outer insets.
- [Official app listing](https://apps.apple.com/us/app/offsuit-texas-holdem-poker/id6446099491).

These public screenshots establish the layout and visual treatment. They are not a claim that the latest installed app has identical screens. Cambio keeps its own gameplay metrics and existing rank tiers; it does not invent poker statistics to fill the reference chart.

## Desktop website

Website pages share a 1280px canvas and persistent navigation for tables, the leaderboard, the player's record, and account settings. Profiles put identity beside statistics; settings separate the player profile from account access; the desktop leaderboard exposes labeled comparison columns. Smaller browser windows retain readable layouts.

At laptop sizes, the game shows all four hands beside the piles and a scrollable move history. Rules and walkthroughs use the available desktop width. Browser navigation keeps seats available through the home page's verified saved tables, while an explicit Leave action explains its consequences before proceeding.

## Avatars

`public/avatars/heads.png` is original artwork generated with the built-in image generation tool. It is a six-head, three-column by two-row atlas. It uses simplified expressive 3D heads, as requested, rather than realistic portraits. Players can choose any of the six heads in Account settings → Avatar → Change. Their choice is saved with the account and displayed across profiles, friends, standings, and tables. Until a player makes a choice, `Avatar.tsx` selects a stable head from their identity. It uses Next Image optimization at its displayed size.

Final generation prompt (the two official screenshots were style references):

> These are REFERENCE IMAGES of the actual Offsuit poker app. Generate a new original avatar sprite atlas that matches EXACTLY the visual language of its small 3D Memoji-style floating cartoon human heads. This is NOT a photographic portrait task. Absolutely no realistic human skin, no skin pores, no realistic proportions or photographic lighting. Smooth toy-like Apple Memoji proportions: oversized rounded head, large expressive simple oval eyes, small nose, smiling mouth, sculpted solid-color stylized hair, friendly expressive eyebrows. Like the avatars visible in these reference screenshots. Asset: single 1536x1024 sprite atlas with exact 3 columns x 2 rows of six equal square cells. Six varied stylized human heads: top row dark quiff male, dark curly-haired female, dark skin male with cropped hair; bottom row light skin bob female, gray-haired male with small stylized beard, warm skin female with ponytail. Only heads with tiny neck ends, no bodies. Each head centered in cell, uniform 75% cell height and 64% cell width. Soft clean polished 3D rendering. Pure uniform BLACK #000000 background throughout with no gradients or haze so it blends into dark game UI. No frames, no text, no outlines, no grid lines, no typography, no watermark. This is a game asset sheet, not a website mockup.
