import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { run } from '../src/worker.js';
import { chileDay } from '../src/feeds.js';

function fixture(t, minute = 38) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001.sql', import.meta.url), 'utf8'));
  const wrap = (sql, values = []) => ({
    bind(...args) { return wrap(sql, args); },
    async run() { return { meta: { changes: Number(db.prepare(sql).run(...values).changes) } }; },
    async first() { return db.prepare(sql).get(...values); }
  });
  const env = { ENABLED:'true', NEWS_DAILY_LIMIT:'12', LIBRARY_DAILY_LIMIT:'6', DISCORD_BOT_TOKEN:'test-token', NEWS_CHANNEL_ID:'123456789012345678', LIBRARY_CHANNEL_ID:'234567890123456789', DB: { prepare: wrap, async batch(statements) { return Promise.all(statements.map(s => s.run())); } } };
  // Select a Diario Financiero news slot.
  const timestamp = Math.floor(Date.now() / 10800000) * 10800000 + minute * 60000;
  let calls = 0;
  let failure = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).includes('discord.com')) { calls++; if (failure) throw new Error('timeout'); return Response.json({id:'999999999999999999'}); }
    return new Response(`<rss><channel><item><title>New story</title><link>https://example.com/new</link><pubDate>${new Date(timestamp - 60000).toUTCString()}</pubDate></item></channel></rss>`);
  });
  t.after(() => db.close());
  return { db, env, timestamp, calls: () => calls, fail: () => {failure = true;} };
}
test('First run seeds existing stories without posting', async t => {
  const f = fixture(t);
  assert.equal((await run(f.env, f.timestamp)).status, 'initialized');
  assert.equal(f.calls(), 0);
  assert.equal((await run(f.env, f.timestamp)).status, 'no_new_items');
});
test('New stories publish once, persisting the thread id', async t => {
  const f = fixture(t);
  f.db.exec("INSERT INTO sources VALUES('diario-financiero',1)");
  assert.equal((await run(f.env, f.timestamp)).status, 'published');
  assert.equal((await run(f.env, f.timestamp)).status, 'no_new_items');
  assert.equal(f.calls(), 1);
  assert.equal(f.db.prepare('SELECT thread_id FROM entries').get().thread_id, '999999999999999999');
});
test('Uncertain network delivery is not blindly retried', async t => {
  const f = fixture(t); f.fail();
  f.db.exec("INSERT INTO sources VALUES('diario-financiero',1)");
  await assert.rejects(run(f.env, f.timestamp), /uncertain delivery/);
  assert.equal(f.db.prepare('SELECT status FROM entries').get().status, 'uncertain');
  assert.equal((await run(f.env, f.timestamp)).status, 'no_new_items');
  assert.equal(f.calls(), 1);
});
test('Daily cap stops publication', async t => {
  const f = fixture(t); f.env.NEWS_DAILY_LIMIT = '1';
  f.db.exec("INSERT INTO sources VALUES('diario-financiero',1)");
  f.db.prepare("INSERT INTO entries(url,source,status,local_day) VALUES('https://example.com/old','diario-financiero','sent',?)").run(chileDay(f.timestamp));
  assert.equal((await run(f.env, f.timestamp)).status, 'daily_limit');
  assert.equal(f.calls(), 0);
});

function seedQuota(f, source, count, day = chileDay(f.timestamp)) {
  const insert = f.db.prepare('INSERT INTO entries(url,source,status,local_day) VALUES(?,?,?,?)');
  for (let i=0; i<count; i++) insert.run(`https://example.com/${source}/${day}/${i}`, source, ['sent','reserved','uncertain'][i % 3], day);
}

test('News allows the twelfth item despite a full library quota, then stops', async t => {
  const f = fixture(t);
  f.db.exec("INSERT INTO sources VALUES('diario-financiero',1)");
  seedQuota(f, 'diario-financiero', 4);
  seedQuota(f, 'dw-es', 4);
  seedQuota(f, 'biobiochile', 3);
  seedQuota(f, 'freecodecamp-es', 6);
  assert.equal((await run(f.env, f.timestamp)).status, 'published');
  assert.equal((await run(f.env, f.timestamp)).status, 'daily_limit');
  assert.equal(f.calls(), 1);
});

test('Library allows its sixth item despite a full news quota, then stops', async t => {
  const f = fixture(t, 7);
  f.db.exec("INSERT INTO sources VALUES('freecodecamp-es',1)");
  seedQuota(f, 'diario-financiero', 12);
  seedQuota(f, 'freecodecamp-es', 5);
  assert.equal((await run(f.env, f.timestamp)).status, 'published');
  assert.equal((await run(f.env, f.timestamp)).status, 'daily_limit');
  assert.equal(f.calls(), 1);
});

test('Historical BBC deliveries count toward news, never toward library', async t => {
  const f = fixture(t, 7);
  f.db.exec("INSERT INTO sources VALUES('diario-financiero',1),('freecodecamp-es',1)");
  seedQuota(f, 'bbc-mundo', 12);
  assert.equal((await run(f.env, f.timestamp + 31*60000)).status, 'daily_limit');
  assert.equal((await run(f.env, f.timestamp)).status, 'published');
  assert.equal(f.calls(), 1);
});

test('Previous days and baseline entries do not consume the news quota', async t => {
  const f = fixture(t);
  f.db.exec("INSERT INTO sources VALUES('diario-financiero',1)");
  seedQuota(f, 'diario-financiero', 12, chileDay(f.timestamp - 86400000));
  seedQuota(f, 'dw-es', 12);
  f.db.exec("UPDATE entries SET status='baseline' WHERE source='dw-es'");
  assert.equal((await run(f.env, f.timestamp)).status, 'published');
});

test('News older than 48 hours is not used to fill the daily quota', async t => {
  const f = fixture(t);
  f.db.exec("INSERT INTO sources VALUES('diario-financiero',1)");
  assert.equal((await run(f.env, f.timestamp + 3*86400000)).status, 'no_new_items');
  assert.equal(f.calls(), 0);
});
test('Concurrent run lease prevents duplicate posting', async t => {
  const f = fixture(t);
  f.db.prepare('INSERT INTO locks VALUES(?,?)').run('run', f.timestamp + 60000);
  assert.equal((await run(f.env, f.timestamp)).status, 'busy');
  assert.equal(f.calls(), 0);
});
test('Initialization-only mode never publishes even when new content exists', async t => {
  const f = fixture(t); f.env.INITIALIZE_ONLY = 'true';
  f.db.exec("INSERT INTO sources VALUES('diario-financiero',1)");
  assert.equal((await run(f.env, f.timestamp)).status, 'checked_without_publishing');
  assert.equal(f.calls(), 0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM entries').get().n, 0);
});
test('Bounded diagnostics skip already initialized sources', async t => {
  const f = fixture(t); f.env.INITIALIZE_ONLY = 'true'; f.env.DIAGNOSTIC_UNTIL = String(f.timestamp + 60000);
  f.db.exec("INSERT INTO sources VALUES('diario-financiero',1)");
  assert.equal((await run(f.env,f.timestamp)).status,'diagnostic_complete');
  assert.equal(globalThis.fetch.mock.callCount(),0);
});
test('Expired diagnostics do not access external services', async t => {
  const f = fixture(t); f.env.DIAGNOSTIC_UNTIL = String(f.timestamp - 1);
  assert.equal((await run(f.env,f.timestamp)).status,'diagnostic_expired');
  assert.equal(globalThis.fetch.mock.callCount(),0);
});
