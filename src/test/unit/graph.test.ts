import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySchema } from '../../db/database.js';
import type { DatabaseSchema, Note, Task, Thought, Link } from '../../db/database.js';
import { buildLocalGraph, getBacklinks, isActiveInMonth, suggestFocus } from '../../db/graph.js';

const OLD = '2025-01-10T09:00:00.000Z';  // long before the month under test
const MAR = '2025-03-10T09:00:00.000Z';

function note(id: string, title: string, content = '', extra: Partial<Note> = {}): Note {
  return { id, title, content, tags: [], pinned: false, createdAt: OLD, updatedAt: OLD, ...extra };
}
function task(id: string, title: string, description = '', extra: Partial<Task> = {}): Task {
  return { id, title, description, status: 'todo', priority: 'medium', actualMinutes: 0, tags: [], order: 0, createdAt: OLD, ...extra };
}
function thought(id: string, text: string, extra: Partial<Thought> = {}): Thought {
  return { id, text, status: 'kept', capturedAt: OLD, ...extra };
}
function link(id: string, from: Link['from'], to: Link['to'], createdAt = OLD): Link {
  return { id, from, to, kind: 'link', fromLabel: from.id, toLabel: to.id, createdAt };
}

/**
 * hub (note, edited in March)
 *   ├─ mentions → taskA (active: session in March)
 *   ├─ mentions → noteOld (inactive) → mentions → noteFar (active)   ← depth 2 via a stale hop
 *   ├─ link    ↔ taskDone (active: completed in March) ← mentions ← noteDeep (active) and noteDeepOld (inactive)
 *   ├─ link    → deleted task "gone" (label snapshot only)
 *   └─ thoughtHid (discarded; mentions hub) must stay invisible
 * thoughtA became taskA and was captured during taskDone.
 */
function fixture(): DatabaseSchema {
  const d = emptySchema();
  d.notes.push(
    note('hub', 'Hub', 'Plan: [[task:Task A]], background in [[Old note]].', { updatedAt: MAR }),
    note('noteOld', 'Old note', 'See [[Far note]]'),
    note('noteFar', 'Far note', '', { updatedAt: MAR }),
    note('noteDeep', 'Deep note', 'About [[task:Done task]]', { updatedAt: MAR }),
    note('noteDeepOld', 'Deep old note', 'Also [[task:Done task]]'),
  );
  d.tasks.push(
    task('taskA', 'Task A'),
    task('taskDone', 'Done task', '', { status: 'done', completedAt: MAR }),
  );
  d.thoughts.push(
    thought('thoughtA', 'Do task A', { status: 'converted', taskId: 'taskA', context: { view: 'today', timerRunning: true, taskId: 'taskDone' } }),
    thought('thoughtHid', 'Secretly [[Hub]]', { status: 'discarded' }),
  );
  d.focusSessions.push({ id: 's1', taskId: 'taskA', durationMinutes: 40, type: 'focus', completed: true, timestamp: '2025-03-05T10:00:00.000Z' });
  d.links.push(
    link('l1', { type: 'note', id: 'hub' }, { type: 'task', id: 'taskDone' }),
    link('l2', { type: 'note', id: 'hub' }, { type: 'task', id: 'gone' }),
  );
  return d;
}

const key = (n: { type: string; id: string }) => `${n.type}:${n.id}`;

test('graph - month activity: own timestamps, focus blocks, links made this month, zone boundaries', () => {
  const d = fixture();
  const tz = 'UTC';
  assert.equal(isActiveInMonth({ type: 'note', id: 'hub' }, d, '2025-03', tz), true, 'updated in March');
  assert.equal(isActiveInMonth({ type: 'note', id: 'noteOld' }, d, '2025-03', tz), false);
  assert.equal(isActiveInMonth({ type: 'task', id: 'taskA' }, d, '2025-03', tz), true, 'a focus block in March counts');
  assert.equal(isActiveInMonth({ type: 'task', id: 'taskA' }, d, '2025-02', tz), false);
  assert.equal(isActiveInMonth({ type: 'task', id: 'taskDone' }, d, '2025-03', tz), true, 'completed in March');
  assert.equal(isActiveInMonth({ type: 'thought', id: 'thoughtA' }, d, '2025-03', tz), false);
  assert.equal(isActiveInMonth({ type: 'task', id: 'missing' }, d, '2025-03', tz), false);

  // A link made this month makes both ends active.
  d.links.push(link('l3', { type: 'note', id: 'noteOld' }, { type: 'thought', id: 'thoughtA' }, '2025-03-20T12:00:00.000Z'));
  assert.equal(isActiveInMonth({ type: 'thought', id: 'thoughtA' }, d, '2025-03', tz), true);

  // 2025-03-31T23:30Z is already April in Auckland.
  const late = emptySchema();
  late.notes.push(note('n', 'N', '', { updatedAt: '2025-03-31T23:30:00.000Z' }));
  assert.equal(isActiveInMonth({ type: 'note', id: 'n' }, late, '2025-03', 'UTC'), true);
  assert.equal(isActiveInMonth({ type: 'note', id: 'n' }, late, '2025-03', 'Pacific/Auckland'), false);
  assert.equal(isActiveInMonth({ type: 'note', id: 'n' }, late, '2025-04', 'Pacific/Auckland'), true);
});

