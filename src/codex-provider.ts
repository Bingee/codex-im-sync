import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';

import type { LLMProvider, StreamChatParams } from 'claude-to-im/src/lib/bridge/host.js';
import type { PendingPermissions } from './permission-gateway.js';
import { buildSubprocessEnv } from './llm-provider.js';
import { sseEvent } from './sse-utils.js';

const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

export interface CodexCliOptions {
  codexPath?: string;
  sandboxMode?: string;
  approvalPolicy?: string;
  fullAuto?: boolean;
  dangerouslyBypass?: boolean;
  spawnImpl?: typeof spawn;
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveCodexCliPath(explicitPath?: string): string | undefined {
  if (explicitPath && isExecutable(explicitPath)) {
    return explicitPath;
  }

  const fromEnv = process.env.CTI_CODEX_EXECUTABLE || process.env.CTI_CODEX_BIN;
  if (fromEnv && isExecutable(fromEnv)) {
    return fromEnv;
  }

  const isWindows = process.platform === 'win32';
  const cmd = isWindows ? 'where codex' : 'which codex';
  try {
    const resolved = execSync(cmd, { encoding: 'utf-8', timeout: 3000 }).trim().split('\n')[0];
    if (resolved && isExecutable(resolved)) {
      return resolved;
    }
  } catch {
    // Ignore PATH lookup failures.
  }

  const candidates = isWindows
    ? [
        process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Programs\\codex\\codex.exe` : '',
        'C:\\Program Files\\codex\\codex.exe',
      ].filter(Boolean)
    : [
        '/usr/local/bin/codex',
        '/opt/homebrew/bin/codex',
        `${process.env.HOME}/.npm-global/bin/codex`,
        `${process.env.HOME}/.local/bin/codex`,
      ];

  for (const candidate of candidates) {
    if (candidate && isExecutable(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function toTomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function extractTextFragment(node: unknown): string {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map(extractTextFragment).join('');
  }
  if (typeof node === 'object') {
    for (const key of ['text', 'delta', 'text_delta', 'content', 'message', 'output_text']) {
      if (key in node) {
        const value = extractTextFragment((node as Record<string, unknown>)[key]);
        if (value) {
          return value;
        }
      }
    }
    return Object.values(node as Record<string, unknown>).map(extractTextFragment).join('');
  }
  return '';
}

function composeAgentText(messages: string[], currentAgentText: string): string {
  const parts = messages
    .map(message => message.trim())
    .filter(Boolean);

  if (currentAgentText.trim()) {
    parts.push(currentAgentText.trim());
  }

  return parts.join('\n\n').trim();
}

function consumeExecEvent(
  evt: Record<string, unknown>,
  messages: string[],
  currentAgentText: string,
): { threadId?: string; messages: string[]; currentAgentText: string; changed: boolean } {
  let threadId: string | undefined;
  let changed = false;

  const eventType = String(evt.type || '').trim().toLowerCase();
  if (eventType === 'thread.started') {
    threadId = String(evt.thread_id || '').trim() || undefined;
    if (!threadId && typeof evt.thread === 'object' && evt.thread) {
      threadId = String((evt.thread as Record<string, unknown>).id || '').trim() || undefined;
    }
  }

  const item = typeof evt.item === 'object' && evt.item ? evt.item as Record<string, unknown> : {};
  const itemType = String(item.type || '').trim().toLowerCase();
  const isAgentItem = itemType === 'agent_message' || itemType === 'assistant_message';

  if (['item.delta', 'response.output_text.delta', 'assistant_message.delta', 'message.delta'].includes(eventType)) {
    const delta = (
      extractTextFragment(evt.delta)
      || extractTextFragment(evt.text_delta)
      || extractTextFragment(evt.text)
      || extractTextFragment(item.delta)
      || extractTextFragment(item.text_delta)
    );

    if (delta) {
      if (!currentAgentText) {
        currentAgentText = delta;
      } else if (delta.startsWith(currentAgentText)) {
        currentAgentText = delta;
      } else if (!currentAgentText.endsWith(delta)) {
        currentAgentText += delta;
      }
      changed = true;
    }
  }

  if ((eventType === 'item.updated' || eventType === 'item.completed') && isAgentItem) {
    const fullText = (
      extractTextFragment(item.text)
      || extractTextFragment(item.content)
      || extractTextFragment(item.message)
    ).trim();

    if (fullText) {
      currentAgentText = fullText;
      changed = true;
    }

    if (eventType === 'item.completed' && currentAgentText.trim()) {
      const finalized = currentAgentText.trim();
      if (!messages.length || messages[messages.length - 1] !== finalized) {
        messages.push(finalized);
        changed = true;
      }
      currentAgentText = '';
    }
  }

  if (['turn.completed', 'response.completed', 'thread.completed'].includes(eventType)) {
    const fallbackText = (
      extractTextFragment(evt.output_text)
      || extractTextFragment(evt.text)
    ).trim();

    if (fallbackText && (!messages.length || messages[messages.length - 1] !== fallbackText)) {
      messages.push(fallbackText);
      changed = true;
    }

    if (currentAgentText.trim()) {
      const finalized = currentAgentText.trim();
      if (!messages.length || messages[messages.length - 1] !== finalized) {
        messages.push(finalized);
        changed = true;
      }
      currentAgentText = '';
    }
  }

  return { threadId, messages, currentAgentText, changed };
}

function parseExecJson(stdout: string): { threadId?: string; text: string } {
  let threadId: string | undefined;
  let messages: string[] = [];
  let currentAgentText = '';

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('{')) {
      continue;
    }

    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      const consumed = consumeExecEvent(evt, messages, currentAgentText);
      if (consumed.threadId && !threadId) {
        threadId = consumed.threadId;
      }
      messages = consumed.messages;
      currentAgentText = consumed.currentAgentText;
    } catch {
      // Ignore malformed JSONL rows.
    }
  }

  return { threadId, text: composeAgentText(messages, currentAgentText) };
}

export class CodexProvider implements LLMProvider {
  private codexPath: string;
  private sandboxMode?: string;
  private approvalPolicy?: string;
  private fullAuto: boolean;
  private dangerouslyBypass: boolean;
  private spawnImpl: typeof spawn;

  constructor(_pendingPerms: PendingPermissions, options: CodexCliOptions = {}) {
    const codexPath = resolveCodexCliPath(options.codexPath);
    if (!codexPath) {
      throw new Error(
        'Cannot find the `codex` CLI executable. Set CTI_CODEX_EXECUTABLE=/path/to/codex or install Codex CLI.',
      );
    }

    this.codexPath = codexPath;
    this.sandboxMode = options.sandboxMode;
    this.approvalPolicy = options.approvalPolicy;
    this.fullAuto = options.fullAuto ?? false;
    this.dangerouslyBypass = options.dangerouslyBypass ?? false;
    this.spawnImpl = options.spawnImpl ?? spawn;
  }

  streamChat(params: StreamChatParams): ReadableStream<string> {
    const codexPath = this.codexPath;
    const sandboxMode = this.sandboxMode;
    const approvalPolicy = this.approvalPolicy;
    const fullAuto = this.fullAuto;
    const dangerouslyBypass = this.dangerouslyBypass;
    const spawnImpl = this.spawnImpl;
    const provider = this;

    return new ReadableStream<string>({
      start(controller) {
        const tempFiles: string[] = [];
        let proc: ReturnType<typeof spawn> | undefined;

        const cleanup = () => {
          for (const tempFile of tempFiles) {
            try {
              fs.unlinkSync(tempFile);
            } catch {
              // Ignore cleanup failures.
            }
          }
        };

        const onAbort = () => {
          proc?.kill('SIGTERM');
        };

        params.abortController?.signal.addEventListener('abort', onAbort, { once: true });

        (async () => {
          try {
            const configFlags: string[] = [];
            if (sandboxMode) {
              configFlags.push('-c', `sandbox_mode=${toTomlString(sandboxMode)}`);
            }
            if (approvalPolicy) {
              configFlags.push('-c', `approval_policy=${toTomlString(approvalPolicy)}`);
            }

            const execFlags: string[] = ['--json', '--skip-git-repo-check'];
            if (fullAuto) {
              execFlags.push('--full-auto');
            }
            if (dangerouslyBypass) {
              execFlags.push('--dangerously-bypass-approvals-and-sandbox');
            }
            if (params.model) {
              execFlags.push('-m', params.model);
            }

            const imageFiles = params.files?.filter(file => file.type.startsWith('image/')) ?? [];
            for (const file of imageFiles) {
              const ext = MIME_EXT[file.type] || '.png';
              const tmpPath = path.join(
                os.tmpdir(),
                `cti-codex-img-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`,
              );
              fs.writeFileSync(tmpPath, Buffer.from(file.data, 'base64'));
              tempFiles.push(tmpPath);
              execFlags.push('-i', tmpPath);
            }

            const command = params.sdkSessionId
              ? [
                  codexPath,
                  'exec',
                  'resume',
                  ...configFlags,
                  ...execFlags,
                  params.sdkSessionId,
                  params.prompt,
                ]
              : [
                  codexPath,
                  'exec',
                  ...configFlags,
                  ...execFlags,
                  params.prompt,
                ];

            proc = spawnImpl(command[0], command.slice(1), {
              cwd: params.workingDirectory,
              env: buildSubprocessEnv(),
              stdio: ['ignore', 'pipe', 'pipe'],
            });

            if (!proc.stdout || !proc.stderr) {
              throw new Error('Failed to start codex subprocess stdio');
            }
            const stdout = proc.stdout;
            const stderr = proc.stderr;

            const stdoutLines: string[] = [];
            const stderrChunks: string[] = [];
            let threadId = params.sdkSessionId || '';
            let messages: string[] = [];
            let currentAgentText = '';
            let lastLiveText = '';
            let sawTerminalEvent = false;
            let emittedError = false;

            stdout.setEncoding('utf-8');
            stderr.setEncoding('utf-8');

            stdout.on('data', (chunk: string) => {
              for (const rawLine of chunk.split('\n')) {
                const trimmed = rawLine.trim();
                if (!trimmed) {
                  continue;
                }
                stdoutLines.push(trimmed);
                if (!trimmed.startsWith('{')) {
                  continue;
                }

                try {
                  const evt = JSON.parse(trimmed) as Record<string, unknown>;
                  const consumed = consumeExecEvent(evt, messages, currentAgentText);
                  messages = consumed.messages;
                  currentAgentText = consumed.currentAgentText;

                  if (consumed.threadId && !threadId) {
                    threadId = consumed.threadId;
                    controller.enqueue(sseEvent('status', { session_id: threadId, model: params.model }));
                  }

                  const eventType = String(evt.type || '').trim().toLowerCase();
                  if (['turn.completed', 'response.completed', 'thread.completed'].includes(eventType)) {
                    sawTerminalEvent = true;
                  }
                  if (eventType === 'turn.failed' || eventType === 'error') {
                    const message = String(evt.message || 'Codex execution failed');
                    controller.enqueue(sseEvent('error', message));
                    emittedError = true;
                  }

                  const item = typeof evt.item === 'object' && evt.item ? evt.item as Record<string, unknown> : null;
                  const itemType = String(item?.type || '').trim().toLowerCase();
                  if (eventType === 'item.completed' && item && itemType && itemType !== 'agent_message' && itemType !== 'assistant_message') {
                    provider.handleCompletedItem(controller, item);
                  }

                  if (consumed.changed) {
                    const liveText = composeAgentText(messages, currentAgentText);
                    if (liveText && liveText !== lastLiveText) {
                      const nextChunk = liveText.startsWith(lastLiveText)
                        ? liveText.slice(lastLiveText.length)
                        : liveText;
                      if (nextChunk) {
                        controller.enqueue(sseEvent('text', nextChunk));
                      }
                      lastLiveText = liveText;
                    }
                  }
                } catch {
                  // Ignore malformed JSONL rows.
                }
              }
            });

            stderr.on('data', (chunk: string) => {
              stderrChunks.push(chunk);
            });

            proc.on('error', (error: Error) => {
              controller.enqueue(sseEvent('error', error.message));
              emittedError = true;
            });

            proc.on('close', (code) => {
              params.abortController?.signal.removeEventListener('abort', onAbort);

              try {
                if (!lastLiveText) {
                  const parsed = parseExecJson(stdoutLines.join('\n'));
                  if (parsed.threadId && !threadId) {
                    threadId = parsed.threadId;
                    controller.enqueue(sseEvent('status', { session_id: threadId, model: params.model }));
                  }
                  if (parsed.text) {
                    controller.enqueue(sseEvent('text', parsed.text));
                    lastLiveText = parsed.text;
                  }
                }

                const stderrText = stderrChunks.join('').trim();
                if (code !== 0 && stderrText && !emittedError) {
                  controller.enqueue(sseEvent('error', stderrText));
                }

                controller.enqueue(sseEvent('result', {
                  session_id: threadId || params.sdkSessionId || undefined,
                  is_error: Boolean(code && code !== 0),
                  completed: sawTerminalEvent || code === 0,
                }));
              } finally {
                cleanup();
                controller.close();
              }
            });
          } catch (error) {
            params.abortController?.signal.removeEventListener('abort', onAbort);
            cleanup();
            controller.enqueue(sseEvent('error', error instanceof Error ? error.message : String(error)));
            controller.close();
          }
        })();
      },
    });
  }

  private handleCompletedItem(
    controller: ReadableStreamDefaultController<string>,
    item: Record<string, unknown>,
  ): void {
    const itemType = item.type as string;

    switch (itemType) {
      case 'agent_message': {
        const text = (item.text as string) || '';
        if (text) {
          controller.enqueue(sseEvent('text', text));
        }
        break;
      }

      case 'command_execution': {
        const toolId = (item.id as string) || `tool-${Date.now()}`;
        const command = item.command as string || '';
        const output = item.aggregated_output as string || '';
        const exitCode = item.exit_code as number | undefined;
        const isError = exitCode != null && exitCode !== 0;

        controller.enqueue(sseEvent('tool_use', {
          id: toolId,
          name: 'Bash',
          input: { command },
        }));

        const resultContent = output || (isError ? `Exit code: ${exitCode}` : 'Done');
        controller.enqueue(sseEvent('tool_result', {
          tool_use_id: toolId,
          content: resultContent,
          is_error: isError,
        }));
        break;
      }

      case 'file_change': {
        const toolId = (item.id as string) || `tool-${Date.now()}`;
        const changes = item.changes as Array<{ path: string; kind: string }> || [];
        const summary = changes.map(change => `${change.kind}: ${change.path}`).join('\n');

        controller.enqueue(sseEvent('tool_use', {
          id: toolId,
          name: 'Edit',
          input: { files: changes },
        }));

        controller.enqueue(sseEvent('tool_result', {
          tool_use_id: toolId,
          content: summary || 'File changes applied',
          is_error: false,
        }));
        break;
      }

      case 'mcp_tool_call': {
        const toolId = (item.id as string) || `tool-${Date.now()}`;
        const server = item.server as string || '';
        const tool = item.tool as string || '';
        const args = item.arguments as unknown;
        const result = item.result as { content?: unknown; structured_content?: unknown } | undefined;
        const error = item.error as { message?: string } | undefined;

        const resultContent = result?.content ?? result?.structured_content;
        const resultText = typeof resultContent === 'string'
          ? resultContent
          : (resultContent ? JSON.stringify(resultContent) : undefined);

        controller.enqueue(sseEvent('tool_use', {
          id: toolId,
          name: `mcp__${server}__${tool}`,
          input: args,
        }));

        controller.enqueue(sseEvent('tool_result', {
          tool_use_id: toolId,
          content: error?.message || resultText || 'Done',
          is_error: Boolean(error),
        }));
        break;
      }

      case 'reasoning': {
        const text = (item.text as string) || '';
        if (text) {
          controller.enqueue(sseEvent('status', { reasoning: text }));
        }
        break;
      }
    }
  }
}
