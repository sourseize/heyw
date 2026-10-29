/**
 * Connected thinking: `[[wiki]]` mentions between notes, tasks and thoughts.
 *
 * Grammar (inside the double brackets, no nesting, no line breaks):
 *
 *   [[Title]]                 untyped — resolved note → task → thought
 *   [[task:Title]]            typed   — only that collection is searched
 *   [[note:Title|shown as]]   optional display text after a pipe
 *   \[[not a link]]           a leading backslash escapes the mention
 *
 * Titles match case-insensitively with surrounding whitespace ignored. Thoughts
 * have no title: their text is matched exactly, or by a unique prefix of at least
 * `THOUGHT_PREFIX_MIN` characters. When several records of one type share a
 * title, the most recently updated wins and the mention is flagged `ambiguous`.
 *
 * Nothing in this module is persisted. Mentions are derived from the text every
 * time they are needed (cached per store revision); the text *is* the link.
 */
import type { DatabaseSchema, EntityRef, LinkableType, Note, Task, Thought } from './database.js';
import { LINKABLE_TYPES, refEquals, refKey } from './database.js';
import type { Database } from './database.js';

export const THOUGHT_PREFIX_MIN = 12;

export interface Mention {
  /** The full `[[…]]` source text, as written. */
  raw: string;
  /** Explicit collection prefix, when given. */
  type?: LinkableType;
  /** What is being referenced (title / thought text), trimmed. */
  target: string;
  /** Text to display: the part after `|`, else the target. */
  label: string;
  /** Character offset of `raw` in the document. */
  offset: number;
}

export interface ResolvedMention extends Mention {
  resolved: EntityRef | null;
  /** Label of the resolved record (its current title/text). */
  resolvedLabel?: string;
  /** Several records matched; the most recently updated one was chosen. */
  ambiguous?: boolean;
}

export interface MentionEdge {
  kind: 'mention';
  from: EntityRef;
  to: EntityRef;
  /** How many times the document mentions the target. */
  count: number;
  ambiguous: boolean;
}

export interface TextDocument {
  ref: EntityRef;
  text: string;
}

export interface MentionIndex {
  edges: MentionEdge[];
  /** Mentions that did not resolve, per source document (`refKey`). */
  unresolved: Map<string, Mention[]>;
}

// ── Parsing ──

const MENTION_RE = /(\\?)\[\[([^\[\]\n]+?)\]\]/g;
const TYPE_PREFIX_RE = /^\s*(note|task|thought)\s*:\s*/i;

/** Finds every `[[…]]` mention in `text`. Escaped (`\[[`) and empty ones are skipped. */
export function parseMentions(text: string): Mention[] {
  const out: Mention[] = [];
  if (!text) return out;
  MENTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(text)) !== null) {
    if (m[1]) continue; // escaped
    let inner = m[2];
    let type: LinkableType | undefined;
    const prefix = TYPE_PREFIX_RE.exec(inner);
    if (prefix) {
      type = prefix[1].toLowerCase() as LinkableType;
      inner = inner.slice(prefix[0].length);
    }
    const pipe = inner.indexOf('|');
    const target = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
    const label = (pipe === -1 ? target : inner.slice(pipe + 1).trim()) || target;
    if (!target) continue;
    out.push({ raw: m[0], type, target, label, offset: m.index });
  }
  return out;
}

/** Canonical source text for a reference, as the autocomplete inserts it. */
export function mentionSyntax(type: LinkableType, target: string): string {
  return `[[${type}:${target}]]`;
}

// ── Resolution ──

interface CatalogEntry {
  ref: EntityRef;
  label: string;
  key: string;       // normalised label
  updatedAt: string; // tie-breaker: most recent wins
}

export interface Catalog {
  note: CatalogEntry[];
  task: CatalogEntry[];
  thought: CatalogEntry[];
}

const normalise = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Thoughts that can be referenced or can mention: discarded ones are out of sight. */
export function isVisibleThought(t: Thought): boolean {
  return t.status !== 'discarded';
}

export function buildCatalog(data: DatabaseSchema): Catalog {
  return {
    note: data.notes.map(n => ({ ref: { type: 'note', id: n.id }, label: n.title, key: normalise(n.title), updatedAt: n.updatedAt || n.createdAt })),
    task: data.tasks.map(t => ({ ref: { type: 'task', id: t.id }, label: t.title, key: normalise(t.title), updatedAt: t.updatedAt || t.createdAt })),
    thought: data.thoughts.filter(isVisibleThought).map(t => ({ ref: { type: 'thought', id: t.id }, label: t.text, key: normalise(t.text), updatedAt: t.reviewedAt || t.capturedAt })),
  };
}

