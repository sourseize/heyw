/**
 * Local connection graph around one note, task or thought.
 *
 * Pure functions over a store snapshot, in the style of summary.ts. The graph
 * merges three edge sources into one shape:
 *   - explicit links (`links` collection, kind `link`),
 *   - `[[mentions]]` derived from text (kind `mention`, see links.ts),
 *   - structural facts already in the data: a thought that `became` a task and a
 *     thought `captured_during` work on a task.
 *
 * The graph is deliberately *local* and *recent*: the focus item, everything it
 * touches directly, and — only when active in the requested month — what those
 * touch in turn. Focus sessions are never nodes; they only feed a task's minutes.
 */
import type { DatabaseSchema, EntityRef, Link, Note, Task, Thought } from './database.js';
import { refEquals, refKey } from './database.js';
import { buildMentionIndex, isVisibleThought, type MentionIndex } from './links.js';
import { monthInZone } from './time.js';

export type EdgeKind = 'link' | 'mention' | 'became' | 'captured_during';

export interface GraphEdge {
  kind: EdgeKind;
  from: EntityRef;
  to: EntityRef;
  /** Explicit links carry their id so the UI can remove them. */
  id?: string;
  /** Mentions: how many times the source mentions the target. */
  count?: number;
  ambiguous?: boolean;
}

export interface GraphNode extends EntityRef {
  label: string;
  /** 0 = focus, 1 = direct neighbour, 2 = neighbour of a neighbour. */
  depth: number;
  /** Had activity in the requested month. */
  active: boolean;
  /** Kept only because it touches the focus directly; no activity this month. */
  stale: boolean;
  /** Record no longer exists; known only through an explicit link's label snapshot. */
  deleted: boolean;
  meta: Record<string, unknown>;
}

export interface LocalGraph {
  focus: EntityRef;
  month: string;
  timeZone: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** The node cap was hit; some depth-2 neighbours were left out. */
  truncated: boolean;
  /** Direct neighbours with no activity this month that were left out (`includeQuiet: false`). */
  hiddenQuiet: number;
  /** Whether quiet direct neighbours were included. */
  includeQuiet: boolean;
}

export interface GraphOptions {
  focus: EntityRef;
  month: string;
  tz: string;
  maxNodes?: number;
  /**
   * Include direct neighbours that had no activity in the month (drawn as "quiet").
   * Off by default so the month really filters; the UI offers a toggle.
   */
  includeQuiet?: boolean;
}

export const DEFAULT_MAX_NODES = 60;

// ── Edge sources ──

function structuralEdges(data: DatabaseSchema): GraphEdge[] {
  const taskIds = new Set(data.tasks.map(t => t.id));
  const edges: GraphEdge[] = [];
  for (const th of data.thoughts) {
    if (!isVisibleThought(th)) continue;
    const from: EntityRef = { type: 'thought', id: th.id };
    if (th.taskId && taskIds.has(th.taskId)) {
      edges.push({ kind: 'became', from, to: { type: 'task', id: th.taskId } });
    }
    const ctxTask = th.context?.taskId;
    if (ctxTask && taskIds.has(ctxTask) && ctxTask !== th.taskId) {
      edges.push({ kind: 'captured_during', from, to: { type: 'task', id: ctxTask } });
    }
  }
  return edges;
}

function linkEdges(links: Link[]): GraphEdge[] {
  return links.map(l => ({ kind: 'link', id: l.id, from: l.from, to: l.to }));
}

function mentionEdges(index: MentionIndex): GraphEdge[] {
  return index.edges.map(e => ({ kind: 'mention', from: e.from, to: e.to, count: e.count, ambiguous: e.ambiguous || undefined }));
}

/** Every edge in the store, all three sources merged. */
export function allEdges(data: DatabaseSchema, index: MentionIndex = buildMentionIndex(data)): GraphEdge[] {
  return [...linkEdges(data.links), ...mentionEdges(index), ...structuralEdges(data)];
}

