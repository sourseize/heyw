import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/testServer.js';
import type { TestServer } from '../helpers/testServer.js';

let srv: TestServer;
test.before(async () => { srv = await startTestServer(); });
test.after(async () => { await srv.close(); });

test('links API - explicit links: validation, idempotence, listing, removal', async () => {
  const { data: note } = await srv.api('POST', '/api/notes', { title: 'Invoice process', content: 'steps…' });
  const { data: task } = await srv.api('POST', '/api/tasks', { title: 'Send invoice' });

  assert.equal((await srv.api('POST', '/api/links', { from: { type: 'note', id: note.id } })).status, 400);
  assert.equal((await srv.api('POST', '/api/links', { from: { type: 'project', id: 'x' }, to: { type: 'task', id: task.id } })).status, 400);
  assert.equal((await srv.api('POST', '/api/links', { from: { type: 'note', id: note.id }, to: { type: 'note', id: note.id } })).status, 400, 'self link');
  assert.equal((await srv.api('POST', '/api/links', { from: { type: 'note', id: note.id }, to: { type: 'task', id: 'nope' } })).status, 404);

  const created = await srv.api('POST', '/api/links', { from: { type: 'note', id: note.id }, to: { type: 'task', id: task.id } });
  assert.equal(created.status, 201);
  assert.equal(created.data.kind, 'link');
  assert.equal(created.data.fromLabel, 'Invoice process');
  assert.equal(created.data.toLabel, 'Send invoice');

  const again = await srv.api('POST', '/api/links', { from: { type: 'task', id: task.id }, to: { type: 'note', id: note.id } });
  assert.equal(again.status, 200, 'same pair (either direction) is not created twice');
  assert.equal(again.data.id, created.data.id);

  const store = await srv.readStore();
  assert.equal(store.links.length, 1, 'persisted');

  const fromNote = await srv.api('GET', `/api/links?type=note&id=${note.id}`);
  assert.equal(fromNote.data.label, 'Invoice process');
  assert.deepEqual(fromNote.data.connections.map((c: any) => [c.edge.kind, c.direction, c.other.label]), [['link', 'outgoing', 'Send invoice']]);
  const fromTask = await srv.api('GET', `/api/links?type=task&id=${task.id}`);
  assert.deepEqual(fromTask.data.connections.map((c: any) => [c.edge.kind, c.direction, c.other.label]), [['link', 'incoming', 'Invoice process']]);
  assert.equal((await srv.api('GET', '/api/links?type=task')).status, 400);
  assert.equal((await srv.api('GET', `/api/links?type=journal&id=${task.id}`)).status, 400);

  // The task goes away: the link and its label stay.
  await srv.api('DELETE', `/api/tasks/${task.id}`);
  const after = await srv.api('GET', `/api/links?type=note&id=${note.id}`);
  assert.equal(after.data.connections[0].other.deleted, true);
  assert.equal(after.data.connections[0].other.label, 'Send invoice');

  assert.equal((await srv.api('DELETE', `/api/links/${created.data.id}`)).status, 200);
  assert.equal((await srv.api('DELETE', `/api/links/${created.data.id}`)).status, 404);
  assert.equal((await srv.readStore()).links.length, 0);
});

test('links API - mentions are derived from text, preview resolves unsaved text, renames rewrite', async () => {
  const { data: task } = await srv.api('POST', '/api/tasks', { title: 'Write the brief' });
  const { data: note } = await srv.api('POST', '/api/notes', { title: 'Brief notes', content: 'Draft for [[task:Write the brief]] and [[Missing page]].' });

  const preview = await srv.api('POST', '/api/links/preview', { text: 'x [[Write the brief]] y [[thought:nothing]]' });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.data.mentions.map((m: any) => [m.target, m.resolved?.type ?? null]), [['Write the brief', 'task'], ['nothing', null]]);
  assert.equal((await srv.api('POST', '/api/links/preview', { text: 42 })).status, 400);

  const back = await srv.api('GET', `/api/links?type=task&id=${task.id}`);
  assert.deepEqual(back.data.connections.map((c: any) => [c.edge.kind, c.direction, c.other.label, c.edge.count]), [['mention', 'incoming', 'Brief notes', 1]]);
  const own = await srv.api('GET', `/api/links?type=note&id=${note.id}`);
  assert.deepEqual(own.data.unresolved.map((u: any) => u.target), ['Missing page']);

  const renamed = await srv.api('PUT', `/api/tasks/${task.id}`, { title: 'Write the brief v2' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.rewrittenMentions, 1);
  assert.equal(renamed.headers.get('x-heywork-rewritten-mentions'), '1');
  assert.ok(renamed.data.updatedAt, 'tasks now record their last edit');
  const updatedNote = await srv.api('GET', `/api/notes/${note.id}`);
  assert.equal(updatedNote.data.content, 'Draft for [[task:Write the brief v2]] and [[Missing page]].');

  // Creating the missing page resolves the dangling mention without touching the text.
  await srv.api('POST', '/api/notes', { title: 'Missing page', content: '' });
  const resolved = await srv.api('GET', `/api/links?type=note&id=${note.id}`);
  assert.deepEqual(resolved.data.unresolved, []);
  assert.equal(resolved.data.connections.length, 2);

  // Thoughts: referenced by text; editing the text rewrites mentions of it.
  const { data: thought } = await srv.api('POST', '/api/thoughts', { text: 'Ask Dana about the pricing page' });
  await srv.api('PUT', `/api/notes/${note.id}`, { content: 'Remember [[thought:Ask Dana about the pricing page]]' });
  const edited = await srv.api('PUT', `/api/thoughts/${thought.id}`, { text: 'Ask Dana about pricing' });
  assert.equal(edited.data.rewrittenMentions, 1);
  assert.equal((await srv.api('GET', `/api/notes/${note.id}`)).data.content, 'Remember [[thought:Ask Dana about pricing]]');
});

