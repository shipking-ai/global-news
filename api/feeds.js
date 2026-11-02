'use strict';
/*
 * Global News — live feed proxy (Vercel serverless function)
 *
 * Why this exists: browsers block direct RSS fetches from most news
 * outlets (CORS), so a static page cannot poll them itself. This function
 * runs on Vercel, fetches the outlets' public RSS/Atom feeds server-side,
 * and returns headlines + snippets + links as JSON. The page polls it.
 *
 * Rules baked in here:
 * - Headlines and snippets only, always linking to the original story.
 *   Never full article text.
 * - CNN is EXCLUDED on purpose. Its feed was frozen in April 2023 and
 *   its items carried no real publication dates, which previously let
 *   stale stories pose as breaking news. Do not re-add it.
 * - No API keys, no secrets, no paid services.
 * - A failed feed is skipped and reported in `feedsFailed`. Nothing is
 *   invented, and a feed failure never produces fake stories.
 * - Items without a parseable publication date are skipped. That is the
 *   same guard that caught the frozen CNN feed: a story must carry a
 *   genuine timestamp, never the fetch time.
 */

const FEEDS = [
  // BBC — section feeds reproduce the original snapshot's categories.
  { source: 'BBC News', category: 'Top Stories', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { source: 'BBC News', category: 'World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { source: 'BBC News', category: 'Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
  { source: 'BBC News', category: 'Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
  // The three BBC section URLs below were not confirmed in the
  // 2026 feed directories checked for this build. They are included
  // because a failure here is harmless (skipped + reported), and
  // because without them live Health/Science/Culture/Politics from
  // the BBC would have no feed to come from.
  { source: 'BBC News', category: 'Science', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml' },
  { source: 'BBC News', category: 'Health', url: 'https://feeds.bbci.co.uk/news/health/rss.xml' },
  { source: 'BBC News', category: 'Culture', url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml' },
  { source: 'BBC News', category: 'Politics', url: 'https://feeds.bbci.co.uk/news/politics/rss.xml' },
  { source: 'BBC Sport', category: 'Sport', url: 'https://feeds.bbci.co.uk/sport/rss.xml' },
  { source: 'Al Jazeera', category: 'World', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { source: 'NPR', category: 'Top Stories', url: 'https://feeds.npr.org/1001/rss.xml' },
  { source: 'The Guardian', category: 'World', url: 'https://www.theguardian.com/world/rss' },
  { source: 'DW News', category: 'World', url: 'https://rss.dw.com/rdf/rss-en-all' },
  { source: 'France 24', category: 'World', url: 'https://www.france24.com/en/rss' },
  { source: 'Sky News', category: 'Top Stories', url: 'https://feeds.skynews.com/feeds/rss/home.xml' },
  { source: 'Sky News', category: 'World', url: 'https://feeds.skynews.com/feeds/rss/world.xml' },
  { source: 'The New York Times', category: 'Top Stories', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml' },
  { source: 'The New York Times', category: 'World', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml' },
  { source: 'CBC News', category: 'Top Stories', url: 'https://www.cbc.ca/webfeed/rss/rss-topstories' },
  { source: 'CBC News', category: 'World', url: 'https://www.cbc.ca/webfeed/rss/rss-world' },
  // ABC News (Australia) "Just In". A second ABC feed id (45910) also
  // appears in some directories; 51120 is the Just In feed cited in
  // two 2026 directories. If it 404s, it is skipped and reported.
  { source: 'ABC News (Australia)', category: 'World', url: 'https://www.abc.net.au/news/feed/51120/rss.xml' },
  // Euronews: euronews.com/rss is cited in 2026 directories; an older
  // FeedBurner variant also circulates. This URL is the least certain
  // of the verified set and is reported as failed if it does not answer.
  { source: 'Euronews', category: 'World', url: 'https://www.euronews.com/rss' },
  { source: 'Politico', category: 'Politics', url: 'https://rss.politico.com/politics-news.xml' },
  { source: 'Axios', category: 'Top Stories', url: 'https://api.axios.com/feed/' },
  // --- Added 2026-11-01: defense, Ukraine, US politics, general ---
  // Defense / Pentagon. Breaking Defense and Defense One were
  // fetched and confirmed with Oct 30-31, 2026 items; DVIDS with
  // Nov 1, 2026 items. Military Times and The War Zone are listed
  // in 2026 feed directories at these exact URLs; they were not
  // fetched by the builder's text fetcher (domain blocked there),
  // so the live /api/feeds check is the final word on them and a
  // failure is skipped and reported, never faked.
  { source: 'Breaking Defense', category: 'World', url: 'https://breakingdefense.com/feed/' },
  { source: 'Defense One', category: 'World', url: 'https://www.defenseone.com/rss/all' },
  { source: 'DVIDS', category: 'World', url: 'https://www.dvidshub.net/rss/news' },
  { source: 'Military Times', category: 'World', url: 'https://www.militarytimes.com/arc/outboundfeeds/rss/' },
  { source: 'The War Zone', category: 'World', url: 'https://twz.com/feed' },
  // Ukraine. Kyiv Independent's feed is listed by Feeder as working
  // with a post 6 minutes before its check; UNIAN English is listed
  // at this exact URL in 2026 Ukraine feed directories. Both were
  // not fetched by the builder's text fetcher (domains blocked
  // there), so the live check is the final word. Ukrainska Pravda's
  // listed feed is pravda.com.ua/rss (the outlet's main RSS); it may
  // carry Ukrainian-language items, so it is included for coverage
  // and reported as failed if it does not answer usefully.
  { source: 'Kyiv Independent', category: 'World', url: 'https://kyivindependent.com/news-archive/rss/' },
  { source: 'UNIAN', category: 'World', url: 'https://rss.unian.net/site/news_eng.rss' },
  { source: 'Ukrainska Pravda', category: 'World', url: 'https://www.pravda.com.ua/rss' },
  // US politics / midterms. NBC Politics, CBS Politics and ABC
  // News (US) top stories are listed with fresh Oct 2026 items in
  // a 2026 tested-feed survey; The Hill's feed path is indicated
  // by a feed mirror listing for thehill.com/news/feed/; NPR
  // Politics (1014) follows the same feeds.npr.org pattern as the
  // already-working NPR feed (1001); NYT Politics follows the same
  // rss.nytimes.com pattern as the already-working NYT feeds.
  // None of these six were fetched by the builder's text fetcher
  // (domains blocked there), so the live check is the final word.
  { source: 'NBC News', category: 'Politics', url: 'https://feeds.nbcnews.com/nbcnews/public/politics' },
  { source: 'CBS News', category: 'Politics', url: 'https://www.cbsnews.com/latest/rss/politics' },
  { source: 'ABC News (US)', category: 'Top Stories', url: 'https://abcnews.go.com/abcnews/topstories' },
  { source: 'The Hill', category: 'Politics', url: 'https://thehill.com/news/feed/' },
  { source: 'NPR', category: 'Politics', url: 'https://feeds.npr.org/1014/rss.xml' },
  { source: 'The New York Times', category: 'Politics', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml' },
  // General gaps: business, technology, and a major US paper.
  // CNBC's top-news feed is listed at this exact URL in 2026 feed
  // directories; Ars Technica's main feed is listed in multiple
  // 2026 tech-feed surveys with ~299 posts in the last 30 days.
  // Washington Post was tried and REMOVED: its world feed
  // (feeds.washingtonpost.com/rss/world) aborted in the Nov 1, 2026
  // smoke test, matching Oct 2026 reports of server errors on WaPo
  // feeds. Do not re-add it without a fresh passing fetch.
  { source: 'CNBC', category: 'Business', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
  { source: 'Ars Technica', category: 'Technology', url: 'https://feeds.arstechnica.com/arstechnica/index' },
];

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes, in memory
const PER_FEED_ITEMS = 25;
const TOTAL_ITEMS = 500; // Raised from 400 when the feed count grew 24 -> 40, so older-but-still-recent stories (e.g. Oct 29-30 Pentagon news) are less likely to be cut by Nov 1-2 volume. Fetching is parallel, so this does not add fetch time.
const FETCH_TIMEOUT_MS = 8000;

let cache = null; // { fetchedAt, payload }

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCharCode(parseInt(n, 10)); } catch { return ''; }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => {
      try { return String.fromCharCode(parseInt(n, 16)); } catch { return ''; }
    });
}

function stripHtml(s) {
  return decodeEntities(String(s || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract the text of <tag>…</tag>, tolerating CDATA and namespaces
// (e.g. <media:content> is handled separately for images).
function tagText(block, tag) {
  const re = new RegExp('<(?:[^:>\\s]+:)?' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[^:>\\s]+:)?' + tag + '>', 'i');
  const m = block.match(re);
  if (!m) return '';
  let v = m[1].trim();
  if (v.startsWith('<![CDATA[')) v = v.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
  return stripHtml(v);
}

function firstImage(block) {
  const candidates = [];
  const media = block.match(/<media:content[^>]*url=["']([^"']+)["'][^>]*>/i);
  if (media) candidates.push(media[1]);
  const thumb = block.match(/<media:thumbnail[^>]*url=["']([^"']+)["'][^>]*>/i);
  if (thumb) candidates.push(thumb[1]);
  const enc = block.match(/<enclosure[^>]*type=["']image\/[^"']*["'][^>]*url=["']([^"']+)["'][^>]*>/i)
    || block.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*type=["']image\/[^"']*["'][^>]*>/i);
  if (enc) candidates.push(enc[1]);
  const img = block.match(/<image[^>]*>\s*<url>([^<]+)<\/url>/i);
  if (img) candidates.push(img[1]);
  // An <img> inside a description/content blob.
  const desc = block.match(/<description[^>]*>([\s\S]*?)<\/description>/i)
    || block.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i);
  if (desc) {
    const im = desc[1].match(/<img[^>]*src=["']([^"']+)["']/i);
    if (im) candidates.push(im[1]);
  }
  for (const c of candidates) {
    if (c && /^https?:\/\//i.test(c)) return c;
  }
  return null;
}

function parseFeed(xml, feed) {
  const items = [];
  const blocks = [];
  const itemRe = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) blocks.push(m[1]);
  for (const block of blocks.slice(0, PER_FEED_ITEMS)) {
    const title = tagText(block, 'title');
    // RSS: <link>text</link>. Atom: <link href="…" />.
    let link = tagText(block, 'link');
    if (!link) {
      const href = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
      if (href) link = href[1];
    }
    if (!title || !link) continue;
    const description = tagText(block, 'description')
      || tagText(block, 'summary')
      || tagText(block, 'content')
      || '';
    const dateRaw = tagText(block, 'pubDate')
      || tagText(block, 'published')
      || tagText(block, 'updated')
      || tagText(block, 'date');
    const publishedAt = dateRaw ? Date.parse(dateRaw) : NaN;
    // No genuine timestamp -> skip. Never stamp it with the fetch time.
    if (!isFinite(publishedAt) || publishedAt <= 0) continue;
    items.push({
      url: link.trim(),
      title: title.slice(0, 300),
      description: description.slice(0, 500),
      source: feed.source,
      category: feed.category,
      imageUrl: firstImage(block),
      publishedAt,
    });
  }
  return items;
}

async function fetchFeed(feed) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetch(feed.url, {
      signal: controller ? controller.signal : undefined,
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        'User-Agent': 'GlobalNewsLive/1.0 (news aggregator; headlines and snippets only, linking to originals)',
      },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const xml = await res.text();
    if (!xml || xml.length < 100) throw new Error('empty feed');
    return { feed, articles: parseFeed(xml, feed) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method && req.method !== 'GET') {
      res.status(405).json({ ok: false, error: 'GET only' });
      return;
    }
    const now = Date.now();
    if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=60');
      res.setHeader('X-Live-Cache', 'hit');
      res.status(200).json(cache.payload);
      return;
    }
    const results = await Promise.allSettled(FEEDS.map(fetchFeed));
    const seen = new Set();
    const articles = [];
    const feedsFailed = [];
    let feedsOk = 0;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status !== 'fulfilled') {
        feedsFailed.push({ source: FEEDS[i].source, url: FEEDS[i].url, error: String((r.reason && r.reason.message) || r.reason || 'fetch failed') });
        continue;
      }
      feedsOk++;
      for (const a of r.value.articles) {
        if (seen.has(a.url)) continue;
        seen.add(a.url);
        articles.push(a);
      }
    }
    articles.sort((a, b) => b.publishedAt - a.publishedAt);
    const payload = {
      ok: true,
      fetchedAt: now,
      articles: articles.slice(0, TOTAL_ITEMS),
      feedsOk,
      feedsTotal: FEEDS.length,
      feedsFailed,
      // The frontend must keep its baked-in snapshot if this is empty.
      note: 'Headlines and snippets only; every story links to the original outlet.',
    };
    cache = { fetchedAt: now, payload };
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=60');
    res.setHeader('X-Live-Cache', 'miss');
    res.status(200).json(payload);
  } catch (err) {
    // Never return an empty success that would wipe the page's snapshot.
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ ok: false, error: String((err && err.message) || err) });
  }
};
