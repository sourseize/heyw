import test from 'node:test';
import assert from 'node:assert/strict';
import { Database, emptySchema } from '../../db/database.js';
import type { DatabaseSchema, Note, Task, Thought } from '../../db/database.js';
import {
  applyRename, buildCatalog, buildMentionIndex, mentionIndexFor, parseMentions, parseRef, planRename,
  resolveMention, rewriteMentions, searchLinkables, THOUGHT_PREFIX_MIN,
} from '../../db/links.js';

const T0 = '2025-03-01T09:00:00.000Z';

function note(id: string, title: string, content = '', extra: Partial<Note> = {}): Note {
  return { id, title, content, tags: [], pinned: false, createdAt: T0, updatedAt: T0, ...extra };
}
function task(id: string, title: string, description = '', extra: Partial<Task> = {}): Task {
  return { id, title, description, status: 'todo', priority: 'medium', actualMinutes: 0, tags: [], order: 0, createdAt: T0, ...extra };
}
function thought(id: string, text: string, extra: Partial<Thought> = {}): Thought {
  return { id, text, status: 'inbox', capturedAt: T0, ...extra };
}

function fixture(): DatabaseSchema {
  const d = emptySchema();
  d.notes.push(
    note('n1', 'Invoice process', 'See [[task:Send invoice]] and [[Pricing]] and [[thought:Ask Dana about the]]. Escaped: \\[[not a link]]. Self: [[Invoice process]]'),
    note('n2', 'Pricing', 'Mentions [[Invoice process|the process]] twice: [[ invoice process ]]'),
    note('n3', 'Shared title', '', { updatedAt: '2025-03-02T00:00:00.000Z' }),
    note('n4', 'Shared title', '', { updatedAt: '2025-03-05T00:00:00.000Z' }),
  );
  d.tasks.push(
    task('t1', 'Send invoice', 'Context in [[Invoice process]]'),
    task('t2', 'Pricing', 'A task that shares a title with a note'),
  );
  d.thoughts.push(
    thought('th1', 'Ask Dana about the pricing page copy before Friday'),
    thought('th2', 'Ask Dana about the other thing'),
    thought('th3', 'Hidden [[Pricing]]', { status: 'discarded' }),
  );
  return d;
}

test('links - grammar: typed, untyped, display text, escapes, malformed', () => {
  const text = 'a [[One]] b [[task:Two|shown]] c \\[[escaped]] d [[ note : Three ]] e [[]] f [[unterminated g [[nested [[x]]]] h [[line\nbreak]]';
  const m = parseMentions(text);
  assert.deepEqual(m.map(x => [x.type, x.target, x.label]), [
    [undefined, 'One', 'One'],
    ['task', 'Two', 'shown'],
    ['note', 'Three', 'Three'],
    [undefined, 'x', 'x'],
  ]);
  assert.equal(m[0].offset, 2);
  assert.equal(m[0].raw, '[[One]]');
  assert.deepEqual(parseMentions(''), []);
  assert.deepEqual(parseMentions('[[task:|label only]]'), [], 'empty target is not a mention');
});

test('links - resolution precedence, typing, case/whitespace, thought prefix', () => {
  const catalog = buildCatalog(fixture());
  const r = (s: string) => resolveMention(parseMentions(s)[0], catalog);

  assert.deepEqual(r('[[Pricing]]').resolved, { type: 'note', id: 'n2' }, 'untyped: note wins over task');
  assert.deepEqual(r('[[task:Pricing]]').resolved, { type: 'task', id: 't2' }, 'typed: only that collection');
  assert.deepEqual(r('[[ SEND   invoice ]]').resolved, { type: 'task', id: 't1' }, 'case and whitespace insensitive');
  assert.equal(r('[[note:Send invoice]]').resolved, null, 'typed miss does not fall through');
  assert.equal(r('[[Nothing here]]').resolved, null);

  assert.deepEqual(r('[[thought:Ask Dana about the pricing page copy before Friday]]').resolved, { type: 'thought', id: 'th1' }, 'exact thought text');
  assert.equal(r('[[thought:Ask Dana about the]]').resolved, null, 'prefix shared by two thoughts is not unique');
  assert.deepEqual(r('[[thought:Ask Dana about the pricing]]').resolved, { type: 'thought', id: 'th1' }, 'unique prefix resolves');
  assert.equal(r('[[thought:Ask Dana]]').resolved, null, `prefixes shorter than ${THOUGHT_PREFIX_MIN} never match`);
  assert.equal(r('[[thought:Hidden]]').resolved, null, 'discarded thoughts cannot be referenced');

  const amb = r('[[Shared title]]');
  assert.deepEqual(amb.resolved, { type: 'note', id: 'n4' }, 'most recently updated wins');
  assert.equal(amb.ambiguous, true);
  assert.equal(amb.resolvedLabel, 'Shared title');
});

test('links - mention index: edges deduplicated with counts, self-mentions and discarded thoughts excluded', () => {
  const index = buildMentionIndex(fixture());
  const key = (e: { from: any; to: any }) => `${e.from.type}:${e.from.id}->${e.to.type}:${e.to.id}`;
  const edges = Object.fromEntries(index.edges.map(e => [key(e), e.count]));
  assert.deepEqual(edges, {
    'note:n1->task:t1': 1,
    'note:n1->note:n2': 1,
    'note:n2->note:n1': 2,
    'task:t1->note:n1': 1,
  });
  assert.deepEqual(index.unresolved.get('note:n1')?.map(m => m.target), ['Ask Dana about the'], 'ambiguous thought prefix is reported as unresolved');
  assert.equal(index.unresolved.has('thought:th3'), false, 'discarded thoughts are not parsed');
});

