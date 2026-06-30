# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mellowstruck portfolio website for music producer/composer Jacob Salomon. Vanilla HTML/CSS/JS, no build step, no dependencies. Hosted via GitHub Pages as a subdirectory of the Quisdofeles.github.io repository.

## Development

Open any `.html` file directly in a browser to preview. No build step, no dev server, no packages to install. GSAP 3.12.5 is loaded from a CDN in each HTML file's `<head>`.

## File Structure

```
index.html          home page
about.html          about page
tracks.html         full track listing
contact.html        contact page
css/style.css       single shared stylesheet (all pages)
handler.js          single shared JS file (all pages, loaded at end of <body>)
audio/              MP3 audio files (e.g. Mellowstruck_YOU.mp3, Here-I-Lie.mp3)
images/             .webp images + .svg wordmark + favicon .ico/.png
fonts/              ClashDisplay-Bold, ClashGrotesk-Medium (loaded via @font-face)
```

## Design System

**Colors**
- Background: `#222222`
- Brand green: `#32B57C` — used for hover states, tag fills, waveform progress, link hovers

**Fonts**
- `Clash-Display-Bold` — h1, h2, h3, a elements
- `Clash-Grotesk-Medium` — p elements, button text

**Typography scale (clamp)**
- Hero h1: `clamp(2.4rem, 6vw, 7rem)`
- Section h2: `clamp(2rem, 4vw, 3.5rem)`
- Track title h3: `clamp(1.75rem, 3.5vw, 3rem)`
- Artist / body p: `clamp(1rem, 1.8vw, 1.5rem)`
- Description p: `clamp(1rem, 1.5vw, 1.125rem)`
- Tags, small links: `clamp(0.75rem, 1.2vw, 1rem)`

**Glassmorphism card standard** — used on about cards, featured works cards, and tracks cards:
```css
background: rgba(255, 255, 255, 0.08);
backdrop-filter: blur(40px);
-webkit-backdrop-filter: blur(40px);
border: 1px solid rgba(255, 255, 255, 0.25);
border-radius: 25px;
```

**Buttons** — pill style (`border-radius: 75px`), white border on dark background, full invert on hover:
```css
border: 3px solid white; color: white; border-radius: 75px;
/* hover: */ border-color: transparent; background-color: white; color: #222222;
```

**Tags** — two variants, both use `border-radius: 50px`:
- Filled: `background-color: #32B57C; color: #222222;` (`.top-tags p`, `.tracks-top-tags-*`)
- Outlined: `border: 2px solid #32B57C; color: #32B57C;` (`.bottom-tags p`, `.tracks-bottom-tags-*`)

## Page Structures

### index.html (Home)
1. **Hero** — full-viewport background image with animated h1 lines and logo bar marquee
2. **About section** (`#about`) — `.about-card` glassmorphism card with h2, p (desktop/mobile text swap spans), "Read More" link
3. **Featured Works** (`.featured-works`) — alternating `.featured-works-card-left` / `.featured-works-card-right` cards, each with `.left-side-wrapper` (song info + player) and `.right-side-wrapper` (`.tag-column` + `#image`)
4. **Contact section** (`.contact`) — background image, h2, p, link button
5. **Footer**

### about.html
- `#about-mellowstruck` — full-height background image section, `.about-mellowstruck-card` glassmorphism card with h2, paragraphs, link

### tracks.html
- `.tracks-page` — alternating `.tracks-dmt` and `.tracks-tmd` row groups, plus `#tracks-contact-button`
- **DMT row** (card left, tags right): `.tracks-card-dmt` | `.tracks-tags-dmt`
- **TMD row** (tags left, card right): `.tracks-tags-tmd` | `.tracks-card-tmd`
- **Card order inside `.tracks-card-dmt` / `.tracks-card-tmd`**: `h3` → `p` (artist credit, direct child) → `.player` → `.tracks-description-dmt` / `.tracks-description-tmd`
- **Description structure**:
  ```html
  <div class="tracks-description-dmt">
      <p>First paragraph (always visible)</p>
      <div class="description-extra">
          <p>Second paragraph</p>
          <p>Third paragraph</p>
      </div>
      <button class="show-more-btn">Show More...</button>
  </div>
  ```
- h2 uses `<span class="tracks-title-full">` / `<span class="tracks-title-short">` for responsive title swap at 500px

### contact.html
- `.contact-page` — background image, `.blurb` (h2 + p), `.social-cards` (email, Instagram cards), `#link-card` (explore tracks button)

## Custom Audio Player

Each player is a `.player` element with `data-src="audio/filename.mp3"`. All players on the page share a single `instances[]` array — pressing play on one pauses all others.

**HTML structure:**
```html
<div class="player" data-src="audio/Mellowstruck_YOU.mp3">
    <div class="player-controls">
        <input type="range" class="volume-slider" min="0" max="1" step="0.01" value="0.2">
        <button class="prev-btn">…</button>
        <button class="play-pause-btn">…</button>
        <button class="next-btn">…</button>
    </div>
    <canvas class="waveform-canvas"></canvas>
</div>
```

Note: volume slider position relative to prev/next buttons varies by card type (left cards have volume first; right cards have volume last).

**Waveform rendering** — Canvas 2D, 80px tall:
- 1000 amplitude samples from `getChannelData(0)` via Web Audio API
- Bars: 3px wide, 2px gap
- Played portion: `#32B57C`; unplayed: `rgba(255,255,255,0.3)`
- Minimum bar height: 3px

