import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, canonical, eligible, discordPost, SOURCES, chileDay, sourceAt } from '../src/feeds.js';
import worker, { run } from '../src/worker.js';

test('RSS normalization and removal of tracking identifiers', () => {
  const items = parseFeed('<rss><channel><item><title><![CDATA[Hola <b>mundo</b>]]></title><link>https://example.com/a?utm_source=x</link><pubDate>Fri, 06 Nov 2026 12:00:00 GMT</pubDate></item></channel></rss>');
  assert.equal(items[0].title, 'Hola mundo');
  assert.equal(items[0].url, 'https://example.com/a');
  assert.equal(eligible(items[0], SOURCES[0], Date.parse('2026-11-07')), true);
});
test('Atom links and invalid destinations', () => {
  const items = parseFeed('<feed><entry><title>Curso</title><link rel="self" href="https://example.com/self"/><link rel="alternate" href="https://example.com/course"/><updated>2026-11-06T00:00:00Z</updated></entry></feed>');
  assert.equal(items[0].url, 'https://example.com/course');
  assert.equal(canonical('javascript:alert(1)'), null);
  assert.throws(() => parseFeed('<!DOCTYPE rss><rss/>'));
});
test('Ignore undated, old and future entries', () => {
  const now = Date.now();
  for (const date of [NaN, now - 90 * 86400000, now + 86400000]) assert.equal(eligible({date}, SOURCES[0], now), false);
});
test('Disable Discord mentions and respect forum title length', () => {
  const post = discordPost({title: 'a'.repeat(150), url:'https://example.com'}, SOURCES[0]);
  assert.equal(post.name.length, 100);
  assert.deepEqual(post.message.allowed_mentions, {parse: []});
});
test('Paused deployment never fetches or writes to Discord', async () => {
  assert.deepEqual(await run({ENABLED:'false'}), {status:'paused'});
});
test('Daily quota follows Chile local date in summer and winter', () => {
  assert.equal(chileDay(Date.parse('2026-11-07T02:30:00Z')), '2026-11-06');
  assert.equal(chileDay(Date.parse('2026-07-07T03:30:00Z')), '2026-07-06');
});
test('Stale diagnostic schedule cannot publish after restoring normal frequency', async () => {
  await worker.scheduled({cron:'* * * * *',scheduledTime:Date.now()},{ENABLED:'true'});
});

test('DW RSS 1.0/RDF reads sibling items and dc:date', () => {
  const items = parseFeed('<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>DW</title></channel><item><title>Actualidad mundial</title><link>https://www.dw.com/es/noticia/a-123</link><dc:date>2026-11-08T12:11:00Z</dc:date></item></rdf:RDF>');
  assert.deepEqual(items, [{title:'Actualidad mundial',url:'https://www.dw.com/es/noticia/a-123',date:Date.parse('2026-11-08T12:11:00Z')}]);
});

test('XML entities preserve titles and URL query parameters', () => {
  const [item] = parseFeed('<rss><channel><item><title>Chile &amp; econom&#237;a</title><link>https://www.df.cl/noticia?a=1&amp;b=2</link></item></channel></rss>');
  assert.equal(item.title, 'Chile & economía');
  assert.equal(item.url, 'https://www.df.cl/noticia?a=1&b=2');
  assert.throws(() => parseFeed('<!DOCTYPE rss [<!ENTITY injected "value">]><rss/>'), /DTD/);
});

test('BioBioChile accepts current affairs sections and excludes unrelated stories', () => {
  const source = SOURCES.find(s => s.id === 'biobiochile');
  const now = Date.now();
  for (const section of ['nacional', 'internacional', 'economia', 'ciencia-y-tecnologia']) {
    assert.equal(eligible({date:now,url:`https://www.biobiochile.cl/noticias/${section}/articulo.shtml`}, source, now), true);
  }
  for (const path of ['deportes', 'espectaculos-y-tv', 'sociedad', 'opinion', 'servicios', 'nacional-falso']) {
    assert.equal(eligible({date:now,url:`https://www.biobiochile.cl/noticias/${path}/articulo.shtml`}, source, now), false);
  }
  assert.equal(eligible({date:now,url:'https://otro.cl/noticias/nacional/articulo'},source,now), false);
  assert.equal(eligible({date:now,url:'invalid'},source,now), false);
  assert.equal(eligible({date:now-3*86400000,url:'https://www.biobiochile.cl/noticias/nacional/articulo'},source,now), false);
});

test('Real cron slots rotate all three news sources evenly and preserve hourly library', () => {
  const counts = {};
  const start = Date.parse('2026-11-08T00:00:00Z');
  for (let hour=0; hour<48; hour++) {
    assert.equal(sourceAt(start + hour*3600000 + 7*60000).id, 'freecodecamp-es');
    const source = sourceAt(start + hour*3600000 + 38*60000);
    counts[source.id] = (counts[source.id] ?? 0) + 1;
    assert.equal(source.channel, 'NEWS_CHANNEL_ID');
  }
  assert.deepEqual(counts, {'diario-financiero':16,'dw-es':16,'biobiochile':16});
  assert.equal(SOURCES.some(source => /bbc/i.test(JSON.stringify(source))), false);
});
