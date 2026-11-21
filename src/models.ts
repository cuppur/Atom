import { streamText, jsonSchema, APICallError, type ModelMessage, type ToolSet, type LanguageModelUsage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { Profile, TurnUsage, Usage } from './types';
import type { Tool } from './tool-registry';

export type Turn = { messages: ModelMessage[]; calls: { toolCallId: string; toolName: string; input: unknown }[];
  text: string; usage: LanguageModelUsage; finish: string };
export type StreamModel = (options: {
  profile: Profile; key: string; system: string; messages: ModelMessage[];
  tools: Map<string, Tool>; signal: AbortSignal; onText: (text: string) => void;
  output?: number; beforeRequest?: () => void; onOutputBytes?:(bytes:number)=>void;
}) => Promise<Turn>;
export const streamModel: StreamModel = async args => {
  const { profile: p, key } = args;
  const fetcher: typeof fetch = async (input, init) => {
    args.beforeRequest?.();
    return fetch(input,{...init, redirect:'error'});
  };
  const setup = { baseURL:p.url, apiKey:key, fetch:fetcher };
  const effort = p.effort === 'off' ? undefined : p.effort;
  const model = p.provider === 'openai' ? createOpenAI(setup).responses(p.model)
    : p.provider === 'anthropic' ? createAnthropic(setup)(p.model)
    : p.provider === 'gemini' ? createGoogleGenerativeAI(setup)(p.model)
    : createOpenAICompatible({
      ...setup, name:p.provider, includeUsage:true,
      transformRequestBody: body => p.provider === 'deepseek'
        ? {...body, thinking:{type:effort ? 'enabled' : 'disabled'},
          ...(effort ? {reasoning_effort:{low:'low',medium:'high',high:'max'}[effort]} : {})}
        : effort ? {...body,reasoning_effort:effort} : body,
    }).chatModel(p.model);
  const tools = Object.fromEntries([...args.tools].map(([name,def]) =>
    [name,{description:def.description,inputSchema:jsonSchema(def.schema)}])) as ToolSet;
  const result = streamText({
    model, system:args.system, messages:args.messages, tools, maxOutputTokens:args.output ?? p.output,
    maxRetries:2, abortSignal:args.signal, timeout:{totalMs:p.timeout*1000,chunkMs:p.timeout*1000},
    ...(effort && {providerOptions:{
      ...(p.provider === 'openai' && {openai:{reasoningEffort:effort}}),
      ...(p.provider === 'anthropic' && {anthropic:{thinking:{type:'adaptive'},effort}}),
      ...(p.provider === 'gemini' && {google:{thinkingConfig:/^gemini-2\.5/.test(p.model)
        ? {thinkingBudget:{low:1024,medium:4096,high:8192}[effort]} : {thinkingLevel:effort}}}),
    }}),
  });
  const pending = Promise.all([result.response,result.toolCalls,result.usage,result.finishReason]);
  void pending.catch(() => {});
  let text = '';
  try {
    for await (const part of result.fullStream) {
      if(part.type==='text-delta'||part.type==='reasoning-delta') args.onOutputBytes?.(Buffer.byteLength(part.text));
      if(part.type==='tool-input-delta') args.onOutputBytes?.(Buffer.byteLength(part.delta));
      if (part.type === 'text-delta') { text += part.text; args.onText(text); }
      if (part.type === 'error') throw part.error;
    }
    args.signal.throwIfAborted();
    const [response,calls,usage,finish] = await pending;
    if (finish === 'error' || finish === 'content-filter' || finish === 'interrupted') throw new Error('供应商未完成响应');
    return {messages:response.messages,calls,text,usage,finish};
  } catch (error) {
    args.signal.throwIfAborted();
    if (APICallError.isInstance(error)) throw new Error(`模型 API 请求失败（HTTP ${error.statusCode ?? '未知'}）`);
    throw error;
  }
};

export function reportedUsage(u:LanguageModelUsage):TurnUsage {
  const raw = u.raw as {prompt_cache_hit_tokens?:number;prompt_cache_miss_tokens?:number} | undefined;
  return {
    input:u.inputTokens??null,output:u.outputTokens??null,
    cache:raw?.prompt_cache_hit_tokens??u.inputTokenDetails.cacheReadTokens??null,
    cacheWrite:u.inputTokenDetails.cacheWriteTokens??null,
  };
}
export function tally(previous: Usage, u: LanguageModelUsage, p: Profile) {
  const raw=u.raw as {prompt_cache_miss_tokens?:number}|undefined;
  const {input,output,cache,cacheWrite:write}=reportedUsage(u);
  const normal = raw?.prompt_cache_miss_tokens ?? u.inputTokenDetails.noCacheTokens ??
    (input == null ? undefined : Math.max(0,input-(cache ?? 0)-(write ?? 0)));
  const prices = [p.inputPrice,p.outputPrice,p.cachePrice,p.cacheWritePrice];
  const parts = [normal,output,cache,write];
  const known = input != null && output != null && parts.every((amount,i) => !amount || prices[i] != null);
  const cost = known ? parts.reduce<number>((sum,amount,i) => sum+(amount ?? 0)*(prices[i] ?? 0),0)/1e6 : null;
  const add = (total:number|null, amount:number|null) => amount == null ? total : (total ?? 0)+amount;
  const missing = [...new Set([...previous.missing,
    ...Object.entries({input,output,cache,cacheWrite:write,dollars:cost}).filter(([,x]) => x == null).map(([key]) => key)])];
  return {cost, usage:{
    input:add(previous.input,input), output:add(previous.output,output),cache:add(previous.cache,cache),
    cacheWrite:add(previous.cacheWrite,write), dollars:add(previous.dollars,cost),
    steps:previous.steps+1,missing,
  }};
}

