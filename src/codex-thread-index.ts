import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface CodexThreadSummary {
  sdkSessionId: string;
  cwd: string;
  projectName: string;
  title: string;
  updatedAt: string;
  createdAt?: string;
  originator?: string;
  source?: string;
  filePath: string;
}

const SESSIONS_ROOT = path.join(os.homedir(), '.codex', 'sessions');
const CACHE_TTL_MS = 30_000;

let cachedAt = 0;
let cachedThreads: CodexThreadSummary[] = [];

function walkJsonlFiles(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkJsonlFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      out.push(fullPath);
    }
  }
  return out;
}

function deriveSessionId(filePath: string): string {
  const name = path.basename(filePath);
  const match = name.match(/-([0-9a-f]{8,}-[0-9a-f-]+)\.jsonl$/i);
  if (match?.[1]) return match[1];
  return name.replace(/\.jsonl$/i, '');
}

function shortenText(input: string, maxLength = 80): string {
  const clean = input.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 3)}...`;
}

function normalize(input: string): string {
  return input.trim().toLowerCase();
}

function isUsefulTitle(input: string): boolean {
  const clean = input.replace(/\s+/g, ' ').trim();
  if (!clean) return false;
  if (clean.startsWith('# AGENTS.md instructions')) return false;
  if (clean.startsWith('## Skills')) return false;
  return true;
}

function parseFirstUserMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;

  if (typeof record.message === 'string' && record.type === 'user_message') {
    return record.message;
  }

  if (record.type === 'message' && record.role === 'user' && Array.isArray(record.content)) {
    for (const block of record.content) {
      if (!block || typeof block !== 'object') continue;
      const contentBlock = block as Record<string, unknown>;
      if (contentBlock.type === 'input_text' && typeof contentBlock.text === 'string') {
        return contentBlock.text;
      }
    }
  }

  return '';
}

function parseThreadFile(filePath: string): CodexThreadSummary | null {
  const stat = fs.statSync(filePath);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');

  let sdkSessionId = deriveSessionId(filePath);
  let cwd = '';
  let projectName = '';
  let title = '';
  let createdAt: string | undefined;
  let originator: string | undefined;
  let source: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (parsed.type === 'session_meta' && parsed.payload && typeof parsed.payload === 'object') {
      const meta = parsed.payload as Record<string, unknown>;
      if (typeof meta.id === 'string' && meta.id.trim()) {
        sdkSessionId = meta.id.trim();
      }
      if (typeof meta.cwd === 'string' && meta.cwd.trim()) {
        cwd = meta.cwd.trim();
        projectName = path.basename(cwd) || cwd;
      }
      if (typeof meta.timestamp === 'string') {
        createdAt = meta.timestamp;
      }
      if (typeof meta.originator === 'string') {
        originator = meta.originator;
      }
      if (typeof meta.source === 'string') {
        source = meta.source;
      }
      continue;
    }

    if (!title && parsed.type === 'event_msg' && parsed.payload) {
      const candidate = parseFirstUserMessage(parsed.payload);
      if (isUsefulTitle(candidate)) {
        title = candidate;
        continue;
      }
    }

    if (!title && parsed.type === 'response_item' && parsed.payload && typeof parsed.payload === 'object') {
      const candidate = parseFirstUserMessage(parsed.payload);
      if (isUsefulTitle(candidate)) {
        title = candidate;
      }
    }
  }

  if (!cwd) return null;

  const fallbackTitle = projectName || path.basename(cwd) || 'Untitled thread';
  return {
    sdkSessionId,
    cwd,
    projectName: projectName || path.basename(cwd) || cwd,
    title: shortenText(title || fallbackTitle),
    updatedAt: stat.mtime.toISOString(),
    createdAt,
    originator,
    source,
    filePath,
  };
}

function refreshThreads(): CodexThreadSummary[] {
  const files = walkJsonlFiles(SESSIONS_ROOT);
  const threads = files
    .map((filePath) => {
      try {
        return parseThreadFile(filePath);
      } catch {
        return null;
      }
    })
    .filter((thread): thread is CodexThreadSummary => thread !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  cachedThreads = threads;
  cachedAt = Date.now();
  return threads;
}

export function listCodexThreads(opts?: { forceRefresh?: boolean; limit?: number }): CodexThreadSummary[] {
  const forceRefresh = opts?.forceRefresh === true;
  const limit = opts?.limit ?? 20;
  const expired = Date.now() - cachedAt > CACHE_TTL_MS;

  const threads = forceRefresh || expired || cachedThreads.length === 0
    ? refreshThreads()
    : cachedThreads;

  return threads.slice(0, limit);
}

export function findCodexThread(query: string, opts?: { forceRefresh?: boolean }): CodexThreadSummary | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const threads = listCodexThreads({ forceRefresh: opts?.forceRefresh, limit: 500 });
  const numeric = Number.parseInt(trimmed, 10);
  if (/^\d+$/.test(trimmed) && numeric >= 1 && numeric <= threads.length) {
    return threads[numeric - 1] || null;
  }

  const exact = threads.find((thread) => thread.sdkSessionId === trimmed);
  if (exact) return exact;

  const prefixMatches = threads.filter((thread) => thread.sdkSessionId.startsWith(trimmed));
  if (prefixMatches.length === 1) return prefixMatches[0];

  const normalized = normalize(trimmed);
  const exactTextMatches = threads.filter((thread) => {
    const projectName = normalize(thread.projectName);
    const title = normalize(thread.title);
    const cwd = normalize(thread.cwd);
    const baseName = normalize(path.basename(thread.cwd));
    return (
      projectName === normalized ||
      title === normalized ||
      cwd === normalized ||
      baseName === normalized
    );
  });
  if (exactTextMatches.length === 1) return exactTextMatches[0];

  const fuzzyMatches = threads.filter((thread) => {
    const projectName = normalize(thread.projectName);
    const title = normalize(thread.title);
    const cwd = normalize(thread.cwd);
    const baseName = normalize(path.basename(thread.cwd));
    return (
      projectName.includes(normalized) ||
      title.includes(normalized) ||
      cwd.includes(normalized) ||
      baseName.includes(normalized)
    );
  });
  if (fuzzyMatches.length === 1) return fuzzyMatches[0];

  return null;
}