// ── Node facts ──

interface Lookup {
  notes: Map<string, Note>;
  tasks: Map<string, Task>;
  thoughts: Map<string, Thought>;
  /** Minutes of focus per task in the month. */
  taskMinutes: Map<string, number>;
  /** Labels remembered by explicit links, for records that no longer exist. */
  rememberedLabels: Map<string, string>;
}

function buildLookup(data: DatabaseSchema, month: string, tz: string): Lookup {
  const taskMinutes = new Map<string, number>();
  for (const s of data.focusSessions) {
    if (s.type !== 'focus' || !s.taskId || s.durationMinutes <= 0) continue;
    if (monthInZone(s.timestamp, tz) !== month) continue;
    taskMinutes.set(s.taskId, (taskMinutes.get(s.taskId) || 0) + s.durationMinutes);
  }
  const rememberedLabels = new Map<string, string>();
  for (const l of data.links) {
    rememberedLabels.set(refKey(l.from), l.fromLabel);
    rememberedLabels.set(refKey(l.to), l.toLabel);
  }
  return {
    notes: new Map(data.notes.map(n => [n.id, n])),
    tasks: new Map(data.tasks.map(t => [t.id, t])),
    thoughts: new Map(data.thoughts.map(t => [t.id, t])),
    taskMinutes,
    rememberedLabels,
  };
}

const inMonth = (instant: string | undefined, month: string, tz: string) => Boolean(instant) && monthInZone(instant!, tz) === month;

/**
 * "Active this month": any of the record's own timestamps falls in the month, a
 * focus block was logged against it (tasks), or an explicit link touching it was
 * made in the month.
 */
export function isActiveInMonth(ref: EntityRef, data: DatabaseSchema, month: string, tz: string, lookup: Lookup = buildLookup(data, month, tz)): boolean {
  switch (ref.type) {
    case 'note': {
      const n = lookup.notes.get(ref.id);
      if (!n) return false;
      if (inMonth(n.createdAt, month, tz) || inMonth(n.updatedAt, month, tz)) return true;
      break;
    }
    case 'task': {
      const t = lookup.tasks.get(ref.id);
      if (!t) return false;
      if (inMonth(t.createdAt, month, tz) || inMonth(t.updatedAt, month, tz) || inMonth(t.completedAt, month, tz)) return true;
      if (lookup.taskMinutes.has(t.id)) return true;
      break;
    }
    case 'thought': {
      const th = lookup.thoughts.get(ref.id);
      if (!th) return false;
      if (inMonth(th.capturedAt, month, tz) || inMonth(th.reviewedAt, month, tz)) return true;
      break;
    }
  }
  return data.links.some(l => inMonth(l.createdAt, month, tz) && (refEquals(l.from, ref) || refEquals(l.to, ref)));
}

function describe(ref: EntityRef, lookup: Lookup): { label: string; deleted: boolean; meta: Record<string, unknown> } {
  switch (ref.type) {
    case 'note': {
      const n = lookup.notes.get(ref.id);
      if (n) return { label: n.title, deleted: false, meta: { pinned: n.pinned, tags: n.tags, updatedAt: n.updatedAt } };
      break;
    }
    case 'task': {
      const t = lookup.tasks.get(ref.id);
      if (t) {
        return {
          label: t.title,
          deleted: false,
          meta: { status: t.status, priority: t.priority, projectId: t.projectId || null, minutesThisMonth: lookup.taskMinutes.get(t.id) || 0, completedAt: t.completedAt || null },
        };
      }
      break;
    }
    case 'thought': {
      const th = lookup.thoughts.get(ref.id);
      if (th) return { label: th.text, deleted: false, meta: { status: th.status, capturedAt: th.capturedAt } };
      break;
    }
  }
  return { label: lookup.rememberedLabels.get(refKey(ref)) || `(deleted ${ref.type})`, deleted: true, meta: {} };
}

