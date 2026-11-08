import { XMLParser } from 'fast-xml-parser';
import { LIBRARY_SOURCES } from './library-sources.js';
import { libraryEligible } from './library-policy.js';

export const SOURCES = [
  { id: 'diario-financiero', name: 'Diario Financiero', url: 'https://www.df.cl/noticias/site/list/port/rss.xml', channel: 'NEWS_CHANNEL_ID', maxAgeDays: 2 },
  { id: 'dw-es', name: 'DW en español', url: 'https://rss.dw.com/rdf/rss-sp-all', channel: 'NEWS_CHANNEL_ID', maxAgeDays: 2 },
  { id: 'biobiochile', name: 'BioBioChile', url: 'https://www.biobiochile.cl/static/feed-rss', channel: 'NEWS_CHANNEL_ID', maxAgeDays: 2,
    sections: ['nacional', 'internacional', 'economia', 'ciencia-y-tecnologia'] },
  { id: 'freecodecamp-es', name: 'freeCodeCamp en español', url: 'https://www.freecodecamp.org/espanol/news/rss/', channel: 'LIBRARY_CHANNEL_ID', maxAgeDays: 30 },
  ...LIBRARY_SOURCES
];

export function sourceAt(timestamp) {
  // Three library slots/hour: every provider is checked once per five hours.
  const hour = Math.floor(timestamp / 3600000);
  if (new Date(timestamp).getUTCMinutes() !== 38) {
    const library=SOURCES.filter(source=>source.channel==='LIBRARY_CHANNEL_ID');
    return library[Math.floor(timestamp/1200000)%library.length];
  }
  const news = SOURCES.filter(source => source.channel === 'NEWS_CHANNEL_ID');
  return news[hour % news.length];
}

export function clean(value) {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
const chileDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year:'numeric', month:'2-digit', day:'2-digit' });
export function chileDay(timestamp) { return chileDateFormatter.format(new Date(timestamp)); }
export function canonical(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
    }
    return u.href;
  } catch { return null; }
}
export function parseFeed(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD not supported');
  const parsed = new XMLParser({ ignoreAttributes: false, processEntities: true, htmlEntities: true, parseTagValue: false }).parse(xml);
  const raw = parsed.rss?.channel?.item ?? parsed['rdf:RDF']?.item ?? parsed.feed?.entry ?? [];
  return (Array.isArray(raw) ? raw : [raw]).slice(0, 50).map(item => {
    const links = Array.isArray(item.link) ? item.link : [item.link];
    const link = links.find(x => typeof x === 'string' || !x?.['@_rel'] || x['@_rel'] === 'alternate');
    return {
      title: clean(item.title?.['#text'] ?? item.title),
      url: canonical(typeof link === 'string' ? link : link?.['@_href']),
      date: Date.parse(item.pubDate ?? item['dc:date'] ?? item.published ?? item.updated ?? '')
    };
  }).filter(item => item.title && item.url);
}
export function eligible(item, source, now = Date.now()) {
  if(source.kind==='library')return libraryEligible(item,now);
  if (source.sections) {
    try {
      const url = new URL(item.url);
      if (!['www.biobiochile.cl', 'biobiochile.cl'].includes(url.hostname) ||
          !source.sections.some(section => url.pathname.startsWith(`/noticias/${section}/`))) return false;
    } catch { return false; }
  }
  return Number.isFinite(item.date) && item.date <= now + 300000 && item.date >= now - source.maxAgeDays * 86400000;
}
export function discordPost(item, source) {
  const category = source.channel === 'NEWS_CHANNEL_ID' ? 'Noticia' : 'Recurso educativo';
  const details=source.kind==='library' ? [
    `Tipo: ${item.type}`, `Tema: ${item.topics.join(', ')}`,
    item.language && `Idioma: ${item.language}`, item.duration && `Duración: ${item.duration}`,
    item.level && `Nivel: ${item.level}`, `Contenido: ${item.cost}`,
    item.certificate
  ].filter(Boolean).join('\n') : '';
  return {
    name: item.title.slice(0, 100),
    message: {
      content: `📡 **RADAR · ${category}**\nFuente: ${source.name}\n${item.url}\n\n${details || (category === 'Noticia' ? 'Selección automática por fuente; revisa el artículo original.' : 'Consulta el recurso original para conocer acceso, idioma y condiciones del certificado.')}`,
      allowed_mentions: { parse: [] }
    }
  };
}