test('graph - by default the month filters: quiet direct neighbours are left out and counted', () => {
  const g = buildLocalGraph(fixture(), { focus: { type: 'note', id: 'hub' }, month: '2025-03', tz: 'UTC' });
  assert.equal(g.includeQuiet, false);
  assert.deepEqual(g.nodes.filter(n => n.depth === 1).map(key).sort(), ['task:taskA', 'task:taskDone'], 'noteOld (quiet) and the deleted task are out');
  assert.equal(g.hiddenQuiet, 2);
  assert.deepEqual(g.nodes.filter(n => n.depth === 2).map(key), ['note:noteDeep'], 'noteFar is only reachable through the quiet hop, so it is out too');
  assert.ok(g.nodes.every(n => n.depth === 0 || n.active), 'everything drawn was active this month');
  assert.ok(!g.edges.some(e => e.to.id === 'gone' || e.to.id === 'noteOld'));

  // A month with nothing going on: just the focus, and the count tells the UI what is hidden.
  const quietMonth = buildLocalGraph(fixture(), { focus: { type: 'note', id: 'hub' }, month: '2024-11', tz: 'UTC' });
  assert.equal(quietMonth.nodes.length, 1);
  assert.equal(quietMonth.hiddenQuiet, 4);
  assert.equal(quietMonth.edges.length, 0);
});

test('graph - with includeQuiet: all direct neighbours, active depth-2 only, deleted ends, hidden thoughts', () => {
  const g = buildLocalGraph(fixture(), { focus: { type: 'note', id: 'hub' }, month: '2025-03', tz: 'UTC', includeQuiet: true });
  assert.equal(g.includeQuiet, true);
  assert.equal(g.hiddenQuiet, 0);
  const byKey = Object.fromEntries(g.nodes.map(n => [key(n), n]));

  assert.equal(byKey['note:hub'].depth, 0);
  assert.deepEqual(
    g.nodes.filter(n => n.depth === 1).map(key).sort(),
    ['note:noteOld', 'task:gone', 'task:taskA', 'task:taskDone'],
  );
  assert.equal(byKey['note:noteOld'].stale, true, 'inactive direct neighbour is kept but marked stale');
  assert.equal(byKey['task:taskA'].active, true);
  assert.equal(byKey['task:taskA'].meta.minutesThisMonth, 40);
  assert.equal(byKey['task:gone'].deleted, true);
  assert.equal(byKey['task:gone'].label, 'gone', 'label comes from the link snapshot');

  assert.deepEqual(
    g.nodes.filter(n => n.depth === 2).map(key).sort(),
    ['note:noteDeep', 'note:noteFar'],
    'depth 2 includes only active items — noteDeepOld is dropped, noteFar is reached through a stale hop',
  );
  assert.equal(byKey['thought:thoughtHid'], undefined, 'discarded thoughts never appear');
  assert.equal(byKey['thought:thoughtA'], undefined, 'thoughtA is depth 2 but inactive');

  const edgeKeys = g.edges.map(e => `${e.kind} ${key(e.from)}>${key(e.to)}`).sort();
  assert.deepEqual(edgeKeys, [
    'link note:hub>task:gone',
    'link note:hub>task:taskDone',
    'mention note:hub>note:noteOld',
    'mention note:hub>task:taskA',
    'mention note:noteDeep>task:taskDone',
    'mention note:noteOld>note:noteFar',
  ]);
  assert.equal(g.edges.find(e => e.kind === 'link' && e.to.id === 'taskDone')!.id, 'l1', 'explicit links carry their id');
  assert.equal(g.truncated, false);
  assert.equal(g.month, '2025-03');
});