test('links - index cache follows the store revision', () => {
  const db = Database.fromSnapshot(fixture());
  const first = mentionIndexFor(db);
  assert.equal(mentionIndexFor(db), first, 'same revision, same object');
  db.updateNote('n2', { content: 'nothing anymore' });
  const second = mentionIndexFor(db);
  assert.notEqual(second, first);
  assert.equal(second.edges.some(e => e.from.id === 'n2'), false);
});

test('links - rename rewrites only mentions that resolved to the renamed item', () => {
  const data = fixture();
  const catalog = buildCatalog(data);
  const r = rewriteMentions('[[Pricing]] [[task:Pricing]] [[note:Pricing|the page]] \\[[Pricing]]', { type: 'note', id: 'n2' }, 'Pricing v2', catalog);
  assert.equal(r.count, 2);
  assert.equal(r.text, '[[Pricing v2]] [[task:Pricing]] [[note:Pricing v2|the page]] \\[[Pricing]]');

  const plan = planRename(data, { type: 'note', id: 'n1' }, 'Invoicing');
  assert.deepEqual(plan.map(c => [c.ref.type, c.ref.id, c.count]).sort(), [['note', 'n1', 1], ['note', 'n2', 2], ['task', 't1', 1]]);
  assert.equal(plan.find(c => c.ref.id === 'n2')!.text, 'Mentions [[Invoicing|the process]] twice: [[Invoicing]]');

  // Renaming the *task* called Pricing must not touch untyped [[Pricing]] (which points at the note).
  const taskPlan = planRename(data, { type: 'task', id: 't2' }, 'Pricing task');
  assert.deepEqual(taskPlan, []);
});

test('links - applyRename mutates the store and is a no-op for same-title saves', () => {
  const db = Database.fromSnapshot(fixture());
  assert.equal(applyRename(db, { type: 'note', id: 'n1' }, 'invoice PROCESS'), 0, 'case-only change: nothing rewritten');
  assert.equal(applyRename(db, { type: 'note', id: 'n1' }, 'Invoicing'), 4);
  assert.equal(db.getTask('t1')!.description, 'Context in [[Invoicing]]');
  assert.equal(db.getNote('n2')!.content, 'Mentions [[Invoicing|the process]] twice: [[Invoicing]]');
  assert.equal(db.getNote('n1')!.title, 'Invoice process', 'the title itself is changed by the caller, not here');
});

test('links - search ranks exact > prefix > substring, filters by type, inserts canonical syntax', () => {
  const data = fixture();
  const hits = searchLinkables(data, 'pric');
  assert.deepEqual(hits.slice(0, 2).map(h => h.ref.type), ['note', 'task'], 'prefix hits first, recent first');
  assert.equal(hits[0].insert, '[[note:Pricing]]');
  assert.ok(hits.some(h => h.ref.type === 'thought' && h.insert.startsWith('[[thought:Ask Dana')), 'substring in a thought');
  assert.ok(!hits.some(h => h.ref.id === 'th3'), 'discarded thoughts are not offered');

  const onlyTasks = searchLinkables(data, '', ['task'], 50);
  assert.deepEqual(onlyTasks.map(h => h.ref.type), ['task', 'task']);
  assert.equal(searchLinkables(data, 'zzz').length, 0);

  const long = emptySchema();
  long.thoughts.push(thought('L', 'A very long thought that goes on and on about many things and will not fit in a mention comfortably at all'));
  const [hit] = searchLinkables(long, 'very long');
  assert.equal(hit.insert, '[[thought:A very long thought that goes on and on about many things]]', 'long thoughts get a unique word-boundary prefix');
});

test('links - database: explicit links are idempotent, survive deletion, and load from old files', () => {
  const db = Database.fromSnapshot(fixture());
  const a = db.createLink({ type: 'note', id: 'n1' }, { type: 'task', id: 't1' });
  assert.ok(a && a.created);
  assert.equal(a!.link.fromLabel, 'Invoice process');
  assert.equal(a!.link.toLabel, 'Send invoice');
  const b = db.createLink({ type: 'task', id: 't1' }, { type: 'note', id: 'n1' });
  assert.equal(b!.created, false, 'reverse pair is the same link');
  assert.equal(b!.link.id, a!.link.id);
  assert.equal(db.createLink({ type: 'note', id: 'n1' }, { type: 'task', id: 'missing' }), null);

  db.deleteTask('t1');
  assert.equal(db.getLinks().length, 1, 'deleting an end keeps the link');
  assert.equal(db.labelOf({ type: 'task', id: 't1' }), undefined);
  assert.equal(db.getLinksTouching({ type: 'note', id: 'n1' })[0].toLabel, 'Send invoice', 'label snapshot survives');
  assert.equal(db.deleteLink(a!.link.id), true);
  assert.equal(db.deleteLink(a!.link.id), false);

  const legacy = Database.fromSnapshot({ ...fixture(), links: undefined as any });
  assert.deepEqual(legacy.getLinks(), [], 'a store written before links existed loads with none');
});

test('links - parseRef accepts {type,id} objects and type:id strings only for linkable types', () => {
  assert.deepEqual(parseRef('task:abc'), { type: 'task', id: 'abc' });
  assert.deepEqual(parseRef({ type: 'note', id: ' n1 ' }), { type: 'note', id: 'n1' });
  assert.equal(parseRef('project:abc'), null);
  assert.equal(parseRef('task:'), null);
  assert.equal(parseRef('nocolon'), null);
  assert.equal(parseRef({ type: 'task' }), null);
  assert.equal(parseRef(null), null);
});
