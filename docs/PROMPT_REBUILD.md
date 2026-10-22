# Prompt: rebuild Surfside Sunrise House with a framework

Copy everything below the line into Claude Code, Cursor or another coding assistant, opened at the root of this repo. It rebuilds the current static site in **Astro** so it is easier to maintain, while keeping the design and behaviour exactly as they are.

---

You are rebuilding the landing page in this repository with Astro. The current site (`index.html`, `assets/css/styles.css`, `assets/js/main.js`) is the **source of truth for design and behaviour**. Match it visually and functionally; don't redesign it. Read `CLAUDE.md` first: it explains the design tokens, sections, motion system, map data format and content rules. Follow those rules.

## Goal

A maintainable Astro project that builds to static files and deploys to GitHub Pages at `https://tdat10052499.github.io/surfside-sunrise/`. Content (copy, facts, photos, FAQ, cities, contacts) lives in data files, so the owner can update it without touching components.

## Tech requirements

- Astro (latest stable), TypeScript, no UI framework. Use vanilla `<script>` in components, because the site is mostly static with a few interactive islands.
- `astro.config.mjs`: `site: 'https://tdat10052499.github.io'`, `base: '/surfside-sunrise'`. Every asset and link path must respect `base`.
- Keep the current libraries and versions: GSAP 3.12.5 + ScrollTrigger, Lenis 1.1.13, Lucide icons. Install them from npm instead of CDNs (`gsap`, `lenis`, `lucide`). Fonts: Plus Jakarta Sans and Inter via `@fontsource` packages, or Google Fonts with `display=swap`.
- Images: move the photos to `src/assets/photos/` and render them with `astro:assets` `<Image>` (responsive `widths`, WebP/AVIF, correct `sizes`, `loading="lazy"` except the hero).
- CSS: keep the design tokens from the top of `styles.css` in `src/styles/tokens.css`. Use scoped styles per component, plus a small `global.css` for the reset, buttons and utilities.
- Deployment: add `.github/workflows/deploy.yml` that uses `withastro/action` and `actions/deploy-pages` on push to `main`. Document that the owner must set **Settings → Pages → Source: GitHub Actions** once.

## Structure

```
src/
  data/site.ts          name, tagline, location, coordinates, Airbnb URL, CONFIG contacts
  data/facts.ts         overview tiles, amenities, bedrooms
  data/photos.ts        photo list: file, alt, caption, gallery order
  data/faq.ts           questions and answers
  data/cities.ts        world-time cities: name, short code, IANA timezone
  data/map-data.txt     copy of assets/data/map-data.txt (served from /public)
  layouts/Base.astro    <head>: meta, Open Graph, favicon, fonts
  components/
    Header.astro  Menu.astro  WorldTime.astro  Hero.astro  Overview.astro
    Marquee.astro  Gallery.astro  Lightbox.astro  Experience.astro  Amenities.astro
    Rooms.astro  Reviews.astro  LocationMap.astro  Booking.astro  Faq.astro  Footer.astro
    FloatingBook.astro  Cursor.astro
  scripts/
    motion.ts     Lenis + ScrollTrigger setup and the data-attribute behaviours
    map.ts        SVG map renderer: pan, zoom, pinch, markers, scale bar
    worldtime.ts  city times, day/night, offset from Surfside
    sunrise.ts    sunrise calculation for 28.95 N, 95.29 W
    booking.ts    request form, message builder, copy button
  pages/index.astro
public/
  favicon.svg  data/map-data.txt  .nojekyll
```

## Must keep (acceptance criteria)

1. **Visuals:** the same palette, fonts, spacing, radii, section order and copy as the current site, at 390px, 768px, 1366px and 2000px. No horizontal scroll at any width.
2. **Motion:** smooth scroll; the hero shrinking into a rounded card; tone-shifting page background; word-fill statement; heading word lift; clip-reveal images; inner parallax; staggered grids; the velocity marquee; stacking experience cards; the pinned horizontal rooms on desktop with a progress bar (swipe on mobile); the booking image opening to full bleed; the curtain footer; the header hiding on scroll down; the floating round "Book" button; the custom cursor and magnetic buttons on desktop.
3. **Menu:** circular reveal, wordmark with the rising sun, today's sunrise time, world time for 6 cities (Surfside local, Mexico City, New York, London, Ho Chi Minh City, Tokyo) showing time, a day/night icon and hours compared with Surfside. It must be readable at a glance.
4. **Map:** SVG from the OpenStreetMap data, approximate house area, ~10-minute walk ring, Jetty Park marker, popups, zoom buttons, Ctrl/⌘ + wheel and pinch zoom, drag pan, scale bar, and the **"© OpenStreetMap contributors" link**.
5. **Booking form:** dates, guest stepper (1–8), name, contact, message, validation messages, nights summary, and a generated message with Copy / WhatsApp / Email / Airbnb options driven by `CONFIG`. It must never claim the request was sent.
6. **Accessibility:** keyboard access for the menu (Esc closes), lightbox (Esc, arrow keys), FAQ, carousel and map buttons; visible focus; `prefers-reduced-motion` disables Lenis and scroll effects.
7. **Quality:** Lighthouse mobile scores of at least 90 for Performance, Accessibility, Best Practices and SEO; no console errors; the page still renders fully if JavaScript fails.

## Content rules

Use only the facts listed in `CLAUDE.md`. Do not invent reviews, ratings, prices, policies or an exact address. Keep the house location labelled as approximate.

## Deliverables

1. The Astro project, with the old static files moved to `legacy/` for reference.
2. `README.md` covering how to run (`npm install`, `npm run dev`), where to edit content (`src/data/*`), how to add photos, and how deploy works.
3. A short report on anything that couldn't be matched exactly and why.

Work in small commits: scaffold, layout and tokens, sections one by one, motion, map, booking, deploy workflow. Run `npm run build` and fix errors before each commit.
