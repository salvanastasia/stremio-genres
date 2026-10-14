'use strict';

// Scheda completa del titolo (risorsa "meta") in italiano.
// Base: Cinemeta (episodi, cast, link, voto IMDb, trailer) così gli addon di stream continuano a
// funzionare con gli stessi id; sopra: titolo, trama, poster, logo ed episodi italiani da TMDB.
// Se Cinemeta non ha il titolo (es. id tmdb:), la scheda viene costruita interamente da TMDB.

const tmdb = require('./tmdb');
const cast = require('./cast');
const { toKeys, GENRES } = require('./genres');

// Genere accanto al voto: lo scrive nel campo "durata", l'unico mostrato in quella riga.
function withGenreTag(cfg, meta, names) {
  if (!cfg.genreTag) return meta;
  const list = [...new Set((names || []).filter(Boolean))].slice(0, 2);
  if (!list.length) return meta;
  const base = String(meta.runtime || '').split(' · ')[0].trim();
  return { ...meta, runtime: base ? `${base} · ${list.join(', ')}` : list.join(', ') };
}

// Nomi dei pulsanti dei generi in italiano (l'indirizzo resta quello originale).
function italianGenreLinks(meta) {
  if (!Array.isArray(meta.links)) return meta;
  return {
    ...meta,
    links: meta.links.map(l => {
      if (l.category !== 'Genres') return l;
      const k = toKeys([l.name])[0];
      return k ? { ...l, name: GENRES[k].label } : l;
    }),
  };
}

function genreNames(d, base) {
  if (d && Array.isArray(d.genres) && d.genres.length) return d.genres.map(g => g.name);
  return toKeys((base && (base.genres || base.genre)) || []).map(k => GENRES[k].label);
}

const CINEMETA = process.env.CINEMETA_URL || 'https://v3-cinemeta.strem.io';
const GENERIC_EP = /^(episodio|episode|ep\.?)\s*\d+$/i;

async function getJSON(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(t); }
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const it = items[i++]; try { await fn(it); } catch { /* ignora */ } }
  }));
}

function year(d) { return d ? String(d).slice(0, 4) : ''; }
function rating(d) { return d && d.vote_count >= 10 && d.vote_average ? d.vote_average.toFixed(1) : undefined; }

function italianLogo(d) {
  const logos = (d && d.images && d.images.logos) || [];
  const it = logos.find(l => l.iso_639_1 === tmdb.LANG2);
  return it ? tmdb.img(it.file_path, 'original') : null;
}

function epNum(v) { return Number(v.episode != null ? v.episode : v.number); }

// Costruisce la scheda solo con TMDB.
async function fromTmdb(type, id, d) {
  const imdb = d.external_ids && d.external_ids.imdb_id;
  const crew = (d.credits && d.credits.crew) || [];
  const trailer = ((d.videos && d.videos.results) || []).find(v => v.site === 'YouTube' && v.type === 'Trailer');
  const meta = {
    id, type,
    name: d.title || d.name,
    description: d.overview || undefined,
    poster: tmdb.img(d.poster_path, 'w500'),
    background: tmdb.img(d.backdrop_path, 'original'),
    logo: italianLogo(d) || undefined,
    genres: (d.genres || []).map(g => g.name),
    cast: ((d.credits && d.credits.cast) || []).slice(0, 8).map(c => c.name),
    director: crew.filter(c => c.job === 'Director').map(c => c.name),
    imdbRating: rating(d),
    runtime: d.runtime ? `${d.runtime} min` : (d.episode_run_time && d.episode_run_time[0] ? `${d.episode_run_time[0]} min` : undefined),
    website: d.homepage || undefined,
    trailers: trailer ? [{ source: trailer.key, type: 'Trailer' }] : undefined,
  };
  if (type === 'movie') {
    meta.releaseInfo = year(d.release_date);
    meta.released = d.release_date ? new Date(d.release_date).toISOString() : undefined;
    if (imdb) meta.behaviorHints = { defaultVideoId: imdb };
  } else {
    const first = year(d.first_air_date), last = year(d.last_air_date);
    meta.releaseInfo = d.status === 'Ended' || d.status === 'Canceled' ? (first === last ? first : `${first}-${last}`) : `${first}-`;
    const vidBase = imdb || id;
    const videos = [];
    const seasons = (d.seasons || []).map(s => s.season_number).filter(n => n != null);
    await pool(seasons, 6, async n => {
      const s = await tmdb.season(d.id, n);
      for (const e of (s && s.episodes) || []) {
        videos.push({
          id: `${vidBase}:${n}:${e.episode_number}`,
          title: e.name, name: e.name,
          season: n, episode: e.episode_number, number: e.episode_number,
          overview: e.overview || undefined, description: e.overview || undefined,
          released: e.air_date ? new Date(e.air_date).toISOString() : undefined,
          thumbnail: tmdb.img(e.still_path, 'w300'),
        });
      }
    });
    videos.sort((a, b) => a.season - b.season || a.episode - b.episode);
    meta.videos = videos;
    meta.behaviorHints = { defaultVideoId: null, hasScheduledVideos: d.status === 'Returning Series' };
  }
  return meta;
}

