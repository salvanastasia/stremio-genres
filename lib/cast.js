'use strict';

// "Vedi cast": griglia di attori con foto tonde, scheda dell'attore e filmografia.
// Tutto passa per cataloghi e schede di questo addon, gli unici elementi che Stremio sa mostrare.

const tmdb = require('./tmdb');

const PERSON_PREFIX = 'gen.person:';
const CAST_CATALOG = 'gen.cast';
const FILMO = { movie: 'gen.person.movie', series: 'gen.person.series' };
const SKIP_ROLES = /^(self|himself|herself|themselves|s[ée] stess[oa]|narrator|host)\b/i;
const SKIP_TV_GENRES = new Set([10767, 10763]); // talk show, notiziari

// Foto ritagliata a cerchio (servizio gratuito wsrv.nl, PNG con sfondo trasparente).
function avatar(path) {
  if (!path) return undefined;
  const src = encodeURIComponent(`image.tmdb.org/t/p/w300${path}`);
  return `https://wsrv.nl/?url=${src}&w=300&h=300&fit=cover&a=attention&mask=circle&output=png&maxage=30d`;
}

function discover(manifestUrl, type, catalog, extra) {
  return `stremio:///discover/${encodeURIComponent(manifestUrl)}/${type}/${catalog}?${new URLSearchParams(extra)}`;
}

function topCast(d, n) {
  return ((d && d.credits && d.credits.cast) || []).slice().sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).slice(0, n);
}

// Link della scheda: "👥 Vedi cast" + nomi che portano dritti alla filmografia.
function castLinks(manifestUrl, type, d) {
  const kind = type === 'series' ? 'tv' : 'movie';
  const cast = topCast(d, 10);
  if (!cast.length) return [];
  return [
    { name: '👥 Vedi cast', category: 'Cast', url: discover(manifestUrl, 'movie', CAST_CATALOG, { ref: `${kind}-${d.id}` }) },
    ...cast.map(c => ({ name: c.name, category: 'Cast', url: discover(manifestUrl, 'movie', FILMO.movie, { person: c.id }) })),
  ];
}

// Catalogo "Cast": un attore per voce, "Nome (Personaggio)" con foto tonda.
async function castCatalog(ref) {
  const m = /^(movie|tv)-(\d+)$/.exec(ref || '');
  if (!m) return [];
  const d = await tmdb.details(m[1] === 'tv' ? 'series' : 'movie', m[2], true);
  return topCast(d, 30).map(c => ({
    id: `${PERSON_PREFIX}${c.id}`,
    type: 'movie',
    name: c.character ? `${c.name} (${c.character})` : c.name,
    poster: avatar(c.profile_path),
    posterShape: 'square',
  }));
}

// Scheda dell'attore: foto, biografia, link ai suoi film e alle sue serie.
async function personMeta(id, manifestUrl) {
  const pid = id.slice(PERSON_PREFIX.length);
  if (!/^\d+$/.test(pid)) return null;
  const p = await tmdb.person(pid);
  if (!p) return null;
  const born = p.birthday ? p.birthday.slice(0, 4) : '';
  const died = p.deathday ? p.deathday.slice(0, 4) : '';
  return {
    id, type: 'movie',
    name: p.name,
    poster: avatar(p.profile_path),
    posterShape: 'square',
    background: tmdb.img(p.profile_path, 'h632'),
    description: p.biography || undefined,
    releaseInfo: born ? (died ? `${born}-${died}` : born) : undefined,
    links: [
      { name: `🎬 Film con ${p.name}`, category: 'Filmografia', url: discover(manifestUrl, 'movie', FILMO.movie, { person: pid }) },
      { name: `📺 Serie con ${p.name}`, category: 'Filmografia', url: discover(manifestUrl, 'series', FILMO.series, { person: pid }) },
    ],
    behaviorHints: { defaultVideoId: null },
  };
}

// Filmografia: poster dei titoli in cui ha recitato, i più popolari prima.
async function filmography(personId, type) {
  if (!/^\d+$/.test(String(personId || ''))) return [];
  const kind = type === 'series' ? 'tv' : 'movie';
  const c = await tmdb.personCredits(personId, kind);
  const seen = new Set();
  return ((c && c.cast) || [])
    .filter(x => x.poster_path && !SKIP_ROLES.test(x.character || ''))
    .filter(x => kind !== 'tv' || !(x.genre_ids || []).some(g => SKIP_TV_GENRES.has(g)))
    .filter(x => !seen.has(x.id) && seen.add(x.id))
    .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))
    .slice(0, 100)
    .map(x => ({
      id: `tmdb:${x.id}`,
      type,
      name: x.title || x.name,
      poster: tmdb.img(x.poster_path, 'w500'),
      description: x.overview || undefined,
      releaseInfo: (x.release_date || x.first_air_date || '').slice(0, 4) || undefined,
    }));
}

// "Vedi cast" come voce nella lista degli stream: è l'unico elenco sempre selezionabile col
// telecomando sulle app TV (Fire Stick / Android TV), dove i link della scheda non lo sono.
async function castStream(manifestUrl, type, id) {
  const baseId = id.split(':').slice(0, id.startsWith('tmdb:') ? 2 : 1).join(':');
  const r = await tmdb.resolve(type, baseId);
  if (!r) return [];
  const kind = type === 'series' ? 'tv' : 'movie';
  const url = discover(manifestUrl, 'movie', CAST_CATALOG, { ref: `${kind}-${r.tmdbId}` });
  return [{
    name: '👥 Cast',
    title: 'Vedi cast con foto',
    externalUrl: url,
    androidTvUrl: url,
    behaviorHints: { notWebReady: true, bingeGroup: 'generi-cast' },
  }];
}

function manifestCatalogs() {
  return [
    { type: 'movie', id: CAST_CATALOG, name: 'Cast', extra: [{ name: 'ref', isRequired: true }] },
    { type: 'movie', id: FILMO.movie, name: 'Filmografia', extra: [{ name: 'person', isRequired: true }] },
    { type: 'series', id: FILMO.series, name: 'Filmografia', extra: [{ name: 'person', isRequired: true }] },
  ];
}

module.exports = { castStream, castLinks, castCatalog, personMeta, filmography, manifestCatalogs, avatar, PERSON_PREFIX, CAST_CATALOG, FILMO };
