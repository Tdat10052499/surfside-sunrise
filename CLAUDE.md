# Surfside Sunrise House — project guide for AI coding assistants

Read this whole file before changing anything. It is the brief for Claude Code, Cursor, Copilot or any assistant working in this repo.

## What this is

A one-page marketing and booking-request site for **Surfside Sunrise House**, a three-bedroom beach house in Surfside Beach (Freeport), Texas, listed on Airbnb (`https://www.airbnb.com.vn/rooms/1769640627295243012`). Guests are mostly international. The page's job: make guests want to stay, then get them to send a date request or book on Airbnb.

Live site: `https://tdat10052499.github.io/surfside-sunrise/` (GitHub Pages, branch `main`, folder `/`).

## Stack

Plain static site, no build step.

```
index.html               markup for every section
assets/css/styles.css    all styles (design tokens at the top)
assets/js/main.js        all behaviour
assets/img/*.webp        house photos (real photos from the listing)
assets/data/map-data.txt OpenStreetMap geometry for the map (see "Map")
favicon.svg
.nojekyll                keeps GitHub Pages from running Jekyll
```

Libraries load from CDNs in `index.html`, pinned to exact versions. Keep them pinned:

- GSAP 3.12.5 + ScrollTrigger (cdnjs)
- Lenis 1.1.13 smooth scroll (unpkg)
- Lucide 0.344.0 icons (jsDelivr), used as `<i data-lucide="name"></i>`
- Google Fonts: Plus Jakarta Sans (headings), Inter (body)

The page must keep working if a CDN fails. Every script checks for its library (`window.gsap`, `window.Lenis`, `window.lucide`) before using it, and the CSS final state is the visible state.

## Design system

Defined as CSS variables at the top of `styles.css`. Use the tokens and don't add raw colours.

The palette is sampled from the house itself:

| Token | Value | Comes from |
|---|---|---|
| `--navy` | `#1f3552` | navy sideboard in the living room. Headings, buttons, menu background |
| `--gulf` | `#3d7ea8` | Gulf sky and water. Links, eyebrows, icons |
| `--sky` / `--sky-l` | `#e4f0f6` / `#eef6fa` | light sky tones |
| `--wall` | `#eef1f2` | grey interior walls. Field and tile backgrounds |
| `--deck` / `--sand-l` | `#d9c7ae` / `#f6f0e7` | weathered deck boards |
| `--oak` | `#6d5444` | floor |
| `--glass` | `#7cc5c7` | sea-glass pillows. Small accents only |
| `--sun` | `#f1bf45` | yellow pillow. Sun motif, stars |

- Single light theme by design. The menu is the only dark surface.
- Layout follows the Pine Valley Framer template: centered section heads (eyebrow, H2, one-line lede), generous spacing, rounded 14–24px cards, pill buttons.
- Side gutter: `--gl` / `--gr` (min 16px, respects safe areas). Content max width 1180px (`.wrap`).
- Buttons: `.btn` plus `.btn-navy`, `.btn-white`, `.btn-line` or `.btn-glass`. The hover fill slides up from below and the arrow icon nudges right.

## Sections (in order, with ids)

1. Header `.bar`: logo, "Book your stay" and a menu button. It turns into a frosted pill after the hero and hides while you scroll down.
2. Full-screen menu `#menu`: "Surfside Sunrise" wordmark with a rising sun, a location/sunrise/coordinates row, **world time** (6 cities, time plus day/night plus hours compared with Surfside), nav links, and a photo card.
3. `#top` hero: deck photo, headline, two CTAs.
4. `#overview`: statement whose words fill in as you scroll, a large photo, 6 fact tiles.
5. Marquee strip: place names, speed follows scroll velocity.
6. `#gallery`: one feature photo plus 4 tiles, and a lightbox with all photos.
7. `#experience`: 3 stacking sticky cards (morning, afternoon, evening).
8. `#amenities`: 12 amenity tiles.
9. `#spaces`: pinned horizontal scroll of rooms (desktop), swipe on mobile, ending in a bedrooms card.
10. `#reviews`: host card and a link to the Airbnb reviews.
11. `#location`: interactive map, address bar, 3 distance tiles.
12. `#booking`: booking request card over a photo.
13. `#faq`: accordion.
14. Footer: revealed under the page like a curtain.

## Motion system

Lenis drives scrolling, and GSAP ScrollTrigger is synced to it. Behaviour is attached through data attributes, so reuse them instead of writing one-off animations:

- `data-tone="#hex"` on a section shifts the page background while that section is in view.
- `data-split` on a heading makes its words lift in.
- `data-clip` opens a large image from an inset rounded rectangle.
- `data-par="8"` gives an image inner parallax. The image needs extra height (`height:120%; margin-top:-10%`).
- `data-stagger` staggers a grid's children in.
- `data-cursor="View"` shows the custom cursor label on hover (desktop only).
- `a[data-scroll]` makes an anchor link smooth-scroll through Lenis.

Rules:

- Nothing meant to be read may start hidden. Entrance animations start from a visible state (opacity ≥ .25).
- Respect `prefers-reduced-motion`: Lenis and ScrollTrigger effects are skipped, and CSS durations drop to near zero.
- Call `ScrollTrigger.refresh()` after layout changes, such as an FAQ opening or the form result appearing.

