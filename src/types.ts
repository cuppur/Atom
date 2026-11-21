import type { ModelMessage } from 'ai';

export type Provider = 'openai' | 'anthropic' | 'gemini' | 'compatible' | 'deepseek';
export type Profile = {
  id: string; name: string; provider: Provider; url: string; model: string;
  effort: 'off' | 'low' | 'medium' | 'high'; timeout: number; context: number; output: number;
  inputPrice: number | null; outputPrice: number | null; cachePrice: number | null; cacheWritePrice: number | null;
  hasKey?: boolean;
};
export const contextPresets=[300000,600000,900000] as const;
export type ModelRuntime={model?:string;effort?:Profile['effort'];context?:typeof contextPresets[number]};
export type ComposerModel={profileId:string;runtime:ModelRuntime};
export type Attachment={id:string;name:string;image?:string};
export const persistenceLevels=['off','standard','high','extreme'] as const;
export type Persistence = typeof persistenceLevels[number];
export const persistenceLabels:Record<Persistence,string>={off:'关闭',standard:'标准',high:'高',extreme:'极高'};
export type Policy = 'allow' | 'ask' | 'deny';
export type Access = 'read' | 'edit' | 'terminal' | 'network' | 'extension';
export type McpConfig = { name: string; command?: string; args?: string[]; url?: string };
export type Settings = {
  theme: 'dark' | 'light'; prompt: string; policies: Record<string, Policy>;
  memoryEnabled:boolean;
  persistence:Persistence; evaluatorId:string|null; maxTokens:number|null;
  maxCalls: number; maxSeconds: number; maxDollars: number | null; mcp: McpConfig[];
};
export const defaults: Settings = {
  theme: 'dark', prompt: '', policies: {}, memoryEnabled:true, persistence:'standard',evaluatorId:null,maxTokens:null,maxCalls: 30, maxSeconds: 900, maxDollars: null, mcp: [],
};
export const preset: Record<Provider, {url: string; model: string}> = {
  deepseek: {url:'https://api.deepseek.com',model:'deepseek-flash'},
  openai: {url:'https://api.openai.com/v1',model:''},
  anthropic: {url:'https://api.anthropic.com/v1',model:''},
  gemini: {url:'https://generativelanguage.googleapis.com/v1beta',model:''},
  compatible: {url:'',model:''},
};
export type Project = { id: string; name: string; root: string; prompt: string };
export type MemoryDraft = { title:string; body:string; pinned:boolean };
export type MemoryNote = MemoryDraft & {id:string;projectId?:string;created:number;updated:number;sourceSessionId?:string};
export type Usage = { input: number | null; output: number | null; cache: number | null; cacheWrite: number | null; dollars: number | null; steps: number; missing: string[] };
export const emptyUsage = (): Usage => ({input:null,output:null,cache:null,cacheWrite:null,dollars:null,steps:0,missing:[]});
export type TurnUsage = {input:number|null;output:number|null;cache:number|null;cacheWrite:number|null};
export type LastTurn = TurnUsage & {rate:number|null;contextLimit:number;estimatedInput:number;kind:'answer'|'summary'|'review'};
export type LiveMeter = {estimatedInput:number;estimatedOutput:number;rate:number|null;lastDeltaAt:number|null;contextLimit:number;kind:LastTurn['kind']};
export type ContextGroup = 'instructions'|'memory'|'summary'|'user'|'assistant'|'results'|'tools';
export type ContextItem = {group:ContextGroup; title:string; source:string; content:string; estimate:number; omitted?:boolean};
export type ContextHeader = {
  id:string; time:number; kind:LastTurn['kind']; model:string; provider:Provider; limit:number; series:number;
  attempts:number; state:'running'|'completed'|'failed'|'interrupted'; estimate:number; usage?:TurnUsage; error?:string;
};
export type ContextTrace = {header:ContextHeader; items:ContextItem[]; partial:boolean; redacted:boolean};
export type Mode = 'standard' | 'iterate' | 'goal';
export type TaskPermission = 'rules' | 'full';
export type Status = 'idle' | 'running' | 'paused' | 'interrupted' | 'done' | 'cancelled' | 'error';
export type Stage = '开发' | '测试' | '审查' | '修复' | '回归测试';
export type PlanStep={id:string;title:string;status:'pending'|'in_progress'|'completed'|'blocked'|'skipped';detail?:string};
export type Review = {status:'completed'|'continue'|'blocked';reason:string;remaining_items:string[];next_actions:string[];evidence:string[]};
export type Entry = {
  id: string; time: number; kind: 'user' | 'assistant' | 'tool' | 'notice' | 'plan' | 'review';
  text: string; title?: string; input?: unknown; state?: 'pending' | 'ok' | 'error' | 'unknown';
  steps?:PlanStep[];
  images?:Attachment[];
  review?:Review; progress?:boolean;
};
export type Change = { id: string; path: string; tool: string; time: number; diff: string; pending: boolean };
export type Approval = { id: string; name: string; input: unknown; access: Access };
export type JobView = { id: string; command: string; output: string; running: boolean; exitCode: number | null; interrupted?:boolean };
export type GoalOutcome = { status:'achieved'|'blocked'; evidence:string };
export type Run = { started: number; calls: number; spent: number; activeMs: number; stage: number; mode: Mode; permission?:TaskPermission; profileId: string; runtime?:ModelRuntime; limits: Settings; goal: string; last: string; repeats: number; report?: {passed:boolean; summary:string}; verificationExit?:number; planEntryId?:string; goalOutcome?:GoalOutcome; question?:string;
  firstEntryId?:string; tokens?:number; tokenUnknown?:boolean; revisions?:string[]; review?:Review; stalledReviews?:number; reviewEvidenceKey?:string;
};
export type Session = {
  id: string; projectId: string; title: string; updated: number; status: Status;
  pinnedAt?:number; archivedAt?:number;
  entries: Entry[]; messages: ModelMessage[]; changes: Change[]; usage: Usage; context: number;
  messageSources?:Record<number,string>;
  lastTurn?: LastTurn;
  summary: string; queued: string[]; run?: Run;
  jobLog?: JobView[];
  pending?: {id:string; name:string; input:unknown; started:boolean}[];
};
export type SessionView = Omit<Session, 'messages' | 'summary' | 'pending' | 'jobLog' | 'messageSources'> & { live: string; approval?: Approval; jobs: JobView[]; meter?:LiveMeter };
export type SessionIndex = Pick<Session,'id'|'projectId'|'title'|'status'|'updated'|'pinnedAt'|'archivedAt'>;
export type SessionMatch = SessionIndex & {excerpt?:string};
export type Snapshot = { projects: Project[]; sessions: SessionIndex[]; profiles: Profile[]; settings: Settings; session?: SessionView; composer?:ComposerModel };
export const stages: Stage[] = ['开发','测试','审查','修复','回归测试'];
export type Request =
  | { type:'snapshot' } | { type:'select'; id?:string } | {type:'project.add'} | {type:'project.prompt'; id:string; prompt:string}
  | {type:'persistence.set'; level:Persistence}
  | {type:'session.add'; projectId:string} | {type:'settings.save'; settings: Settings}
  | {type:'session.rename'; id:string; title:string} | {type:'session.pin'; id:string; pinned:boolean}
  | {type:'session.archive'; id:string; archived:boolean; pauseActive?:boolean}
  | {type:'session.search'; query:string; archived:boolean}
  | {type:'memory.list'; projectId?:string} | {type:'memory.toggle'; enabled:boolean}
  | ({type:'memory.save'; id?:string; projectId?:string} & MemoryDraft)
  | {type:'memory.remove'; id:string; projectId?:string}
  | {type:'context.list'; id:string} | {type:'context.read'; id:string; traceId:string}
  | {type:'model.save'; profile: Profile; key?:string; clearKey?:boolean} | {type:'model.remove'; id:string}
  | {type:'model.test'; id:string; runtime?:ModelRuntime} | {type:'attach'; id:string}
  | {type:'attach.image';id:string;name:string;data:string}
  | {type:'attach.remove';id:string;attachmentId:string}
  | ({type:'model.quick'} & ComposerModel)
  | {type:'send'; id:string; text:string; mode:Mode; profileId:string; attachments:string[];runtime?:ModelRuntime;permission?:TaskPermission}
  | {type:'pause'|'resume'|'cancel'; id:string} | {type:'approve'; id:string; approval:string; allow:boolean}
  | {type:'job.stop'; id:string; job:string};
export type Bridge = {
  request: (request: Request) => Promise<{ok: true; data?: unknown} | {ok: false; error:string}>;
  subscribe: (onUpdate: (snapshot: Snapshot) => void) => () => void;
};