test('links API - search for the autocomplete: ranking, type filter, limits', async () => {
  const res = await srv.api('GET', '/api/search?q=brief');
  assert.equal(res.status, 200);
  assert.ok(res.data.length >= 2);
  assert.ok(res.data.every((h: any) => typeof h.insert === 'string' && h.insert.startsWith('[[') && h.ref.type));
  const notesOnly = await srv.api('GET', '/api/search?q=brief&types=note');
  assert.ok(notesOnly.data.every((h: any) => h.ref.type === 'note'));
  assert.equal((await srv.api('GET', '/api/search?q=x&types=note,journal')).status, 400);
  assert.equal((await srv.api('GET', '/api/search?limit=1')).data.length, 1, 'an empty query lists recent items');
});

test('links API - local graph around an item, scoped to a month', async () => {
  const { data: task } = await srv.api('POST', '/api/tasks', { title: 'Graph task' });
  const { data: note } = await srv.api('POST', '/api/notes', { title: 'Graph note', content: 'See [[task:Graph task]]' });
  const now = new Date();
  const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  const g = await srv.api('GET', `/api/graph?focus=note:${note.id}&tz=UTC`);
  assert.equal(g.status, 200);
  assert.equal(g.data.month, thisMonth, 'defaults to the current month');
  assert.equal(g.data.nodes[0].id, note.id);
  assert.equal(g.data.nodes[0].depth, 0);
  assert.ok(g.data.nodes.some((n: any) => n.id === task.id && n.depth === 1 && n.active === true));
  assert.ok(g.data.edges.some((e: any) => e.kind === 'mention' && e.to.id === task.id));

  const past = await srv.api('GET', `/api/graph?focus=note:${note.id}&month=2001-01&tz=UTC`);
  assert.equal(past.data.nodes.length, 1, 'outside the month only the focus remains');
  assert.equal(past.data.hiddenQuiet, 1);
  const withQuiet = await srv.api('GET', `/api/graph?focus=note:${note.id}&month=2001-01&tz=UTC&quiet=1`);
  const taskNode = withQuiet.data.nodes.find((n: any) => n.id === task.id);
  assert.equal(taskNode.stale, true, 'quiet=1 brings the direct neighbour back, marked stale');
  assert.equal(withQuiet.data.includeQuiet, true);

  // No focus: the server suggests the most connected item active this month.
  const suggested = await srv.api('GET', '/api/graph?tz=UTC');
  assert.equal(suggested.status, 200);
  assert.equal(suggested.data.suggested, 'active');
  const future = await srv.api('GET', '/api/graph?tz=UTC&month=2099-01');
  assert.equal(future.data.suggested, 'fallback', 'nothing active: falls back and says so');
  assert.ok(['note', 'task', 'thought'].includes(suggested.data.focus.type));
  assert.ok(suggested.data.nodes.length >= 1);
  assert.equal((await srv.api('GET', '/api/graph?focus=&tz=UTC')).status, 400, 'an empty focus is an error, not a suggestion');

  assert.equal((await srv.api('GET', `/api/graph?focus=project:${note.id}`)).status, 400);
  assert.equal((await srv.api('GET', `/api/graph?focus=note:${note.id}&month=2025-13`)).status, 400);
  const warned = await srv.api('GET', `/api/graph?focus=note:${note.id}&tz=Mars/Olympus`);
  assert.equal(warned.status, 200);
  assert.match(warned.headers.get('x-heywork-warning') || '', /Unknown time zone/);
});

test('links API - PUT allow-lists are unchanged: links cannot be smuggled through record updates', async () => {
  const { data: note } = await srv.api('POST', '/api/notes', { title: 'Allow-list' });
  const res = await srv.api('PUT', `/api/notes/${note.id}`, { title: 'Allow-list', links: [{ hack: true }], id: 'other' });
  assert.equal(res.status, 200);
  assert.equal(res.data.id, note.id);
  assert.equal(res.data.links, undefined);
});
