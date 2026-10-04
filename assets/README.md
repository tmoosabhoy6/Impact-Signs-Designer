# Asset library

Static images the app **pulls**, never generates. Every option in `data/catalog.json` points to one file here.

- **Proof icons:** the finish icon and the paint-fill icon on every customer proof come from `finishes/` and `background-colors/`.
- **AI guidance:** all of these images are also sent to the image model as references, so it knows exactly what each finish, color, texture, border and image type looks like.

## How to add or replace an icon
1. Use the exact file name in the tables below. `.png`, `.jpg`, `.jpeg`, `.webp` and `.svg` all work, so `dark-oxide.jpg` is fine.
2. Square images work best for proof icons (the proof shows them at about 1 inch square). Use at least 600 x 600 px.
3. Upload to this folder on GitHub (Add file > Upload files) and commit. The app picks it up on the next deploy.
4. Check **Admin > Asset Library** in the app: it lists every expected file as present or missing.

If an icon is missing, the proof falls back to a flat color square (paint colors) or the finish's base color, and the Asset Library page flags it.

## Plaque finishes (`assets/finishes/`), shown on the proof with the finish name
| Option | File |
|---|---|
| Natural Satin Brushed Bronze | `assets/finishes/natural-satin-brushed-bronze.jpg` |
| Chemical Oxidized | `assets/finishes/chemical-oxidized.jpg` |
| Verde Patina | `assets/finishes/verde-patina.jpg` |
| Turquoise Patina | `assets/finishes/turquoise-patina.jpg` |
| Light Oxidized (tint) | `assets/finishes/light-oxidized.jpg` |
| Medium Oxidized (tint) | `assets/finishes/medium-oxidized.jpg` |
| Dark Oxidized (tint) | `assets/finishes/dark-oxidized.jpg` |
| Polished | `assets/finishes/polished.jpg` |


## Background (paint-fill) colors (`assets/background-colors/`), shown on the proof as "<Color> / Paint Fill"
| Option | File |
|---|---|
| Dark Oxide | `assets/background-colors/dark-oxide.jpg` |
| Black | `assets/background-colors/black.jpg` |
| Brown | `assets/background-colors/brown.jpg` |
| Duranodic Bronze | `assets/background-colors/duranodic-bronze.jpg` |

## Background textures (`assets/background-textures/`), sent to the image model only
| Option | File |
|---|---|
| Leatherette | `assets/background-textures/leatherette.jpg` |
| Stipple | `assets/background-textures/stipple.jpg` |
| Pebble | `assets/background-textures/pebble.jpg` |

## Borders (`assets/borders/`), sent to the image model only
| Option | File |
|---|---|
| Single Line Border | `assets/borders/single-line.jpg` |
| No Border | `assets/borders/none.jpg` |
| Double Line Border | `assets/borders/double-line.jpg` |
| Bevel Edge Border | `assets/borders/bevel-edge.jpg` |

## Image options (`assets/image-types/`), examples of each image treatment for the image model
| Option | File |
|---|---|
| Photo Relief | `assets/image-types/photo-relief.jpg` |
| Bas Relief | `assets/image-types/bas-relief.jpg` |
| Etched Photo | `assets/image-types/etched-photo.jpg` |
| Full Color UV Printed | `assets/image-types/full-color-uv.png` |

> The image-type examples are the 100 x 100 px files you uploaded (BAS / Photo / Etched / FULL UV examples).
> **Full-size photos (1000 px or more) will noticeably improve how well the AI reproduces each treatment.**
> `medium-oxidized.jpg` is currently identical to `chemical-oxidized.jpg` (the two uploaded oxidized files were the same image). Replace it if Medium Oxidized has its own photo.
