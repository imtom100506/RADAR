import { XMLParser } from 'fast-xml-parser';

export const SOURCES = [
  { id: 'bbc-mundo', name: 'BBC Mundo', url: 'https://feeds.bbci.co.uk/mundo/rss.xml', channel: 'NEWS_CHANNEL_ID', maxAgeDays: 2 },
  { id: 'freecodecamp-es', name: 'freeCodeCamp en español', url: 'https://www.freecodecamp.org/espanol/news/rss/', channel: 'LIBRARY_CHANNEL_ID', maxAgeDays: 30 }
];

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
  const parsed = new XMLParser({ ignoreAttributes: false, processEntities: false, parseTagValue: false }).parse(xml);
  const raw = parsed.rss?.channel?.item ?? parsed.feed?.entry ?? [];
  return (Array.isArray(raw) ? raw : [raw]).slice(0, 50).map(item => {
    const links = Array.isArray(item.link) ? item.link : [item.link];
    const link = links.find(x => typeof x === 'string' || !x?.['@_rel'] || x['@_rel'] === 'alternate');
    return {
      title: clean(item.title?.['#text'] ?? item.title),
      url: canonical(typeof link === 'string' ? link : link?.['@_href']),
      date: Date.parse(item.pubDate ?? item.published ?? item.updated ?? '')
    };
  }).filter(item => item.title && item.url);
}
export function eligible(item, source, now = Date.now()) {
  return Number.isFinite(item.date) && item.date <= now + 300000 && item.date >= now - source.maxAgeDays * 86400000;
}
export function discordPost(item, source) {
  const category = source.channel === 'NEWS_CHANNEL_ID' ? 'Noticia' : 'Recurso educativo';
  return {
    name: item.title.slice(0, 100),
    message: {
      content: `📡 **RADAR · ${category}**\nFuente: ${source.name}\n${item.url}\n\n${category === 'Noticia' ? 'Selección automática por fuente; revisa el artículo original.' : 'Consulta el recurso original para conocer acceso, idioma y condiciones del certificado.'}`,
      allowed_mentions: { parse: [] }
    }
  };
}
