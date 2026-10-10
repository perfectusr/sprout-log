# 🌱 Sprout Log

A free, unofficial grow tracker for Auk indoor gardens (Auk Mini 2, Auk Mini 1 and Auk 1).

Pick your model and what you sowed in each pot, and Sprout Log shows:

- **What to expect and when** for every pot: sprouting, thinning, flowering, fruit and harvest windows
- **Today's tasks**: watching for sprouts, thinning, pollinating, trimming, raising the light, refills
- **The right light mode and nutrient dose** for your model and what you're growing
- **A grow log** for notes, heights, refills and harvests, plus a history of past plantings

Everything is saved in the visitor's own browser. There are no accounts and no database. The site counts anonymous visits with Vercel Web Analytics, which doesn't use cookies.

## Where the growing info comes from

All seed and device data lives in [`data/library.js`](data/library.js). Every timing is labelled with where it came from:

| Label | Meaning |
|---|---|
| `auk` | Auk's own help-centre guide for that exact plant |
| `auk-group` | Auk's guide for the plant's group (e.g. their chili guide for a specific chili) |
| `general` | General growing guidance; Auk doesn't publish a figure for that plant |

The app shows these labels next to each expected date, and links to the Auk articles. Descriptions in the library are written in our own words; please keep it that way and link to Auk rather than copying their text.

### Adding or fixing a seed

Add an entry to `seeds` in `data/library.js`. Timings are days after sowing; temperatures are °C (the app converts to °F). Copy a similar entry and adjust it. The comments at the top of the file explain each field.

### Monthly doc check

`.github/workflows/check-auk-docs.yml` runs on the 1st of every month (or on demand from the **Actions** tab). It re-reads every linked Auk article and compares a fingerprint of its text with `data/doc-hashes.json`. If anything changed or disappeared, it opens a pull request listing the articles and which seeds use them. Review those entries in `library.js`, update `checked` at the top of the file, and merge.

One-time setup: in the repo's **Settings → Actions → General**, under *Workflow permissions*, choose **Read and write permissions** and tick **Allow GitHub Actions to create and approve pull requests**.

Run it locally with `node scripts/check-docs.mjs` (Node 18+).

## Run it locally

It's a static site with no build step. Open `index.html` in a browser, or serve the folder:

```bash
npx serve .
```

## Deploy

**Vercel:** import this repo at vercel.com/new, choose the **Other** framework preset, and leave the build settings empty. Every push to `main` redeploys.

**GitHub Pages (alternative):** Settings → Pages → Deploy from branch → `main` / root.

## Moving data from the original single-page tracker

Sprout Log reads the original tracker's data automatically if it's in the same browser. Otherwise, use **Export backup** on the old page and **Import backup** here. Older backups are converted on import.

## Disclaimer

Sprout Log is an independent project. It isn't made, endorsed or supported by Auk. "Auk" and its product names belong to their owner and are used only to describe compatibility. Plants vary with temperature and light, so treat the dates as a guide.

## License

MIT
