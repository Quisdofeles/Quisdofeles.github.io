# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mellowstruck portfolio website for music producer/composer Jacob Salomon. A portfolio site hosted via GitHub Pages as a subdirectory of the Quisdofeles.github.io repository.

## Development

Open any `.html` file directly in a browser to preview. No build step, no dev server, no dependencies to install.

## Architecture

- **4 pages**: `index.html` (home), `about.html`, `tracks.html`, `contact.html`
- **Single stylesheet**: `css/style.css` — all styling for all pages lives here
- **Custom fonts**: `fonts/` — ClashDisplay-Bold (headings/links) and ClashGrotesk-Medium (body text), loaded via `@font-face`
- **Images**: `images/` — all `.webp` format (plus favicon `.ico`/`.png`); filenames use Title-Case-With-Hyphens

## Design System

- **Brand color**: `#32B57C` (green) — used for hover states, tags, accents
- **Background**: `#222222` (dark gray)
- **Fonts**: `Clash-Display-Bold` for h1/h2/h3/a elements, `Clash-Grotesk-Medium` for p elements and button text
- **Buttons**: Rounded pill style (`border-radius: 75px`), white border on dark, inverts on hover
- **Cards**: Use `::before` pseudo-elements with gradient borders and `mask-composite: exclude` for the glowing border effect — this pattern is used on about cards, featured work cards, and track media player cards

## Layout Patterns

- **Featured tracks on index.html** alternate between `featured-works-card-left` and `featured-works-card-right` — these mirror layout direction (text left/image right vs image left/text right) and gradient direction
- **Tracks page** uses a similar alternating pattern: `tracks-dmt` (description-mediaplayer-tags left-to-right) and `tracks-tmd` (tags-mediaplayer-description, reversed)
- **Audio embeds**: Disco.ac iframes wrapped in a container (`.disco` / `.mediaplayer-dmt` / `.mediaplayer-tmd`) that clips the iframe with `overflow: hidden` and `transform: translate(-10px, -95px)` to show only the play controls

## Responsive Breakpoints

The CSS uses granular `@media (max-width: ...)` queries at: 1550px, 1435px, 1400px, 1300px, 1275px, 1250px, 1190px, 1111px, 1050px, 990px, 950px, 900px, 850px, 810px, 800px, 750px, 700px, 675px, 650px, 600px, 530px, 500px, 450px, 400px, 395px. Each section (hero, logo bar, about, featured works, tracks, contact, footer) has its own set of breakpoints. At narrower widths, featured work cards collapse from row to column layout.

## Shared Components

Header and footer markup are duplicated across all 4 HTML files — there is no templating system. Changes to navigation or footer must be applied to every file.

## Footer

The footer uses the `Footer-Wordmark.webp` image as a background with `aspect-ratio: 3814 / 812` and absolutely positions content (copyright, social icons, nav links) on top of it using percentage-based positioning.

## Social Icon Hover Effect

Social icons use a two-image swap technique: a white icon (`.icon-white`) and green icon (`.icon-green`) stacked with absolute positioning, where the green icon has `opacity: 0` and fades in on hover. The contact page uses a gray variant instead of green for its icon hover.
