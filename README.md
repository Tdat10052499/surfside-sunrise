# Surfside Sunrise House

Landing page for **Surfside Sunrise House**, a three-bedroom beach house for up to 8 guests in Surfside Beach, Texas. The Gulf of Mexico is a few steps away and Surfside Beach is a 5-minute walk.

**Live site:** https://tdat10052499.github.io/surfside-sunrise/
**Airbnb listing:** https://www.airbnb.com.vn/rooms/1769640627295243012

## Project structure

```
index.html               page markup
assets/css/styles.css    styles (design tokens at the top)
assets/js/main.js        behaviour: smooth scroll, animations, menu, world time, map, booking form
assets/img/              house photos (WebP)
assets/data/map-data.txt OpenStreetMap data for the location map
favicon.svg
CLAUDE.md                guide for AI coding assistants (design system, rules)
docs/PROMPT_REBUILD.md   prompt for rebuilding the site with Astro
docs/DEPLOY_vi.md        deployment guide in Vietnamese
```

No build step: it is plain HTML, CSS and JavaScript. Libraries (GSAP, Lenis, Lucide) and fonts load from CDNs.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Opening `index.html` directly from the file system works, except for the map, because browsers block `fetch` on `file://`.

## Edit common things

| What | Where |
|---|---|
| WhatsApp, email, phone | `CONFIG` at the top of `assets/js/main.js` |
| Photos | replace files in `assets/img/` (same names), or add new ones and update `index.html` and the `PHOTOS` list in `main.js` |
| World-time cities | `CITIES` in `assets/js/main.js` (name, code, IANA timezone) |
| FAQ answers | `#faq` section in `index.html` |
| Colours | CSS variables at the top of `assets/css/styles.css` |

## Deploy (GitHub Pages)

Settings → Pages → Build and deployment → Source: **Deploy from a branch**, branch **main**, folder **/ (root)** → Save. The site updates about a minute after each push to `main`.

## Credits

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the ODbL. Photos © the property owner.
