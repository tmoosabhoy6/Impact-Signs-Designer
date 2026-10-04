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
| Natural Satin Brushed Bronze | `assets/finishes/natural-satin-brushed-bronze.png` |
| Chemical Oxidized | `assets/finishes/chemical-oxidized.png` |
| Verde Patina | `assets/finishes/verde-patina.png` |
| Turquoise Patina | `assets/finishes/turquoise-patina.png` |
| Light Oxidized (tint) | `assets/finishes/light-oxidized.png` |
| Medium Oxidized (tint) | `assets/finishes/medium-oxidized.png` |
| Dark Oxidized (tint) | `assets/finishes/dark-oxidized.png` |
| Polished | `assets/finishes/polished.png` |

`natural-satin-brushed-bronze.png` was extracted from the real Liquid Mercury proof (the coin photo).

## Background (paint-fill) colors (`assets/background-colors/`), shown on the proof as "<Color> / Paint Fill"
| Option | File |
|---|---|
| Dark Oxide | `assets/background-colors/dark-oxide.png` |
| Black | `assets/background-colors/black.png` |
| Brown | `assets/background-colors/brown.png` |
| Duranodic Bronze | `assets/background-colors/duranodic-bronze.png` |

## Background textures (`assets/background-textures/`), sent to the image model only
| Option | File |
|---|---|
| Leatherette | `assets/background-textures/leatherette.png` |
| Stipple | `assets/background-textures/stipple.png` |
| Pebble | `assets/background-textures/pebble.png` |

## Borders (`assets/borders/`), sent to the image model only
| Option | File |
|---|---|
| Single Line Border | `assets/borders/single-line.png` |
| No Border | `assets/borders/none.png` |
| Double Line Border | `assets/borders/double-line.png` |
| Bevel Edge Border | `assets/borders/bevel-edge.png` |

## Image options (`assets/image-types/`), examples of each image treatment for the image model
| Option | File |
|---|---|
| Photo Relief | `assets/image-types/photo-relief.jpg` |
| Bas Relief | `assets/image-types/bas-relief.jpg` |
| Etched Photo | `assets/image-types/etched-photo.png` |
| Full Color UV Printed | `assets/image-types/full-color-uv.jpg` |

> The four image-type files here are the 100 x 100 px thumbnails pasted in chat, mapped as you confirmed:
> 1 = Bas Relief, 2 = Photo Relief, 3 = Etched Photo, 4 = Full Color UV.
> **Please replace them with full-size photos** (1000 px or more). Note that `etched-photo.png` looks like a full-color photo and `full-color-uv.jpg` looks like a grey metal plaque, so check whether those two are swapped.
