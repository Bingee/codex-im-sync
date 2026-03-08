import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, it, mock } from 'node:test';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import { sseEvent } from '../sse-utils.js';

describe('sseEvent', () => {
  it('formats a string data payload', () => {
    const result = sseEvent('text', 'hello');
    assert.equal(result, 'data: {"type":"text","data":"hello"}\n');
  });

  it('stringifies object data payload', () => {
    const result = sseEvent('result', { usage: { input_tokens: 10 } });
    const parsed = JSON.parse(result.slice(6));
    assert.equal(parsed.type, 'result');
    const inner = JSON.parse(parsed.data);
    assert.equal(inner.usage.input_tokens, 10);
  });

  it('handles newlines in data', () => {
    const result = sseEvent('text', 'line1\nline2');
    const parsed = JSON.parse(result.slice(6));
    assert.equal(parsed.data, 'line1\nline2');
  });
});

async function collectStream(stream: ReadableStream<string>): Promise<string[]> {
  const reader = stream.getReader();
  const chunks: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

function parseSSEChunks(chunks: string[]): Array<{ type: string; data: string }> {
  return chunks
    .flatMap(chunk => chunk.split('\n'))
    .filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice(6)));
}

type MockProc = ChildProcessWithoutNullStreams & {
  emit: (event: string, ...args: unknown[]) => void;
  pushStdout: (text: string) => void;
  pushStderr: (text: string) => void;
  finish: (code?: number) => void;
};

function createMockProcess(): MockProc {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  const proc = {
    stdout,
    stderr,
    kill: mock.fn(),
    on(event: string, handler: (...args: unknown[]) => void) {
      const existing = listeners.get(event) || [];
      existing.push(handler);
      listeners.set(event, existing);
      return this;
    },
    emit(event: string, ...args: unknown[]) {
      for (const handler of listeners.get(event) || []) {
        handler(...args);
      }
    },
    pushStdout(text: string) {
      stdout.write(text);
    },
    pushStderr(text: string) {
      stderr.write(text);
    },
    finish(code = 0) {
      stdout.end();
      stderr.end();
      proc.emit('close', code);
    },
  } as unknown as MockProc;

  return proc;
}

describe('CodexProvider', () => {
  it('streams local codex session output and emits status/result events', async () => {
    const mockProc = createMockProcess();

    const { CodexProvider } = await import('../codex-provider.js');
    const { PendingPermissions } = await import('../permission-gateway.js');
    const provider = new CodexProvider(new PendingPermissions(), {
      codexPath: '/usr/bin/codex',
      spawnImpl: (() => mockProc) as unknown as typeof import('node:child_process').spawn,
    });

    const stream = provider.streamChat({
      prompt: 'summarize repo',
      sessionId: 'bridge-session-1',
      workingDirectory: process.cwd(),
    });

    mockProc.pushStdout('{"type":"thread.started","thread_id":"codex-thread-1"}\n');
    mockProc.pushStdout('{"type":"item.delta","delta":"Hello"}\n');
    mockProc.pushStdout('{"type":"item.delta","delta":"Hello world"}\n');
    mockProc.pushStdout('{"type":"turn.completed"}\n');
    mockProc.finish(0);

    const chunks = await collectStream(stream);
    const events = parseSSEChunks(chunks);

    assert.equal(events[0].type, 'status');
    assert.equal(JSON.parse(events[0].data).session_id, 'codex-thread-1');
    assert.equal(events[1].type, 'text');
    assert.equal(events[1].data, 'Hello');
    assert.equal(events[2].type, 'text');
    assert.equal(events[2].data, ' world');
    assert.equal(events.at(-1)?.type, 'result');
    assert.equal(JSON.parse(events.at(-1)?.data || '{}').session_id, 'codex-thread-1');
  });

  it('uses resume when sdkSessionId is already bound', async () => {
    const mockProc = createMockProcess();
    const spawnMock = mock.fn((_cmd: string, _args: readonly string[]) => mockProc);

    const { CodexProvider } = await import('../codex-provider.js');
    const { PendingPermissions } = await import('../permission-gateway.js');
    const provider = new CodexProvider(new PendingPermissions(), {
      codexPath: '/usr/bin/codex',
      approvalPolicy: 'never',
      spawnImpl: spawnMock as unknown as typeof import('node:child_process').spawn,
    });

    const stream = provider.streamChat({
      prompt: 'continue',
      sessionId: 'bridge-session-2',
      sdkSessionId: 'codex-thread-existing',
      workingDirectory: process.cwd(),
    });

    mockProc.pushStdout('{"type":"thread.completed"}\n');
    mockProc.finish(0);
    await collectStream(stream);

    const [cmd, args] = spawnMock.mock.calls[0].arguments as unknown as [string, string[]];
    assert.ok(cmd.endsWith('codex'));
    assert.deepEqual(args.slice(0, 6), [
      'exec',
      'resume',
      '-c',
      'approval_policy="never"',
      '--json',
      '--skip-git-repo-check',
    ]);
    assert.equal(args[6], 'codex-thread-existing');
    assert.equal(args[7], 'continue');
  });

  it('emits stderr as error when codex exits non-zero', async () => {
    const mockProc = createMockProcess();

    const { CodexProvider } = await import('../codex-provider.js');
    const { PendingPermissions } = await import('../permission-gateway.js');
    const provider = new CodexProvider(new PendingPermissions(), {
      codexPath: '/usr/bin/codex',
      spawnImpl: (() => mockProc) as unknown as typeof import('node:child_process').spawn,
    });

    const stream = provider.streamChat({
      prompt: 'run task',
      sessionId: 'bridge-session-3',
      workingDirectory: process.cwd(),
    });

    mockProc.pushStderr('approval required');
    mockProc.finish(1);

    const chunks = await collectStream(stream);
    const events = parseSSEChunks(chunks);

    const errorEvent = events.find(event => event.type === 'error');
    assert.ok(errorEvent);
    assert.equal(errorEvent?.data, 'approval required');
    assert.equal(JSON.parse(events.at(-1)?.data || '{}').is_error, true);
  });

  it('maps command_execution item to tool_use + tool_result', async () => {
    const { CodexProvider } = await import('../codex-provider.js');
    const { PendingPermissions } = await import('../permission-gateway.js');
    const provider = new CodexProvider(new PendingPermissions(), {
      codexPath: '/usr/bin/codex',
    });

    const chunks: string[] = [];
    const mockController = {
      enqueue: (chunk: string) => chunks.push(chunk),
    } as unknown as ReadableStreamDefaultController<string>;

    (provider as any).handleCompletedItem(mockController, {
      type: 'command_execution',
      id: 'cmd-1',
      command: 'ls -la',
      aggregated_output: 'file1.txt\nfile2.txt',
      exit_code: 0,
      status: 'completed',
    });

    const events = parseSSEChunks(chunks);
    assert.equal(events.length, 2);

    const toolUse = JSON.parse(events[0].data);
    assert.equal(toolUse.name, 'Bash');
    assert.equal(toolUse.input.command, 'ls -la');

    const toolResult = JSON.parse(events[1].data);
    assert.equal(toolResult.tool_use_id, 'cmd-1');
    assert.equal(toolResult.is_error, false);
  });
});
