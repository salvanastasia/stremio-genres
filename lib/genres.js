'use strict';

// Generi canonici: chiave interna -> etichetta italiana + alias riconosciuti
// (inglese di Cinemeta/TMDB/IMDb, italiano, e qualche variante comune).
const GENRES = {
  azione:       { label: 'Azione',        aliases: ['action', 'azione', 'accion', 'acción'] },
  avventura:    { label: 'Avventura',     aliases: ['adventure', 'avventura', 'aventura', 'aventure'] },
  animazione:   { label: 'Animazione',    aliases: ['animation', 'animazione', 'animated', 'cartoni', 'cartoni animati', 'anime'] },
  biografico:   { label: 'Biografico',    aliases: ['biography', 'biographical', 'biografico', 'biopic'] },
  commedia:     { label: 'Commedia',      aliases: ['comedy', 'commedia', 'comedia', 'comedie', 'comédie', 'sitcom'] },
  crime:        { label: 'Crime',         aliases: ['crime', 'poliziesco', 'giallo', 'crimine', 'policier'] },
  documentario: { label: 'Documentario',  aliases: ['documentary', 'documentario', 'documental', 'documentaire', 'docuseries', 'docu'] },
  drammatico:   { label: 'Drammatico',    aliases: ['drama', 'dramma', 'drammatico', 'drame'] },
  famiglia:     { label: 'Famiglia',      aliases: ['family', 'famiglia', 'familiare', 'familia'] },
  fantasy:      { label: 'Fantasy',       aliases: ['fantasy', 'fantastico', 'fantasia', 'fantastique'] },
  fantascienza: { label: 'Fantascienza',  aliases: ['sci-fi', 'sci fi', 'scifi', 'science fiction', 'science-fiction', 'fantascienza', 'ciencia ficcion', 'ciencia ficción'] },
  horror:       { label: 'Horror',        aliases: ['horror', 'orrore', 'terror', 'terrore', 'epouvante'] },
  thriller:     { label: 'Thriller',      aliases: ['thriller', 'suspense'] },
  mistero:      { label: 'Mistero',       aliases: ['mystery', 'mistero', 'misterio', 'mystere', 'mystère'] },
  romantico:    { label: 'Romantico',     aliases: ['romance', 'romantico', 'sentimentale', 'romantic', 'romantique'] },
  guerra:       { label: 'Guerra',        aliases: ['war', 'guerra', 'guerre', 'war & politics', 'war and politics', 'bellico'] },
  storico:      { label: 'Storico',       aliases: ['history', 'historical', 'storico', 'storia', 'historia', 'histoire'] },
  western:      { label: 'Western',       aliases: ['western', 'western all\'italiana'] },
  musical:      { label: 'Musica e Musical', aliases: ['music', 'musical', 'musica', 'musicale', 'musique'] },
  sport:        { label: 'Sport',         aliases: ['sport', 'sports', 'sportivo'] },
  reality:      { label: 'Reality',       aliases: ['reality', 'reality-tv', 'reality tv', 'game show', 'game-show'] },
  bambini:      { label: 'Bambini',       aliases: ['kids', 'bambini', 'children', 'infantil', 'per bambini'] },
  talk:         { label: 'Talk show',     aliases: ['talk', 'talk-show', 'talk show'] },
  news:         { label: 'Notizie',       aliases: ['news', 'notizie', 'attualita', 'attualità'] },
  soap:         { label: 'Soap opera',    aliases: ['soap', 'soap opera', 'telenovela'] },
};

// Generi composti (stile TMDB) che valgono per più categorie.
const COMPOUND = {
  'sci-fi & fantasy': ['fantascienza', 'fantasy'],
  'action & adventure': ['azione', 'avventura'],
  'action/adventure': ['azione', 'avventura'],
  'fantascienza e fantasy': ['fantascienza', 'fantasy'],
  'azione e avventura': ['azione', 'avventura'],
  'crime thriller': ['crime', 'thriller'],
};

const ORDER = {
  movie: ['azione', 'avventura', 'animazione', 'biografico', 'commedia', 'crime', 'documentario', 'drammatico',
    'famiglia', 'fantasy', 'fantascienza', 'horror', 'mistero', 'romantico', 'thriller', 'guerra', 'storico',
    'western', 'musical', 'sport'],
  series: ['azione', 'avventura', 'animazione', 'commedia', 'crime', 'documentario', 'drammatico', 'famiglia',
    'fantasy', 'fantascienza', 'horror', 'mistero', 'romantico', 'thriller', 'guerra', 'storico', 'western',
    'reality', 'bambini', 'soap', 'talk', 'news'],
};

const DEFAULTS = {
  movie: ['azione', 'avventura', 'animazione', 'commedia', 'crime', 'documentario', 'drammatico', 'famiglia',
    'fantasy', 'fantascienza', 'horror', 'mistero', 'romantico', 'thriller', 'guerra', 'storico'],
  series: ['azione', 'animazione', 'commedia', 'crime', 'documentario', 'drammatico', 'fantasy', 'fantascienza',
    'horror', 'mistero', 'thriller', 'reality'],
};

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const ALIAS = new Map();
for (const [key, g] of Object.entries(GENRES)) {
  for (const a of [g.label, ...g.aliases]) {
    const n = norm(a);
    if (!ALIAS.has(n)) ALIAS.set(n, []);
    if (!ALIAS.get(n).includes(key)) ALIAS.get(n).push(key);
  }
}
for (const [a, keys] of Object.entries(COMPOUND)) ALIAS.set(norm(a), keys);

const LABEL_TO_KEY = new Map(Object.entries(GENRES).map(([k, g]) => [norm(g.label), k]));

// Converte una lista di generi "grezzi" (qualsiasi lingua/formato) in chiavi canoniche.
function toKeys(list) {
  const out = new Set();
  for (const raw of list || []) {
    if (typeof raw !== 'string') continue;
    const n = norm(raw);
    const direct = ALIAS.get(n);
    if (direct) { direct.forEach(k => out.add(k)); continue; }
    for (const part of n.split(/\s*(?:&|\/|,|;|\|| e | and | y | et )\s*/)) {
      const ks = ALIAS.get(part);
      if (ks) ks.forEach(k => out.add(k));
    }
  }
  return [...out];
}

module.exports = { GENRES, ORDER, DEFAULTS, toKeys, norm, LABEL_TO_KEY };
