'use strict';

// Dati in italiano da TMDB (titoli, trame, poster, loghi, episodi, voto).
// Richiede la variabile d'ambiente TMDB_API_KEY (chiave v3 oppure token v4 "Read Access Token").

const API = process.env.TMDB_API || 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const LANG = process.env.TMDB_LANG || 'it-IT';
const LANG2 = LANG.slice(0, 2);
const DAY = 24 * 60 * 60 * 1000;

function key() { return (process.env.TMDB_API_KEY || '').trim(); }
function enabled() { return !!key(); }

function img(path, size) { return path ? `${IMG}/${size}${path}` : undefined; }

// Cache semplice con scadenza (le risposte TMDB cambiano raramente).
const cache = new Map();
const MAX_CACHE = 20000;
async function cached(k, ttl, fn) {
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < ttl) return hit.v;
  const v = await fn();
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(k, { v, at: Date.now() });
  return v;
}

// La chiave può essere la "Chiave API" v3 (32 caratteri) o il "Token di accesso in lettura" v4 (JWT lungo).
function cleanKey() { return key().replace(/^bearer\s+/i, '').replace(/^["']|["']$/g, '').trim(); }
function keyType() { const k = cleanKey(); return !k ? 'assente' : k.length > 40 ? 'token v4' : 'chiave v3'; }

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Restituisce il JSON, null se la risorsa non esiste (404); lancia un errore negli altri casi
// (così i fallimenti temporanei non finiscono in cache).
async function tmdb(path, params = {}, attempt = 0) {
  const k = cleanKey();
  const q = new URLSearchParams({ language: LANG, ...params });
  const headers = { accept: 'application/json' };
  if (k.length > 40) headers.authorization = `Bearer ${k}`; else q.set('api_key', k);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  let r;
  try {
    r = await fetch(`${API}${path}?${q}`, { headers, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
  if (r.status === 401) {
    const d = await r.json().catch(() => ({}));
    throw Object.assign(new Error(`Chiave TMDB rifiutata (${keyType()}): ${d.status_message || 'HTTP 401'}`), { fatal: true });
  }
  if (r.status === 429 && attempt < 3) { await sleep(1000 * (attempt + 1)); return tmdb(path, params, attempt + 1); }
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`TMDB HTTP ${r.status}`);
  return r.json();
}

// Diagnostica per /status
async function check() {
  if (!enabled()) return { key: 'assente' };
  try { await tmdb('/configuration'); return { key: keyType(), ok: true }; }
  catch (e) { return { key: keyType(), ok: false, error: e.message }; }
}

// Da id Stremio (tt..., tmdb:...) all'id TMDB. Restituisce { tmdbId, item } o null.
async function resolve(type, id) {
  const kind = type === 'series' ? 'tv' : 'movie';
  const imdb = /^(tt\d+)/.exec(id);
  const tm = /^tmdb:(\d+)/.exec(id);
  if (tm) return { tmdbId: tm[1], item: null };
  if (!imdb) return null;
  return cached(`find:${kind}:${imdb[1]}`, 7 * DAY, async () => {
    const d = await tmdb(`/find/${imdb[1]}`, { external_source: 'imdb_id' });
    const item = d && (d[`${kind}_results`] || [])[0];
    return item ? { tmdbId: String(item.id), item } : null;
  });
}

// Dati brevi per le righe: { overview, title, poster } in italiano, oppure null.
async function lookup(type, id) {
  const r = await resolve(type, id);
  if (!r) return null;
  let item = r.item;
  if (!item) item = await details(type, r.tmdbId, false);
  if (!item) return null;
  return {
    overview: item.overview || '',
    title: item.title || item.name || '',
    poster: img(item.poster_path, 'w500'),
  };
}

// Scheda completa (con crediti, id esterni, loghi). full=false: solo i dati base.
async function details(type, tmdbId, full = true) {
  const kind = type === 'series' ? 'tv' : 'movie';
  return cached(`det:${kind}:${tmdbId}:${full}`, DAY, () => tmdb(`/${kind}/${tmdbId}`, full ? {
    append_to_response: 'external_ids,credits,images,videos',
    include_image_language: `${LANG2},null,en`,
  } : {}));
}

async function season(tvId, n) {
  return cached(`season:${tvId}:${n}`, DAY, () => tmdb(`/tv/${tvId}/season/${n}`));
}

module.exports = { enabled, lookup, resolve, details, season, img, check, LANG2 };
