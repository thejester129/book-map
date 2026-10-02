# BookMap

A world map of the books you've read, coloured by where each author comes from.

## Structure

- `src/index.template.html` — the app (HTML, CSS and JavaScript in one file)
- `src/countries-topo.json` — world borders (Natural Earth 1:50m via the `world-atlas` package, names tidied)
- `build.js` — inlines the map data into the template
- `dev.js` / `start.sh` — local dev server with rebuild and live reload
- `dist/index.html` — the built, self-contained page

## Build

    node build.js

## Develop

    ./start.sh [port]

Serves the page at http://localhost:8000. Whenever a file in `src/` changes, it rebuilds
`dist/index.html` and the open browser tab reloads itself.

## Notes

- d3, topojson-client and PapaParse load from cdn.jsdelivr.net.
- Author countries come from Wikidata (query.wikidata.org, free, no key). Each author is
  matched by name, preferring writers and better-known people. Each linked country is
  scored: citizenship and the nationality in their Wikidata description ("Irish
  novelist") count most, and where they worked, died and were born add a little.
  Authors it can't find are left for you to set by hand.
- Account saving uses the claude.ai artifact runtime (`claude.use("db")`). Opened outside
  claude.ai, the page saves to the browser only.
# book-map
