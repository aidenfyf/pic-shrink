# Pic Shrink

Shrink big iPhone screenshots (and any image) from 5–10 MB down to **under 1 MB** — without paying Adobe and without handing your photos to a sketchy website.

**Everything happens in your browser.** Your images are never uploaded, never sent to a server, never seen by anyone but you. You can turn off wifi and it still works. The whole thing is ~3 small files you can read yourself.

## How it works

1. Open the page.
2. Choose a **quality** (50–99%) and/or set a **target size** (default: under 1 MB).
3. Drop in / pick / paste your screenshots.
4. It re-encodes each image locally and shows you `before → after` with the % saved.
5. Hit **Download** (or **Download all**).

Under the hood it loads each picture into an HTML `<canvas>` and re-encodes it with the browser's built-in JPEG/WebP encoder. In "target" mode it automatically tunes quality (and, if needed, dimensions) to fit your size budget while staying as crisp as possible.

### Why screenshots get so much smaller
iPhone screenshots are saved as **PNG**, which is lossless and large. Converting to **JPEG** or **WebP** at ~80% quality is what drops them from megabytes to kilobytes — usually with no visible difference.

## Privacy

- No upload. No backend. No analytics. No cookies.
- No dependencies — zero third-party code.
- Open `app.js` and confirm: there is no `fetch`, no network call, nothing that leaves your device.

## Run it

It's a static site. Any of these work:

```bash
# Just open the file
open index.html

# …or serve it locally
python3 -m http.server 8000   # then visit http://localhost:8000
```

Deploy by dropping the folder on any static host (GitHub Pages, Netlify, Vercel, or your own server). No build step.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The page & layout |
| `style.css` | Styling (dark, mobile-first) |
| `app.js` | All the compression logic — fully client-side |

## License

MIT
