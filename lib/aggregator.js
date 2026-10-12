'use strict';

const { toKeys, GENRES } = require('./genres');

const PAGE = 100;                 // dimensione pagina standard dei cataloghi Stremio
const TTL = 6 * 60 * 60 * 1000;   // l'indice viene ricostruito ogni 6 ore
const FETCH_TIMEOUT = 12000;
const CINEMETA = 'https://v3-cinemeta.strem.io';

// ---------- utilità HTTP ----------

async function getJSON(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'stremio-generi/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// Esegue fn su tutti gli elementi con al massimo `n` richieste in parallelo.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch { out[idx] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

// Accetta "stremio://...", "https://.../manifest.json" o la sola base.
function baseOf(url) {
  let u = String(url).trim().replace(/^stremio:\/\//i, 'https://');
  u = u.replace(/\/manifest\.json(\?.*)?$/i, '').replace(/\/+$/, '');
  return u;
}

function extraPath(extra) {
  const parts = Object.entries(extra).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? '/' + parts.join('&') : '';
}

// ---------- raccolta dai cataloghi sorgente ----------

// Restituisce i cataloghi utilizzabili di un addon (film e serie, senza extra obbligatori
// diversi da "genre", e non di sola ricerca).
function usableCatalogs(manifest) {
  const cats = [];
  for (const c of manifest.catalogs || []) {
    if (c.type !== 'movie' && c.type !== 'series') continue;
    const extras = c.extra || [];
    const required = new Set([
      ...(c.extraRequired || []),
      ...extras.filter(e => e.isRequired).map(e => e.name),
    ]);
    if ([...required].some(r => r !== 'genre')) continue; // es. cataloghi di sola ricerca
    const genreExtra = extras.find(e => e.name === 'genre');
    const genreOptions = genreExtra && Array.isArray(genreExtra.options) ? genreExtra.options : [];
    const supportsSkip = extras.some(e => e.name === 'skip') || (c.extraSupported || []).includes('skip');
    cats.push({ type: c.type, id: c.id, name: c.name, genreRequired: required.has('genre'), genreOptions, supportsSkip });
  }
  return cats;
}

async function fetchCatalogPages(base, cat, extra, pages, tagKeys) {
  const items = [];
  const maxPages = cat.supportsSkip ? pages : 1;
  for (let p = 0; p < maxPages; p++) {
    const e = { ...extra };
    if (p > 0) e.skip = p * PAGE;
    let data;
    try {
      data = await getJSON(`${base}/catalog/${cat.type}/${encodeURIComponent(cat.id)}${extraPath(e)}.json`);
    } catch { break; }
    const metas = Array.isArray(data && data.metas) ? data.metas : [];
    for (const m of metas) if (m && m.id) items.push({ meta: m, type: cat.type, tags: tagKeys });
    if (metas.length < PAGE / 2) break; // ultima pagina
  }
  return items;
}

// Arricchisce con i generi di Cinemeta i titoli IMDb (tt...) che ne sono privi.
async function enrichGenres(entries, limit) {
  const missing = entries.filter(e => !e.keys.size && /^tt\d+/.test(e.meta.id)).slice(0, limit);
  await pool(missing, 8, async e => {
    const id = e.meta.id.split(':')[0];
    const data = await getJSON(`${CINEMETA}/meta/${e.type}/${id}.json`);
    const g = data && data.meta && (data.meta.genres || data.meta.genre);
    if (Array.isArray(g)) {
      toKeys(g).forEach(k => e.keys.add(k));
      if (!e.meta.genres) e.meta.genres = g;
    }
  });
}

async function buildIndex(cfg) {
  const started = Date.now();
  const wanted = { movie: new Set(cfg.movie), series: new Set(cfg.series) };
  const sources = await pool(cfg.addons, 4, async url => {
    const base = baseOf(url);
    const manifest = await getJSON(`${base}/manifest.json`);
    return { base, manifest };
  });

  const jobs = [];
  for (const src of sources) {
    if (!src || !src.manifest) continue;
    for (const cat of usableCatalogs(src.manifest)) {
      if (!wanted[cat.type].size) continue;
      // 1) catalogo "normale", se il genere non è obbligatorio
      if (!cat.genreRequired) jobs.push(() => fetchCatalogPages(src.base, cat, {}, cfg.pages, []));
      // 2) varianti per genere, se il catalogo le espone: più titoli per ogni categoria
      if (cfg.useGenreFilters || cat.genreRequired) {
        for (const opt of cat.genreOptions) {
          const keys = toKeys([opt]).filter(k => wanted[cat.type].has(k));
          if (keys.length) jobs.push(() => fetchCatalogPages(src.base, cat, { genre: opt }, Math.max(1, Math.ceil(cfg.pages / 2)), keys));
        }
      }
    }
  }

  const results = await pool(jobs, 6, job => job());

  // Unione e deduplica: stesso id + stesso tipo = stesso titolo.
  const byId = new Map();
  let order = 0;
  for (const list of results) {
    for (const it of list || []) {
      const key = `${it.type}:${it.meta.id}`;
      let e = byId.get(key);
      if (!e) {
        e = { type: it.type, meta: { ...it.meta, type: it.type }, keys: new Set(), order: order++, hits: 0 };
        byId.set(key, e);
      } else {
        // completa i campi mancanti con quelli di altri addon
        for (const [k, v] of Object.entries(it.meta)) if (e.meta[k] === undefined || e.meta[k] === null || e.meta[k] === '') e.meta[k] = v;
      }
      e.hits++;
      toKeys(it.meta.genres || it.meta.genre || []).forEach(k => e.keys.add(k));
      it.tags.forEach(k => e.keys.add(k));
    }
  }

  const entries = [...byId.values()];
  if (cfg.enrich) await enrichGenres(entries, cfg.enrichLimit);

  const index = { movie: {}, series: {} };
  for (const type of ['movie', 'series']) for (const k of wanted[type]) index[type][k] = [];
  for (const e of entries) {
    for (const k of e.keys) if (index[e.type][k]) index[e.type][k].push(e);
  }
  for (const type of ['movie', 'series']) {
    for (const k of Object.keys(index[type])) index[type][k] = sortEntries(index[type][k], cfg.sort).map(e => e.meta);
  }

  return {
    index,
    stats: {
      sources: sources.filter(Boolean).length,
      titles: entries.length,
      unclassified: entries.filter(e => !e.keys.size).length,
      ms: Date.now() - started,
    },
  };
}

function rating(e) { const r = parseFloat(e.meta.imdbRating); return isNaN(r) ? 0 : r; }
function year(e) { const y = parseInt(String(e.meta.releaseInfo || e.meta.year || '').slice(0, 4), 10); return isNaN(y) ? 0 : y; }

function sortEntries(list, sort) {
  const l = list.slice();
  if (sort === 'rating') l.sort((a, b) => rating(b) - rating(a) || a.order - b.order);
  else if (sort === 'year') l.sort((a, b) => year(b) - year(a) || a.order - b.order);
  else if (sort === 'name') l.sort((a, b) => String(a.meta.name).localeCompare(String(b.meta.name), 'it'));
  else l.sort((a, b) => b.hits - a.hits || a.order - b.order); // "popolari": presenti in più cataloghi prima
  return l;
}

// ---------- cache per configurazione ----------

const cache = new Map(); // cfgKey -> { at, data, pending }

async function getIndex(cfgKey, cfg) {
  let c = cache.get(cfgKey);
  const fresh = c && c.data && Date.now() - c.at < c.ttl;
  if (fresh) return c.data;
  if (!c) { c = {}; cache.set(cfgKey, c); }
  if (!c.pending) {
    c.pending = buildIndex(cfg)
      .then(data => {
        // se nessun titolo è stato raccolto (addon offline) riprova presto
        c.data = data; c.at = Date.now(); c.ttl = data.stats.titles ? TTL : 2 * 60 * 1000;
        return data;
      })
      .finally(() => { c.pending = null; });
  }
  // stale-while-revalidate: se c'è un indice vecchio lo restituisce subito
  if (c.data) { c.pending.catch(() => {}); return c.data; }
  return c.pending;
}

module.exports = { getIndex, baseOf, usableCatalogs, PAGE, GENRES };
