# NosHen — Logo Guidelines

## 1. The logo

**Idea:** an n and a u hooked together. Buyer and seller are two equal halves of one deal, and neither side can go it alone. The green half stands for the buyer and the teal half for the seller.

**Versions**

| Version | Use it for | File |
|---|---|---|
| Horizontal (primary) | Site header, documents, most places | `svg/noshen-horizontal-color.svg` |
| Stacked | Square spaces, bags, signs, splash screens | `svg/noshen-stacked-color.svg` |
| Symbol | App icon, avatar, favicon, stickers | `svg/noshen-symbol-color.svg` |
| Wordmark | When the symbol is already nearby | `svg/noshen-wordmark-ink.svg` |

Use the SVG files for screens and print. Use the PNG files only where SVG isn't accepted.

## 2. Clear space

**X** is the stroke width of the symbol: the thickness of one arch. Keep at least **2X** of empty space on every side of the logo. The space scales with the logo, so never use a fixed distance.

## 3. Minimum size

| Version | Screen | Print |
|---|---|---|
| Horizontal | 96 px wide | 25 mm wide |
| Stacked | 64 px wide | 18 mm wide |
| Symbol | 24 px | 6 mm |
| Symbol, 16–23 px | Use `svg/noshen-symbol-small.svg` (thicker strokes) or `apps/web/public/favicon.ico` | — |

## 4. Colour

| Name | Role | HEX | RGB | CMYK (approx.) |
|---|---|---|---|---|
| NosHen Green | Primary, buyer half | `#0F6E56` | 15 110 86 | 86 0 22 57 |
| NosHen Teal | Accent, seller half | `#14B8A6` | 20 184 166 | 89 0 10 28 |
| Ink | Wordmark, text | `#17201D` | 23 32 29 | 28 0 9 87 |
| White | Backgrounds, reversed logo | `#FFFFFF` | 255 255 255 | 0 0 0 0 |

The CMYK values are calculated, not proofed. For printed work, ask the printer for a proof. For a spot colour, match Pantone against a physical swatch book.

**Which version goes on which background**

| Background | Use |
|---|---|
| White or light | Full colour (`*-color.svg`) |
| Ink or dark | Reversed: white and teal (`*-reversed.svg`) |
| NosHen Green | All-white (`*-white.svg`). Don't use teal on green: the contrast is too low. |
| Photos | All-white or black, placed on a calm area of the photo |
| One-colour printing | All-green (`*-mono-0f6e56.svg`), black or white |

## 5. Typography

- The wordmark is custom-drawn and saved as shapes. Never retype "NosHen" in a font to recreate it.
- Next to the logo, use the site's existing fonts: **Sora** for headings and **Figtree** for body text. Both are free under the SIL Open Font License from Google Fonts.

## 6. Don'ts

- Don't stretch, squash, rotate or slant the logo.
- Don't swap the two colours, or recolour the logo outside the palette.
- Don't add shadows, outlines, gradients or glows.
- Don't change the size or spacing between the symbol and the wordmark.
- Don't separate the n and the u, or turn the symbol upside down to make a different shape.
- Don't put the full-colour logo on busy photos or on the green background.

## 7. Files in this kit

| Where | Contents |
|---|---|
| `brand/svg/` | Masters: colour, reversed, white, black and green versions of every layout, plus the small-size symbol |
| `brand/*.png` | Ready-made PNGs of the logo and the mark (see `brand/README.md`) |
| `apps/web/public/`, `apps/admin/public/` | `favicon.svg` (switches to teal in dark mode), `favicon.ico`, app icons, maskable icon, notification badge |
| `packages/ui/src/ui.tsx` | The `Wordmark` component the apps use |

## 8. Handover notes

- The reversed version uses slightly thinner arches (33 instead of 36 units) because light-on-dark shapes look heavier.
- Every file is built from plain filled paths: no live text, no images and no effects. Some letters are made of overlapping shapes. That renders cleanly on screen and in print. For vinyl cutting or embroidery, have a designer run *Outline Stroke* and *Unite* in a vector editor first.
- Trademark: this design hasn't been checked for trademark conflicts. Run a search with the Nigerian Trademarks Registry, and in any other market you plan to enter, before launch.
