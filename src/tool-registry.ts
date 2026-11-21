import { z } from 'zod';
import type { Access, JobView } from './types';

export type ToolResult = {ok:boolean; [key:string]: unknown};
export type ToolContext = {
  root: string; signal: AbortSignal; jobs: Jobs; redact: (text:string) => string;
  beforeChange: (path: string, before: string | null, after: string | null) => () => void;
};
export type Jobs = {
  start: (command:string, shell:'powershell'|'cmd', background:boolean) => Promise<ToolResult>;
  list: (id?:string) => JobView[];
  stop: (id:string) => Promise<void>;
};
export type Tool = {
  name: string; description: string; access: Access; schema: Parameters<typeof z.fromJSONSchema>[0];
  alwaysAsk?:boolean;
  requiresConsent?:boolean;
  run: (input: unknown, ctx: ToolContext) => Promise<ToolResult>;
};
export function define<S extends z.ZodType>(name:string, access:Access, description:string, shape:S,
  run:(input:z.output<S>,ctx:ToolContext) => Promise<ToolResult>, alwaysAsk=false):Tool {
  return {name,access,description,schema:z.toJSONSchema(shape),alwaysAsk,
    run:(input,ctx) => run(shape.parse(input),ctx)};
}
export class Registry extends Map<string,Tool> {
  register(tool: Tool) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name) || this.has(tool.name)) throw new Error('工具名称无效或重复');
    this.set(tool.name,tool);
  }
}

