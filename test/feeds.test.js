import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, canonical, eligible, discordPost, SOURCES, chileDay } from '../src/feeds.js';
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