test('graph - structural edges and a focus on a task or a discarded thought', () => {
  const d = fixture();
  d.thoughts[0].capturedAt = MAR; // make thoughtA active
  const g = buildLocalGraph(d, { focus: { type: 'task', id: 'taskA' }, month: '2025-03', tz: 'UTC' });
  const kinds = g.edges.map(e => `${e.kind} ${key(e.from)}>${key(e.to)}`).sort();
  assert.ok(kinds.includes('became thought:thoughtA>task:taskA'));
  assert.ok(kinds.includes('captured_during thought:thoughtA>task:taskDone'), 'depth-2 edge between two included nodes');
  assert.ok(kinds.includes('mention note:hub>task:taskA'));

  const hidden = buildLocalGraph(d, { focus: { type: 'thought', id: 'thoughtHid' }, month: '2025-03', tz: 'UTC', includeQuiet: true });
  assert.equal(hidden.nodes[0].label, 'Secretly [[Hub]]', 'a discarded thought can still be looked at directly');
  assert.equal(hidden.edges.length, 0, 'but its mentions are not indexed');

  const missing = buildLocalGraph(d, { focus: { type: 'note', id: 'nope' }, month: '2025-03', tz: 'UTC' });
  assert.equal(missing.nodes.length, 1);
  assert.equal(missing.nodes[0].deleted, true);
});

test('graph - node cap keeps focus and direct neighbours first and reports truncation', () => {
  const d = emptySchema();
  d.notes.push(note('hub', 'Hub', Array.from({ length: 5 }, (_, i) => `[[N${i}]]`).join(' '), { updatedAt: MAR }));
  for (let i = 0; i < 5; i++) {
    d.notes.push(note(`n${i}`, `N${i}`, Array.from({ length: 4 }, (_, j) => `[[M${i}${j}]]`).join(' '), { updatedAt: MAR }));
    for (let j = 0; j < 4; j++) d.notes.push(note(`m${i}${j}`, `M${i}${j}`, '', { updatedAt: MAR }));
  }
  const full = buildLocalGraph(d, { focus: { type: 'note', id: 'hub' }, month: '2025-03', tz: 'UTC' });
  assert.equal(full.nodes.length, 26);
  const capped = buildLocalGraph(d, { focus: { type: 'note', id: 'hub' }, month: '2025-03', tz: 'UTC', maxNodes: 10 });
  assert.equal(capped.truncated, true);
  assert.equal(capped.nodes.length, 10);
  assert.deepEqual(capped.nodes.slice(0, 6).map(n => n.depth), [0, 1, 1, 1, 1, 1]);
  assert.ok(capped.edges.every(e => capped.nodes.some(n => key(n) === key(e.from)) && capped.nodes.some(n => key(n) === key(e.to))), 'no dangling edges');
});

test('graph - suggestFocus lands on the most connected item active in the month', () => {
  const d = fixture();
  assert.deepEqual(suggestFocus(d, '2025-03', 'UTC'), { ref: { type: 'note', id: 'hub' }, reason: 'active' }, 'hub: 4 edges, active in March');
  // In November nothing is active: falls back to the most recently edited note, and says so.
  assert.deepEqual(suggestFocus(d, '2024-11', 'UTC'), { ref: { type: 'note', id: 'hub' }, reason: 'fallback' });
  d.notes.push(note('fresh', 'Fresh', '', { updatedAt: '2025-06-01T00:00:00.000Z' }));
  assert.deepEqual(suggestFocus(d, '2024-11', 'UTC')!.ref, { type: 'note', id: 'fresh' });
  // December: nothing else existed yet; a task completed then is the only active item.
  d.tasks[1].completedAt = '2024-12-05T00:00:00.000Z';
  assert.deepEqual(suggestFocus(d, '2024-12', 'UTC'), { ref: { type: 'task', id: 'taskDone' }, reason: 'active' });
  // Ties go to notes: in January hub (4 edges, created 10 Jan) beats taskDone (4 edges).
  d.tasks[1].completedAt = '2025-01-05T00:00:00.000Z';
  assert.deepEqual(suggestFocus(d, '2025-01', 'UTC')!.ref, { type: 'note', id: 'hub' });
  assert.equal(suggestFocus(emptySchema(), '2025-01', 'UTC'), null);
});

test('graph - backlinks list both directions with labels, unresolved mentions, and skip discarded thoughts', () => {
  const d = fixture();
  d.notes[0].content += ' and [[Nowhere]]';
  const b = getBacklinks(d, { type: 'task', id: 'taskDone' });
  assert.equal(b.label, 'Done task');
  assert.deepEqual(
    b.connections.map(c => `${c.edge.kind} ${c.direction} ${c.other.label}`),
    ['mention incoming Deep note', 'mention incoming Deep old note', 'link incoming Hub', 'captured_during incoming Do task A'],
  );
  const hub = getBacklinks(d, { type: 'note', id: 'hub' });
  assert.ok(hub.connections.some(c => c.other.deleted && c.other.label === 'gone'));
  assert.ok(!hub.connections.some(c => c.other.id === 'thoughtHid'));
  assert.deepEqual(hub.unresolved.map(u => u.target), ['Nowhere']);
});