**Key flag**: `playerEl.dataset.waveformReady = "true"` is set on the `.player` element after `decodeAudioData` completes. The tracks page entrance animation polls this flag.

**Prev/next scroll**: after switching tracks, `card.scrollIntoView({ behavior: "smooth", block: "center" })` is called using:
```js
players[index].closest(".featured-works-card-left, .featured-works-card-right, .tracks-dmt, .tracks-tmd")
```

## Animation Conventions

All animations use **GSAP 3.12.5** (`gsap` + `ScrollTrigger`). On-load only — no scroll-triggered entrance animations (ScrollTrigger is used only for the logo bar velocity tracking).

**Standard entrance pattern** (used on about card, featured works, contact section, contact page):
```js
gsap.set(elements, { x: -50, opacity: 0 });
// timeline with -=0.2 overlap:
entranceTl.to(el, { x: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, i === 0 ? 0 : "-=0.2");
```

**Hero text variant** — larger travel distance and slower duration for dramatic effect:
```js
gsap.set(lines, { x: -100, opacity: 0 });
entranceTl.to(line, { x: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, i === 0 ? 0 : "-=0.4");
```
Hero text also uses a `ResizeObserver` to reinitialize animation when visible line count changes (responsive line reflow).

**Tracks page entrance** — waveform-ready polling pattern (each row animates when its audio decodes):
```js
gsap.set([title, ...groups, contactBtn], { x: -50, opacity: 0 });
gsap.to(title, { x: 0, opacity: 1, duration: 0.4, ease: "power3.out" });
groups.forEach(function(group) {
    var player = group.querySelector(".player");
    var checkReady = setInterval(function() {
        if (player.dataset.waveformReady === "true") {
            clearInterval(checkReady);
            gsap.to(group, { x: 0, opacity: 1, duration: 0.4, ease: "power3.out" });
        }
    }, 100);
});
setTimeout(function() { gsap.to(contactBtn, { x: 0, opacity: 1, duration: 0.4, ease: "power3.out" }); }, 2000);
```

**Logo bar** — `requestAnimationFrame` tick loop, velocity from `ScrollTrigger.getVelocity()`, lerped `currentSpeed` for smooth direction changes. 3 sets of logo images for seamless wrap. Constants at top of `handler.js` control speed behavior.

## Show More / Show Less Toggle

Tracks page descriptions use `.description-extra` to hide paragraphs after the first:
```css
.description-extra { display: none; flex-direction: column; gap: 1rem; }
.description-extra.open { display: flex; }
```
`.show-more-btn` toggles `.open` on `btn.previousElementSibling` and swaps its text between "Show More..." and "Show Less...".

## Responsive Breakpoints

Each section has its own breakpoints in `css/style.css`:

| Section | Breakpoints |
|---|---|
| Header | 750px (hamburger), 600px (hero line swap) |
| About section | 600px |
| About page | 1400px, 1200px, 1000px, 800px, 650px, 500px |
| Featured works | 1100px (column layout, player horizontal, tags visible), 720px (centered, tags hidden, volume hidden), 500px |
| Tracks page | 1000px (column layout, center align, `.tracks-tags-*` hidden), 720px (volume hidden, padding reduced), 500px (h2 title swap) |
| Contact section | 600px |
| Contact page | 1400px, 1275px, 600px |
| Footer | 600px |

At 1100px, featured works cards collapse from a two-column row to a vertical stack; at 720px they fully center and hide tags. At 1000px, tracks rows collapse similarly and hide the tag columns.

## Shared Components

Header and footer markup are duplicated across all 4 HTML files — there is no templating system. Changes to navigation or footer must be applied to every file.

## Footer

`.footer` uses `Footer-Wordmark.webp` as a background image with `aspect-ratio: 3814 / 812`. `.footer-content` is absolutely positioned over it; copyright, social icons, and nav links are positioned using `left`/`top` percentages. Nav links are hidden below 600px.

## Social Icon Hover Effect

Two-image swap technique: `.icon-white` and `.icon-green` stacked absolutely, `.icon-green` at `opacity: 0`, transitions to `opacity: 1` on hover. Footer uses `2.29vw` icon sizing. Contact page uses a gray variant.

## Known Pitfalls

**CSS scoping for shared classes** — `.player` and `.waveform-canvas` appear on both featured works (index.html) and tracks page. The featured works responsive media queries must scope these selectors with `.featured-works` to prevent leaking to the tracks page:
```css
/* Correct — scoped */
.featured-works .player { … }
.featured-works .waveform-canvas { … }
/* Wrong — leaks to tracks page */
.player { … }
```

**Direct child selectors on track cards** — `.tracks-card-dmt` and `.tracks-card-tmd` contain both an artist credit `p` (direct child) and description `p` elements (inside `.tracks-description-*`). Use `> p` to target only the direct child:
```css
.tracks-card-dmt > p { font-size: clamp(1rem, 1.8vw, 1.5rem); }   /* artist credit */
.tracks-description-dmt p { font-size: clamp(1rem, 1.5vw, 1.125rem); }  /* description */
```
Without `>`, the more specific selector wins and description text gets the wrong size.

**HTML ID validity** — IDs must not contain apostrophes. Use `youre-for-me` not `you're-for-me`, `arachnids-dance` not `arachnid's-dance`.

**`pointer-events: none` on pseudo-elements** — overlay pseudo-elements (e.g. `.contact::after` gradient fade) must have `pointer-events: none` or they block clicks on content beneath them.
