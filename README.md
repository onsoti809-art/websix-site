# Websix — Agency Website

Marketing site for **Websix**, a boutique web design & development studio building fast, mobile-first, SEO-ready websites for local and small businesses.

**Live domain:** [websix.site](https://websix.site)

## What's here

A fast, dependency-free static site (no build step required).

| File | Purpose |
|------|---------|
| `index.html` | The full one-page site (hero, services, process, pricing, about, FAQ, contact). Self-contained HTML/CSS/JS. |
| `404.html` | Branded not-found page. |
| `favicon.svg` | Hexagon logo mark. |
| `assets/og.png` | Social share image (1200×630). **Add this file** — see below. |
| `CNAME` | Custom domain for GitHub Pages (`websix.site`). |
| `robots.txt` / `sitemap.xml` | SEO basics. |

## Deploy with GitHub Pages (free)

1. Push this repo to GitHub (already done if you're reading this on GitHub).
2. Go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Select branch **`main`** and folder **`/ (root)`**, then **Save**.
5. Under **Custom domain**, confirm it shows `websix.site` (from the `CNAME` file) and enable **Enforce HTTPS** once the certificate is issued.

### DNS for websix.site

At your domain registrar, point the domain to GitHub Pages:

- **Apex `websix.site`** — add four `A` records:
  - `185.199.108.153`
  - `185.199.109.153`
  - `185.199.110.153`
  - `185.199.111.153`
- **`www.websix.site`** — add a `CNAME` record to `onsoti809-art.github.io`

DNS changes can take a little while to propagate. GitHub Pages then serves the site over HTTPS automatically.

## Add the social image

`index.html` references `assets/og.png` for link previews (Facebook, X, iMessage, etc.). Drop a **1200×630 PNG** at `assets/og.png` (a branded card was generated to accompany this build — upload it there).

## Contact form

The audit form works out of the box by opening the visitor's email app to `websixagency@gmail.com`. To receive submissions directly in your inbox instead, create a free [Formspree](https://formspree.io) form and replace `FORMSPREE_ENDPOINT` in `index.html` with your form URL.

## Editing

Everything is plain HTML/CSS/JS in `index.html` — open it in any editor and change text, prices, or colors (see the CSS variables at the top of the `<style>` block). No frameworks, no build tools.

---
© 2026 Websix.
