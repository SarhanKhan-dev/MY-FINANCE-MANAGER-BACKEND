import { Logger } from '@nestjs/common';

/** One neutral shape for every brain. GLM, OpenAI, Grok and Gemini all speak
 *  the OpenAI chat-completions dialect; Anthropic gets a small translator. */

export interface AiToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AiToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: AiToolCall[];
  toolCallId?: string;
}

export interface AiResult {
  content: string;
  toolCalls: AiToolCall[];
}

export type AiProviderName = 'glm' | 'openai' | 'gemini' | 'grok' | 'anthropic';

interface ProviderConfig {
  baseUrl: string;
  keyEnv: string;
  baseUrlEnv?: string;
}

const OPENAI_COMPATIBLE: Record<Exclude<AiProviderName, 'anthropic'>, ProviderConfig> = {
  glm: { baseUrl: 'https://api.z.ai/api/paas/v4', keyEnv: 'GLM_API_KEY', baseUrlEnv: 'GLM_BASE_URL' },
  openai: { baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY' },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
  },
  grok: { baseUrl: 'https://api.x.ai/v1', keyEnv: 'XAI_API_KEY' },
};

const logger = new Logger('AiProviders');

export function providerKeySet(provider: AiProviderName): boolean {
  if (provider === 'anthropic') return Boolean(process.env.ANTHROPIC_API_KEY);
  return Boolean(process.env[OPENAI_COMPATIBLE[provider].keyEnv]);
}

export async function callChat(
  provider: AiProviderName,
  model: string,
  messages: AiChatMessage[],
  tools: AiToolDef[],
): Promise<AiResult> {
  if (provider === 'anthropic') return callAnthropic(model, messages, tools);
  return callOpenAiCompatible(provider, model, messages, tools);
}

async function callOpenAiCompatible(
  provider: Exclude<AiProviderName, 'anthropic'>,
  model: string,
  messages: AiChatMessage[],
  tools: AiToolDef[],
): Promise<AiResult> {
  const config = OPENAI_COMPATIBLE[provider];
  const baseUrl =
    (config.baseUrlEnv && process.env[config.baseUrlEnv]) || config.baseUrl;
  const key = process.env[config.keyEnv];
  if (!key) throw new Error(`${provider} key missing`);

  const body: Record<string, unknown> = {
    model,
    messages: messages.map((message) => {
      if (message.role === 'tool') {
        return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
      }
      if (message.role === 'assistant' && message.toolCalls?.length) {
        return {
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })),
        };
      }
      return { role: message.role, content: message.content };
    }),
    temperature: 0.4,
  };
  if (tools.length > 0) {
    body.tools = tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    logger.warn(`${provider} refused (${response.status}): ${text.slice(0, 300)}`);
    throw new Error(`${provider} error ${response.status}`);
  }
  const data = (await response.json()) as {
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: { id: string; function: { name: string; arguments: string } }[];
      };
    }[];
  };
  const message = data.choices?.[0]?.message;
  const toolCalls: AiToolCall[] = (message?.tool_calls ?? []).map((call) => ({
    id: call.id,
    name: call.function.name,
    arguments: safeParse(call.function.arguments),
  }));
  return { content: message?.content ?? '', toolCalls };
}

async function callAnthropic(
  model: string,
  messages: AiChatMessage[],
  tools: AiToolDef[],
): Promise<AiResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('anthropic key missing');

  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const converted = messages
    .filter((m) => m.role !== 'system')
    .map((message) => {
      if (message.role === 'tool') {
        return {
          role: 'user' as const,
          content: [
            { type: 'tool_result', tool_use_id: message.toolCallId, content: message.content },
          ],
        };
      }
      if (message.role === 'assistant' && message.toolCalls?.length) {
        const blocks: unknown[] = [];
        if (message.content) blocks.push({ type: 'text', text: message.content });
        for (const call of message.toolCalls) {
          blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
        }
        return { role: 'assistant' as const, content: blocks };
      }
      return { role: message.role as 'user' | 'assistant', content: message.content };
    });

  const body: Record<string, unknown> = {
    model,
    max_tokens: 2048,
    system,
    messages: converted,
  };
  if (tools.length > 0) {
    body.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    logger.warn(`anthropic refused (${response.status}): ${text.slice(0, 300)}`);
    throw new Error(`anthropic error ${response.status}`);
  }
  const data = (await response.json()) as {
    content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
  };
  let content = '';
  const toolCalls: AiToolCall[] = [];
  for (const block of data.content ?? []) {
    if (block.type === 'text') content += block.text ?? '';
    if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id ?? `call_${toolCalls.length}`,
        name: block.name ?? '',
        arguments: (block.input as Record<string, unknown>) ?? {},
      });
    }
  }
  return { content, toolCalls };
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
