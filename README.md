# Global News — live version

A Vercel-ready version of the Global News site whose story wire actually
updates while the page is open, instead of staying frozen at one snapshot.

## What is in this folder

- `index.html` — the full current site (Top, Watch with the flat 3D TV,
  Clips, Listen, Globe, Wire, Timelines, Data, Library, Archive), copied
  from the Oct 28–29 static build, plus a live-polling script at the end
  of the body. The baked-in Oct 28, 2026 snapshot is still in the page
  and is the first paint and the fallback.
- `api/feeds.js` — a Vercel serverless function (Node, no dependencies).
  It fetches the outlets' public RSS/Atom feeds server-side, because
  browsers block direct RSS fetches (CORS), parses headlines, snippets,
  links, dates and images, dedupes by URL, sorts newest first, and
  returns JSON. Headlines and snippets only, always linking to the
  original story, never full article text.
- `vercel.json` — minimal config. No rewrite is needed for the API:
  Vercel automatically serves `api/feeds.js` at `/api/feeds`.
- `package.json` — declares Node >= 18 and no dependencies.

## How live updating works

1. On load, the page shows the baked-in snapshot immediately.
2. After 15 seconds it polls `/api/feeds`, then every 5 minutes while
   the tab is visible (polling pauses in a background tab and resumes
   on return).
3. New stories are merged into the same `ARTICLES` array the original
   page renders from, sorted newest first, then the page re-renders
   Top story, ticker, lead story, story grid, live blog and the four
   story timelines in place, without a reload. Filters, search and
   saved stories keep working, because they all read that same array
   and the same `render()` function; saved stories are keyed by URL,
   so a saved story stays saved after a live refresh.
4. The header shows "Live · updated HH:MM" and a "Last good snapshot"
   line. If `/api/feeds` fails, returns no stories, or returns
   malformed data, the page keeps showing the baked-in snapshot and
   says the live feed is unavailable. It never blanks the page.

## What updates live, and what does not

Updates live (via `/api/feeds`):
- Ticker, Top story, Lead story, story grid, live blog, story
  timelines (the same four threads: Israel election, Spain train
  crash, Ukraine, endless cruise — new matching stories join them).

Stays baked-in (unchanged from the static build):
- Globe event layers, weather, markets tape, YouTube TV/clips
  (those already update live from their own APIs/players), Listen
  podcast episodes, social wire posts, Library directory copy, and
  the Archive history timeline. Those are not fed by `/api/feeds`.

## Feeds (24 entries, 14 outlets, CNN excluded)

BBC News (Top, World, Business, Technology, Science, Health, Culture,
Politics), BBC Sport, Al Jazeera, NPR, The Guardian (World), DW News,
France 24, Sky News (Home, World), The New York Times (Home, World),
CBC News (Top, World), ABC News (Australia) Just In, Euronews,
Politico, Axios.

CNN is excluded on purpose: its feed was frozen in April 2023 and its
items carried no real publication dates, which previously let stale
stories pose as breaking news. The word CNN appears in this README
and in an explanatory comment in `api/feeds.js` only; it is not in
the feed list.

Feeds that could not be fully verified at build time (they are
skipped and reported as failed if they do not answer, never faked):
- BBC Science, Health, Culture and Politics section URLs — plausible
  BBC section paths, not confirmed in the 2026 directories checked.
- ABC News (Australia) Just In feed id 51120 (a second id, 45910,
  also circulates in directories).
- Euronews `euronews.com/rss` (an older FeedBurner variant also
  circulates).
- In a local smoke test on 2026-11-01, both CBC feeds aborted
  (timeout) while 22 of 24 feeds answered, so CBC may be slow or
  blocking this fetcher; live, it will simply be reported failed
  until it answers.

## Caching

- Server: the aggregated result is cached in memory for 5 minutes
  (`CACHE_TTL_MS`). Repeated page polls inside that window get the
  cached JSON, so outlets are not hammered.
- HTTP: `Cache-Control: public, max-age=300, s-maxage=300,
  stale-while-revalidate=60`, plus an `X-Live-Cache: hit/miss` header.
- Per-feed fetch timeout is 8 seconds; feeds are fetched in parallel
  with `Promise.allSettled`, so one slow outlet cannot block the rest.

## Deploy to the existing Vercel project

This folder is NOT pushed anywhere by this build. To deploy it
(the parent agent does the push and live verification separately):

1. Replace the contents of repo `shipking-ai/global-news` (branch
   `main`) with the contents of this folder: `index.html`,
   `api/feeds.js`, `vercel.json`, `package.json`. The repo must
   contain no other files, as before.
2. Push to `main`. Vercel project `global-news` (Hobby) auto-deploys
   from that repo and will serve `index.html` at the root and the
   function at `/api/feeds`.
3. Verify live: open https://theredring.vercel.app/, wait ~15 seconds,
   and check the "Live · updated" line, a new story appearing in the
   grid, and that the TV still shows video (not audio-only).
   Also open https://theredring.vercel.app/api/feeds directly and
   check `ok: true`, `feedsOk`, and `feedsFailed`.

Do NOT put any API key or secret in this folder. There are none, and
none are needed. Guardian and NYT archive panels in the Archive
section remain "Awaiting key" until keys are supplied separately at
build time; they are not part of `/api/feeds`.

## Flat TV fix — do not regress this

The YouTube iframe's ancestors (`.room` / `#tvRoom`, `.tv-unit`,
`.tv`, `.screen-wrap`, `.video-frame`) must carry NO `perspective`
and NO CSS `transform`. A transformed ancestor makes browsers
composite the iframe's video onto a separate layer that never
paints, which shows up as audio with a black screen. The only
`transform: rotate` left in the page is on `.remote`, which is a
sibling of the TV unit, not an ancestor of the iframe, and it is
disabled on mobile. The live-polling script adds no transforms.

## Limitations to know before going live

- Vercel Hobby serverless functions have execution limits (default
  around 10 seconds on Hobby; this function fetches 24 feeds in
  parallel with an 8-second per-feed timeout, so a slow feed set can
  approach that limit — failed feeds are skipped, and the in-memory
  cache means most polls are cache hits, not fresh fetches).
- In-memory cache is per function instance, not shared across
  Vercel's edge instances, so the first poll after a cold start
  always fetches fresh, and different visitors may briefly see
  different cache states. Cold starts add a second or two.
- Outlets can rate-limit, block, or change a feed URL at any time;
  that feed is then reported in `feedsFailed` and skipped, not faked.
- The page polls every 5 minutes, not every second. "Live" here
  means minutes-fresh stories, which is how text news sites work;
  only the YouTube video itself is truly real-time.
- Vercel Hobby is non-commercial. If the site is ever ad-monetised,
  it needs Pro (or another host), as before.
