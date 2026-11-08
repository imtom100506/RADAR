import { SOURCES, sourceAt, parseFeed, eligible, discordPost, chileDay } from './feeds.js';
import { refreshLibrary } from './library.js';

async function readFeed(source) {
  const response = await fetch(source.url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'RADAR/0.1 RSS reader', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
  if (!response.ok) throw new Error(`Feed HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 1024 * 1024) { await reader.cancel(); throw new Error('Feed larger than 1 MB'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return parseFeed(new TextDecoder().decode(bytes));
}

export async function run(env, timestamp = Date.now()) {
  if (env.ENABLED !== 'true') return { status: 'paused' };
  if (env.DIAGNOSTIC_UNTIL && timestamp > Number(env.DIAGNOSTIC_UNTIL)) return { status: 'diagnostic_expired' };
  if (!env.DB || !env.DISCORD_BOT_TOKEN) throw new Error('Missing DB or Discord token');
  const library = SOURCES.filter(s=>s.kind==='library');
  const source = env.DIAGNOSTIC_UNTIL && env.DIAGNOSTIC_LIBRARY_ONLY==='true'
    ? library[Math.floor(timestamp/60000)%library.length] : sourceAt(timestamp);
  const channel = env[source.channel];
  if (!/^\d{17,22}$/.test(channel ?? '')) throw new Error(`Missing ${source.channel}`);
  const lease = await env.DB.prepare('INSERT INTO locks(id,expires) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET expires=excluded.expires WHERE locks.expires < ?').bind('run', timestamp + 300000, timestamp).run();
  if (!lease.meta.changes) return { status: 'busy' };
  try {
    const initialized = await env.DB.prepare('SELECT initialized FROM sources WHERE id=?').bind(source.id).first();
    if (env.DIAGNOSTIC_UNTIL && initialized?.initialized) return { status:'diagnostic_complete', source:source.id };
    const items = source.kind==='library' ? await refreshLibrary(env.DB,source,timestamp) : await readFeed(source);
    if (!items.length && source.kind!=='library') throw new Error('Empty feed; initialization postponed');
    if (!initialized?.initialized && source.kind!=='library') {
      await env.DB.batch([
        ...items.map(item => env.DB.prepare("INSERT OR IGNORE INTO entries(url,source,status) VALUES(?,?,'baseline')").bind(item.url, source.id)),
        env.DB.prepare('INSERT OR REPLACE INTO sources(id,initialized) VALUES(?,1)').bind(source.id)
      ]);
      return { status: 'initialized', source: source.id, count: items.length };
    }
    if (env.INITIALIZE_ONLY === 'true' || env.DIAGNOSTIC_UNTIL) return { status: 'checked_without_publishing', source: source.id, count: items.length };
    const day = chileDay(timestamp);
    const isNews = source.channel === 'NEWS_CHANNEL_ID';
    const librarySources = SOURCES.filter(s => s.channel === 'LIBRARY_CHANNEL_ID').map(s => s.id);
    // Include historical news sources (such as BBC) in today's news quota.
    const used = await env.DB.prepare(`SELECT count(*) AS n FROM entries WHERE status IN ('sent','reserved','uncertain') AND local_day=? AND source ${isNews ? 'NOT IN' : 'IN'} (${librarySources.map(() => '?').join(',')})`).bind(day, ...librarySources).first();
    const limit = Math.max(1, Math.min(20, Number(isNews ? env.NEWS_DAILY_LIMIT : env.LIBRARY_DAILY_LIMIT) || (isNews ? 12 : 8)));
    if (used.n >= limit) return { status: 'daily_limit' };
    for (const item of items.filter(item => eligible(item, source, timestamp)).sort((a,b) => b.date - a.date)) {
      const claim = await env.DB.prepare("INSERT OR IGNORE INTO entries(url,source,status,local_day) VALUES(?,?,'reserved',?)").bind(item.url, source.id, day).run();
      if (!claim.meta.changes) continue;
      let response;
      try {
        response = await fetch(`https://discord.com/api/v10/channels/${channel}/threads`, {
          method: 'POST', signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...discordPost(item, source), ...(env[source.channel + '_TAGS'] ? { applied_tags: env[source.channel + '_TAGS'].split(',').map(s => s.trim()).filter(Boolean) } : {}) })
        });
      } catch {
        await env.DB.prepare("UPDATE entries SET status='uncertain' WHERE url=?").bind(item.url).run();
        throw new Error('Discord timeout: uncertain delivery; manual review required');
      }
      if (!response.ok) {
        if (response.status >= 500) {
          await env.DB.prepare("UPDATE entries SET status='uncertain' WHERE url=?").bind(item.url).run();
        } else {
          await env.DB.prepare("DELETE FROM entries WHERE url=? AND status='reserved'").bind(item.url).run();
        }
        throw new Error(`Discord HTTP ${response.status}; publication stopped`);
      }
      const thread = await response.json();
      await env.DB.prepare("UPDATE entries SET status='sent',thread_id=? WHERE url=?").bind(thread.id, item.url).run();
      return { status: 'published', source: source.id, thread: thread.id };
    }
    return { status: 'no_new_items', source: source.id };
  } finally {
    await env.DB.prepare('DELETE FROM locks WHERE id=? AND expires=?').bind('run', timestamp + 300000).run();
  }
}

export default {
  fetch(request) {
    return Response.json({ nombre: 'RADAR', servicio: 'Noticias y recursos educativos' });
  },
  async scheduled(event, env) {
    // Los cambios de cron tardan en propagarse: ignorar el horario de diagnóstico anterior.
    if (!env.DIAGNOSTIC_UNTIL && event.cron !== '7,27,38,47 * * * *') return;
    try { console.log(JSON.stringify(await run(env, event.scheduledTime))); }
    catch (error) { console.error(error.message); throw error; }
  }
};