function pickLatest(entries: CatalogEntry[]): CatalogEntry {
  return entries.reduce((best, e) => (e.updatedAt > best.updatedAt ? e : best));
}

function matchIn(entries: CatalogEntry[], type: LinkableType, target: string): { entry: CatalogEntry; ambiguous: boolean } | null {
  const key = normalise(target);
  const exact = entries.filter(e => e.key === key);
  if (exact.length) return { entry: pickLatest(exact), ambiguous: exact.length > 1 };
  if (type === 'thought' && key.length >= THOUGHT_PREFIX_MIN) {
    const byPrefix = entries.filter(e => e.key.startsWith(key));
    if (byPrefix.length === 1) return { entry: byPrefix[0], ambiguous: false };
  }
  return null;
}

export function resolveMention(mention: Mention, catalog: Catalog): ResolvedMention {
  const types: LinkableType[] = mention.type ? [mention.type] : [...LINKABLE_TYPES];
  for (const type of types) {
    const hit = matchIn(catalog[type], type, mention.target);
    if (hit) {
      return { ...mention, resolved: hit.entry.ref, resolvedLabel: hit.entry.label, ambiguous: hit.ambiguous || undefined };
    }
  }
  return { ...mention, resolved: null };
}

/** Parses and resolves `text` in one go (used by the editor preview). */
export function resolveText(text: string, catalog: Catalog): ResolvedMention[] {
  return parseMentions(text).map(m => resolveMention(m, catalog));
}

// ── Index over the whole store ──

/** Every piece of text that can carry mentions. */
export function textDocuments(data: DatabaseSchema): TextDocument[] {
  const docs: TextDocument[] = [];
  for (const n of data.notes) docs.push({ ref: { type: 'note', id: n.id }, text: n.content || '' });
  for (const t of data.tasks) docs.push({ ref: { type: 'task', id: t.id }, text: t.description || '' });
  for (const th of data.thoughts) if (isVisibleThought(th)) docs.push({ ref: { type: 'thought', id: th.id }, text: th.text || '' });
  return docs;
}

export function buildMentionIndex(data: DatabaseSchema): MentionIndex {
  const catalog = buildCatalog(data);
  const edges = new Map<string, MentionEdge>();
  const unresolved = new Map<string, Mention[]>();
  for (const doc of textDocuments(data)) {
    if (!doc.text.includes('[[')) continue;
    for (const mention of resolveText(doc.text, catalog)) {
      if (!mention.resolved) {
        const list = unresolved.get(refKey(doc.ref)) || [];
        list.push(mention);
        unresolved.set(refKey(doc.ref), list);
        continue;
      }
      if (refEquals(mention.resolved, doc.ref)) continue; // a document mentioning itself is not a link
      const key = `${refKey(doc.ref)}->${refKey(mention.resolved)}`;
      const existing = edges.get(key);
      if (existing) {
        existing.count++;
        existing.ambiguous = existing.ambiguous || Boolean(mention.ambiguous);
      } else {
        edges.set(key, { kind: 'mention', from: doc.ref, to: mention.resolved, count: 1, ambiguous: Boolean(mention.ambiguous) });
      }
    }
  }
  return { edges: [...edges.values()], unresolved };
}

// Per-database cache keyed by the store revision: rebuilt only after a write.
const indexCache = new WeakMap<Database, { revision: number; index: MentionIndex }>();

export function mentionIndexFor(db: Database): MentionIndex {
  const cached = indexCache.get(db);
  if (cached && cached.revision === db.revision) return cached.index;
  const index = buildMentionIndex(db.snapshot());
  indexCache.set(db, { revision: db.revision, index });
  return index;
}

// ── Rename ──

export interface RewriteChange {
  ref: EntityRef;
  text: string;
  count: number;
}

/**
 * Rewrites the mentions in `text` that resolve to `target` so they point at
 * `newTitle`. Type prefixes and display labels are preserved. `catalog` must be
 * the catalog *before* the rename.
 */
export function rewriteMentions(text: string, target: EntityRef, newTitle: string, catalog: Catalog): { text: string; count: number } {
  const mentions = resolveText(text, catalog).filter(m => m.resolved && refEquals(m.resolved, target));
  if (!mentions.length) return { text, count: 0 };
  let out = '';
  let cursor = 0;
  for (const m of mentions) {
    out += text.slice(cursor, m.offset);
    const prefix = m.type ? `${m.type}:` : '';
    const suffix = m.label !== m.target ? `|${m.label}` : '';
    out += `[[${prefix}${newTitle}${suffix}]]`;
    cursor = m.offset + m.raw.length;
  }
  out += text.slice(cursor);
  return { text: out, count: mentions.length };
}

