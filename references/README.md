# References

Real Impact Signs jobs. The app's three proof templates, plaque layouts and border geometry were measured from these files, and the automated tests (`npm test`) compare against them. Each folder with an `example.json` also appears in the app under **Jobs → Start from an example**, so it can be demoed instantly.

| Folder | Job | What it shows | Proof style |
|---|---|---|---|
| `32241-edwin-feulner/` | Heritage Foundation, 12×18 | Photo relief portrait, blind mount; includes the real `.ai` production file | Standard |
| `32717-camp-southern-ground/` | Mike Dobbs, 12×16 | Double-line border, photo relief | Standard |
| `32782-audubon/` | Eleanor Eisenmenger, 8×6 | Garden stake, brown paint, sans type (the real proof has two plaques) | Standard |
| `31882-honeywell/` | Jacob Sarfati, 8×12 | Brushed aluminum, garden stake, photo between lines, red note, photo disclaimer | Standard |
| `32054-arroyo-grande/` | City of Arroyo Grande, 6×2 | Two lines of capitals | Standard |
| `31547-kane-county/` | Forest Preserve District, 36×24 | Donor plaque: ruled section headings, 3- and 4-column lists | Standard |
| `32582-awe/` | Kathleen Awe, 6×4 | Garden-stake memorial, italic and bold lines, person-on-ground scale | Description sheet |
| `32885-raccoon-river/` | Raccoon River Pet Rescue, 18×24 | Full-color UV photo between text blocks, small caps, 8 ft wall scale, minimum-letter callout | Description sheet |
| `32240-sax-zim-bog/` | Friends of Sax-Zim Bog, 8×5 | Countersunk face screws, custom font, tiles along the bottom | Description sheet |
| `32408-hadar-family-hall/` | Hadar Family Hall, 42×36 | Double border, custom paint (Dark Blue 2050), site photo, VERSION 5 | Description sheet |
| `32249-structure-of-merit/` | City of Santa Barbara, 7×5 | Reverse-etched bronze, smooth black fill, double border; page 2 is the outline art | Order/version + outline |

Each folder holds:
- `proof.pdf`: the real proof.
- `spec.txt`: the order text, as it would be pasted into the app.
- `wording.json`: the exact plaque wording with each line's role and style, transcribed from the proof.
- `example.json`: the settings used to rebuild the job.
- `photo.png` / `site-photo.png`: extracted where the job has them.

## Adding more examples
Upload a job's files to a new folder, e.g. `references/32300-smith-memorial/`: the order text, the customer wording, photos and logos, the final proof PDF and, if possible, the production `.ai` file. I can then transcribe it, add it as an example and test against it. Production files are the most valuable: they let me verify border and layout geometry exactly.
