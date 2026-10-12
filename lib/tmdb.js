'use strict';

// Traduzione in italiano di trama e titolo tramite TMDB.
// Richiede la variabile d'ambiente TMDB_API_KEY (chiave v3 oppure token v4 "Read Access Token").

const API = process.env.TMDB_API || 'https://api.themoviedb.org/3';
const LANG = process.env.TMDB_LANG || 'it-IT';
const cache = new Map(); // "movie:tt123" -> { overview, title } | null  (valida per tutta la vita del server)

function key() { return (process.env.TMDB_API_KEY || '').trim(); }
function enabled() { return !!key(); }

async function tmdb(path, params = {}) {
  const k = key();
  const q = new URLSearchParams({ language: LANG, ...params });
  const headers = { accept: 'application/json' };
  if (k.length > 40) headers.authorization = `Bearer ${k}`; else q.set('api_key', k);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(`${API}${path}?${q}`, { headers, signal: ctrl.signal });
    if (r.status === 401) throw Object.assign(new Error('Chiave TMDB non valida'), { fatal: true });
    if (!r.ok) return null;
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// Restituisce { overview, title } in italiano per un id Stremio (tt..., tmdb:...), oppure null.
async function lookup(type, id) {
  const ck = `${type}:${id}`;
  if (cache.has(ck)) return cache.get(ck);
  const kind = type === 'series' ? 'tv' : 'movie';
  let item = null;
  const imdb = /^(tt\d+)/.exec(id);
  const tm = /^tmdb:(\d+)/.exec(id);
  if (imdb) {
    const d = await tmdb(`/find/${imdb[1]}`, { external_source: 'imdb_id' });
    item = d && (d[`${kind}_results`] || [])[0];
  } else if (tm) {
    item = await tmdb(`/${kind}/${tm[1]}`);
  }
  const res = item ? { overview: item.overview || '', title: item.title || item.name || '' } : null;
  cache.set(ck, res);
  return res;
}

module.exports = { enabled, lookup };