/** Computes the documents that need rewriting after `target` is renamed. Pure: nothing is applied. */
export function planRename(data: DatabaseSchema, target: EntityRef, newTitle: string): RewriteChange[] {
  const catalog = buildCatalog(data);
  const changes: RewriteChange[] = [];
  for (const doc of textDocuments(data)) {
    if (!doc.text.includes('[[')) continue;
    const { text, count } = rewriteMentions(doc.text, target, newTitle, catalog);
    if (count) changes.push({ ref: doc.ref, text, count });
  }
  return changes;
}

/**
 * Applies a rename plan to the store. Returns the number of mentions rewritten.
 * Called by the PUT handlers *before* the title change itself is stored, so the
 * pre-rename catalog still resolves the old title.
 */
export function applyRename(db: Database, target: EntityRef, newTitle: string): number {
  const oldTitle = db.labelOf(target);
  if (oldTitle === undefined || normalise(oldTitle) === normalise(newTitle)) return 0;
  let total = 0;
  for (const change of planRename(db.snapshot(), target, newTitle)) {
    switch (change.ref.type) {
      case 'note': db.updateNote(change.ref.id, { content: change.text }); break;
      case 'task': db.updateTask(change.ref.id, { description: change.text }); break;
      case 'thought': db.updateThought(change.ref.id, { text: change.text }); break;
    }
    total += change.count;
  }
  return total;
}

// ── Search (autocomplete & picker) ──

export interface SearchHit {
  ref: EntityRef;
  label: string;
  /** What the autocomplete inserts. */
  insert: string;
  meta: Record<string, unknown>;
}

const INSERT_MAX = 80;
const INSERT_PREFIX = 60;

/** A thought is referenced by its text; long ones by a unique word-boundary prefix. */
function thoughtInsertTarget(text: string, all: CatalogEntry[]): string {
  if (text.length <= INSERT_MAX) return text;
  let cut = text.lastIndexOf(' ', INSERT_PREFIX);
  if (cut < THOUGHT_PREFIX_MIN) cut = INSERT_PREFIX;
  const prefix = text.slice(0, cut).trim();
  const key = normalise(prefix);
  const matches = all.filter(e => e.key.startsWith(key)).length;
  return matches === 1 ? prefix : text;
}

export function searchLinkables(data: DatabaseSchema, query: string, types: LinkableType[] = [...LINKABLE_TYPES], limit = 8): SearchHit[] {
  const catalog = buildCatalog(data);
  const q = normalise(query);
  const notes = new Map(data.notes.map(n => [n.id, n]));
  const tasks = new Map(data.tasks.map(t => [t.id, t]));
  const thoughts = new Map(data.thoughts.map(t => [t.id, t]));

  const scored: { hit: SearchHit; score: number; updatedAt: string }[] = [];
  for (const type of types) {
    for (const entry of catalog[type]) {
      let score: number;
      if (!q) score = 0;
      else if (entry.key === q) score = 3;
      else if (entry.key.startsWith(q)) score = 2;
      else if (entry.key.includes(q)) score = 1;
      else continue;
      let meta: Record<string, unknown> = {};
      if (type === 'task') {
        const t = tasks.get(entry.ref.id) as Task;
        meta = { status: t.status, priority: t.priority, projectId: t.projectId || null };
      } else if (type === 'note') {
        const n = notes.get(entry.ref.id) as Note;
        meta = { pinned: n.pinned };
      } else {
        const th = thoughts.get(entry.ref.id) as Thought;
        meta = { status: th.status };
      }
      const target = type === 'thought' ? thoughtInsertTarget(entry.label, catalog.thought) : entry.label;
      scored.push({ hit: { ref: entry.ref, label: entry.label, insert: mentionSyntax(type, target), meta }, score, updatedAt: entry.updatedAt });
    }
  }
  scored.sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt));
  return scored.slice(0, limit).map(s => s.hit);
}

export function isLinkableType(v: unknown): v is LinkableType {
  return typeof v === 'string' && (LINKABLE_TYPES as readonly string[]).includes(v);
}

/** Validates a `{type, id}` object from a request body or a `type:id` query string. */
export function parseRef(raw: unknown): EntityRef | null {
  if (typeof raw === 'string') {
    const idx = raw.indexOf(':');
    if (idx === -1) return null;
    return parseRef({ type: raw.slice(0, idx), id: raw.slice(idx + 1) });
  }
  if (!raw || typeof raw !== 'object') return null;
  const { type, id } = raw as { type?: unknown; id?: unknown };
  if (!isLinkableType(type) || typeof id !== 'string' || !id.trim()) return null;
  return { type, id: id.trim() };
}