// ── Local graph ──

export function buildLocalGraph(data: DatabaseSchema, options: GraphOptions): LocalGraph {
  const { focus, month, tz } = options;
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const includeQuiet = Boolean(options.includeQuiet);
  const lookup = buildLookup(data, month, tz);
  const index = buildMentionIndex(data);

  // Discarded thoughts stay out of sight unless one is the focus itself.
  const visible = (ref: EntityRef) => {
    if (ref.type !== 'thought' || refEquals(ref, focus)) return true;
    const th = lookup.thoughts.get(ref.id);
    return !th || isVisibleThought(th);
  };

  const edges = allEdges(data, index).filter(e => visible(e.from) && visible(e.to));
  const adjacency = new Map<string, Set<string>>();
  const refsByKey = new Map<string, EntityRef>();
  const connect = (a: EntityRef, b: EntityRef) => {
    refsByKey.set(refKey(a), a);
    refsByKey.set(refKey(b), b);
    if (!adjacency.has(refKey(a))) adjacency.set(refKey(a), new Set());
    if (!adjacency.has(refKey(b))) adjacency.set(refKey(b), new Set());
    adjacency.get(refKey(a))!.add(refKey(b));
    adjacency.get(refKey(b))!.add(refKey(a));
  };
  for (const e of edges) connect(e.from, e.to);

  const active = new Map<string, boolean>();
  const isActive = (key: string) => {
    if (!active.has(key)) active.set(key, isActiveInMonth(refsByKey.get(key)!, data, month, tz, lookup));
    return active.get(key)!;
  };

  const focusKey = refKey(focus);
  refsByKey.set(focusKey, focus);
  const depth = new Map<string, number>([[focusKey, 0]]);
  // Deleted ends (known only from a link's label snapshot) are never "active"; they are
  // kept only when quiet neighbours are requested.
  const allDepth1 = [...(adjacency.get(focusKey) || [])];
  const depth1 = includeQuiet ? allDepth1 : allDepth1.filter(k => isActive(k));
  const hiddenQuiet = allDepth1.length - depth1.length;
  for (const k of depth1) depth.set(k, 1);

  // Depth 2: only neighbours active this month, and never more than the cap allows.
  const depth2 = new Set<string>();
  for (const k1 of depth1) {
    for (const k2 of adjacency.get(k1) || []) {
      if (depth.has(k2) || depth2.has(k2)) continue;
      if (isActive(k2)) depth2.add(k2);
    }
  }

  const nodeFor = (key: string, d: number): GraphNode => {
    const ref = refsByKey.get(key)!;
    const { label, deleted, meta } = describe(ref, lookup);
    const act = !deleted && isActive(key);
    return { ...ref, label, depth: d, active: act, stale: d > 0 && !act, deleted, meta };
  };

  const byLabel = (a: GraphNode, b: GraphNode) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label);
  const ring1 = depth1.map(k => nodeFor(k, 1)).sort((a, b) => Number(b.active) - Number(a.active) || byLabel(a, b));
  const ring2 = [...depth2].map(k => nodeFor(k, 2)).sort(byLabel);

  let nodes = [nodeFor(focusKey, 0), ...ring1, ...ring2];
  const truncated = nodes.length > maxNodes;
  if (truncated) nodes = nodes.slice(0, maxNodes);

  const included = new Set(nodes.map(n => refKey(n)));
  const seen = new Set<string>();
  const graphEdges = edges.filter(e => {
    if (!included.has(refKey(e.from)) || !included.has(refKey(e.to))) return false;
    const key = `${e.kind}|${refKey(e.from)}|${refKey(e.to)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { focus, month, timeZone: tz, nodes, edges: graphEdges, truncated, hiddenQuiet, includeQuiet };
}

/**
 * A sensible place to land when no focus is given: the item with the most
 * connections among those active in the month (notes preferred on ties, then
 * tasks, then thoughts). Falls back to the most recently edited note, then to
 * whatever has the most connections at all. Null only for an empty store.
 */
export interface FocusSuggestion {
  ref: EntityRef;
  /** `active`: most connected item active in the month; `fallback`: nothing was active, latest note (or most connected overall). */
  reason: 'active' | 'fallback';
}

export function suggestFocus(data: DatabaseSchema, month: string, tz: string): FocusSuggestion | null {
  const lookup = buildLookup(data, month, tz);
  const degree = new Map<string, number>();
  const refs = new Map<string, EntityRef>();
  for (const e of allEdges(data)) {
    for (const r of [e.from, e.to]) {
      if (r.type === 'thought') {
        const th = lookup.thoughts.get(r.id);
        if (!th || !isVisibleThought(th)) continue;
      }
      refs.set(refKey(r), r);
      degree.set(refKey(r), (degree.get(refKey(r)) || 0) + 1);
    }
  }
  const rank: Record<string, number> = { note: 0, task: 1, thought: 2 };
  const ordered = [...degree.entries()]
    .map(([key, n]) => ({ ref: refs.get(key)!, n }))
    .filter(({ ref }) => !describe(ref, lookup).deleted)
    .sort((a, b) => b.n - a.n || rank[a.ref.type] - rank[b.ref.type] || a.ref.id.localeCompare(b.ref.id));
  const active = ordered.find(({ ref }) => isActiveInMonth(ref, data, month, tz, lookup));
  if (active) return { ref: active.ref, reason: 'active' };
  const latestNote = [...data.notes].sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))[0];
  if (latestNote) return { ref: { type: 'note', id: latestNote.id }, reason: 'fallback' };
  return ordered[0] ? { ref: ordered[0].ref, reason: 'fallback' } : null;
}

// ── Backlinks panel ──

export interface Connection {
  edge: GraphEdge;
  /** The end that is not the item being looked at. */
  other: EntityRef & { label: string; deleted: boolean; meta: Record<string, unknown> };
  direction: 'outgoing' | 'incoming';
}

export interface Backlinks {
  ref: EntityRef;
  label: string;
  deleted: boolean;
  connections: Connection[];
  /** `[[mentions]]` in this item's own text that point nowhere (yet). */
  unresolved: { raw: string; target: string; type?: string }[];
}

/** Everything touching `ref`, in both directions, regardless of month. */
export function getBacklinks(data: DatabaseSchema, ref: EntityRef, index: MentionIndex = buildMentionIndex(data)): Backlinks {
  const lookup = buildLookup(data, '0000-00', 'UTC'); // month irrelevant here: minutes are not reported
  const self = describe(ref, lookup);
  const connections: Connection[] = [];
  for (const edge of allEdges(data, index)) {
    const outgoing = refEquals(edge.from, ref);
    const incoming = refEquals(edge.to, ref);
    if (!outgoing && !incoming) continue;
    const otherRef = outgoing ? edge.to : edge.from;
    if (otherRef.type === 'thought') {
      const th = lookup.thoughts.get(otherRef.id);
      if (th && !isVisibleThought(th)) continue;
    }
    const other = describe(otherRef, lookup);
    connections.push({ edge, other: { ...otherRef, ...other }, direction: outgoing ? 'outgoing' : 'incoming' });
  }
  const order: Record<EdgeKind, number> = { mention: 0, link: 1, became: 2, captured_during: 3 };
  connections.sort((a, b) => order[a.edge.kind] - order[b.edge.kind] || a.direction.localeCompare(b.direction) || a.other.label.localeCompare(b.other.label));
  const unresolved = (index.unresolved.get(refKey(ref)) || []).map(m => ({ raw: m.raw, target: m.target, type: m.type }));
  return { ref, label: self.label, deleted: self.deleted, connections, unresolved };
}