## Map (`#location`)

- Rendered by `main.js` as SVG from `assets/data/map-data.txt`. There are no map tiles and no Google embed.
- Data: OpenStreetMap via Overpass, bbox around Surfside Beach, simplified. Format per line: `class|name|x,y;dx,dy;...`. Coordinates are 1e-5 degrees from origin (−95.312, 28.928) and delta-encoded. Classes: road types (`residential`, `primary`…), `n:coastline`, `n:water`, `n:beach`, `n:wetland`, `l:park`, `m:breakwater`, `m:pier`, `w:canal`, `w:river`, `u:*` landuse.
- The house pin uses Airbnb's **approximate** location (28.9438 N, 95.2913 W) and must stay labelled as approximate. Do not publish an exact address unless the owner provides one and asks for it.
- The "© OpenStreetMap contributors" credit is required by the ODbL licence. Never remove it.
- Interaction: drag to pan, Ctrl/⌘ + wheel or pinch to zoom, +/−/recenter buttons, scale bar, marker popups.

## Responsive scaling & browser support

- Sizes are in `rem`. Hairlines (1–3px) and `@media` conditions stay in px. From 1440px wide, the root font size grows (`clamp(16px, .6vw + 7.36px, 24px)`), so the whole layout scales up on large monitors instead of sitting small in the middle. Keep new sizes in rem so they follow along.
- Short laptop screens (`max-height:720px`, e.g. 1366×768 at 125% Windows zoom) get tighter spacing, a smaller hero and the scroll cue hidden. The hero headline uses `min(vw, vh)` so it fits both width and height.
- The hero uses `100vh` with a `100svh` override (mobile address bar). Keep the vh fallback line before any svh/dvh value.
- On resize, rotate or zoom, `main.js` re-measures Lenis and calls `ScrollTrigger.refresh()`. `ScrollTrigger.config({ignoreMobileResize:true})` stops mobile address-bar jumps.
- The custom cursor hides the system cursor only when `html.has-cursor` is set (mouse devices, motion allowed). Never set `cursor:none` without it.
- Never put `:focus-visible` in the same selector list as `:hover`. Older Safari drops the whole rule; write separate rules.
- Vendor prefixes: run the stylesheet through Autoprefixer (`safari >= 14, ios_saf >= 14, firefox >= 115, chrome >= 100, edge >= 100, samsung >= 18`). It adds `-webkit-backdrop-filter`, `-webkit-background-clip:text` and others that Safari needs.
- Fallbacks exist for browsers without `aspect-ratio` (`@supports not (aspect-ratio:1/1)`).
- Test matrix before shipping: 360×740, 390×844, 768×1024, 1024×768, 1093×614, 1366×768, 1920×1080, 2560×1440. Also resize the window live from desktop to phone width and back; the pinned rooms section, map and menu must re-layout without a reload. No horizontal scroll at any size.

## Content rules (important)

- Use only facts from the Airbnb listing or from the owner. Confirmed facts: entire home, 3 bedrooms (queen, queen, 2 bunk beds), 6 beds, 2 baths, up to 8 guests, 55 amenities (beach access, full kitchen with dishwasher, outdoor patio dining, EV charger, Wi-Fi, workspace, free parking, central AC, washer and dryer, self check-in with lockbox). The Gulf is a few steps away, Surfside Beach is about a 5-minute walk and Jetty Park about 10. Host Anh replies within 1 hour with a 100% response rate. New listing.
- **Never invent reviews, ratings, prices, policies or check-in times.** Where data is missing, say how the guest can find out (for example "confirmed when you book").
- Copy is in English, plain and specific. No lorem ipsum.

## Booking request

- A static site cannot receive form data. The form builds a message the guest can copy, or send through WhatsApp, email or Airbnb. It must never claim a message was sent.
- Contact details live in the `CONFIG` object at the top of `main.js` (`whatsapp`, `email`, `phone`). Buttons appear only when a value is set.
- If the owner wants real submissions, add a form backend (Formspree, Netlify Forms or a small serverless function) and say so in the PR.

## Working rules

- Keep it dependency-free and build-free unless the owner asks for a framework (see `docs/PROMPT_REBUILD.md`).
- Mobile first. Test at 390px, 768px, 1366px and 2000px wide. The page body must never scroll horizontally.
- Accessibility: visible focus states, `aria-label` on icon buttons, alt text on content images, keyboard access for the menu, lightbox (Esc, arrows), FAQ and map.
- Photos: WebP, about 1200–1800px on the long edge, under ~200 KB each. New photos go in `assets/img/` and are referenced from `index.html` and the `PHOTOS` list in `main.js`.
- Before committing, open `index.html` through a local server (`python3 -m http.server`). Check the console for errors, check that the map loads (it uses `fetch`, which fails on `file://`), and click through the menu, gallery, FAQ and booking form.

## Known gaps (ask the owner before filling)

- No bedroom or bathroom photos yet. The bathroom photo received was too small.
- Nightly price, check-in/out times, pet policy and the cancellation policy are not known.
- Contact details (WhatsApp, email, phone) are empty in `CONFIG`.