// Sovrappone i dati italiani alla scheda di Cinemeta.
async function overlay(cfg, base, d) {
  const meta = { ...base };
  const itName = d.title || d.name;
  if (cfg.itDescription && d.overview) meta.description = d.overview;
  if (cfg.itPoster && d.poster_path) meta.poster = tmdb.img(d.poster_path, 'w500');
  if (cfg.itTitle && itName && itName !== base.name) {
    meta.name = itName;
    // il logo di Cinemeta riporta il titolo originale: meglio quello italiano o nessuno
    meta.logo = italianLogo(d) || undefined;
  } else {
    const l = italianLogo(d);
    if (l) meta.logo = l;
  }
  if (!meta.imdbRating) meta.imdbRating = rating(d);

  if (base.type === 'series' && Array.isArray(base.videos) && base.videos.length) {
    const seasons = [...new Set(base.videos.map(v => Number(v.season)).filter(n => !isNaN(n)))];
    const eps = new Map();
    await pool(seasons, 6, async n => {
      const s = await tmdb.season(d.id, n);
      for (const e of (s && s.episodes) || []) eps.set(`${n}:${e.episode_number}`, e);
    });
    meta.videos = base.videos.map(v => {
      const e = eps.get(`${Number(v.season)}:${epNum(v)}`);
      if (!e) return v;
      const out = { ...v };
      if (cfg.itTitle && e.name && !GENERIC_EP.test(e.name.trim())) { out.title = e.name; out.name = e.name; }
      if (cfg.itDescription && e.overview) { out.overview = e.overview; out.description = e.overview; }
      return out;
    });
  }
  return meta;
}

// "Vedi cast" + nomi degli attori che portano alla loro filmografia
function withCast(cfg, meta, type, d, manifestUrl) {
  if (!cfg.castPage || !d || !manifestUrl) return meta;
  const links = cast.castLinks(manifestUrl, type, d);
  if (!links.length) return meta;
  return { ...meta, links: [...(meta.links || []).filter(l => l.category !== 'Cast'), ...links] };
}

async function getMeta(cfg, type, id, manifestUrl) {
  if (id.startsWith(cast.PERSON_PREFIX)) {
    if (!cfg.castPage || !tmdb.enabled()) return null;
    const meta = await cast.personMeta(id, manifestUrl);
    return meta ? { meta, complete: true } : null;
  }
  if (type !== 'movie' && type !== 'series') return null;
  if (!/^(tt\d+|tmdb:\d+)/.test(id)) return null;

  let tmdbErr = null;
  const r = tmdb.enabled() ? await tmdb.resolve(type, id).catch(e => { tmdbErr = e; return undefined; }) : null;
  const d = r ? await tmdb.details(type, r.tmdbId, true).catch(e => { tmdbErr = e; return null; }) : null;

  // id IMDb per la base Cinemeta (anche per gli id tmdb: se TMDB lo conosce)
  const imdb = /^tt\d+/.test(id) ? id.match(/^tt\d+/)[0] : d && d.external_ids && d.external_ids.imdb_id;
  const cm = imdb ? await getJSON(`${CINEMETA}/meta/${type}/${imdb}.json`) : null;
  const base = cm && cm.meta && cm.meta.id ? cm.meta : null;

  // complete=false: TMDB non ha risposto, la scheda va tenuta in cache poco
  const complete = !!d || !tmdb.enabled() || r === null && !tmdbErr;
  if (base && d) {
    const meta = await overlay(cfg, base, d);
    meta.id = id;
    if (type === 'movie' && id !== imdb) meta.behaviorHints = { ...(meta.behaviorHints || {}), defaultVideoId: imdb };
    const out = withGenreTag(cfg, italianGenreLinks(withCast(cfg, meta, type, d, manifestUrl)), genreNames(d, base));
    return { meta: out, complete };
  }
  if (base) return { meta: withGenreTag(cfg, italianGenreLinks({ ...base, id }), genreNames(null, base)), complete };
  if (d) return { meta: withGenreTag(cfg, withCast(cfg, await fromTmdb(type, id, d), type, d, manifestUrl), genreNames(d)), complete };
  return null;
}

module.exports = { getMeta };
