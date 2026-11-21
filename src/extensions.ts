import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { define, Registry, type Tool } from './tool-registry';
import { fileTools, guarded, readText } from './workspace';
import { safeEnv, terminalTools, gitTools } from './processes';
import { webTools } from './network';
import type { McpConfig } from './types';

export const builtins=[...fileTools,...terminalTools,...gitTools,...webTools];
export const customTools=new Registry();

async function skills(root:string,globalRoot:string) {
  const result=new Map<string,{base:string;relative:string;description:string}>();
  for(const [base,prefix] of [[globalRoot,'skills'],[root,'.agents/skills'],[root,'skills']]) {
    const dir=await guarded(base,prefix).catch(()=>null);
    if(!dir) continue;
    const children=await fs.readdir(dir,{withFileTypes:true}).catch(()=>[]);
    for(const child of children.slice(0,100)) {
      if(!child.isDirectory()) continue;
      const relative=`${prefix}/${child.name}/SKILL.md`;
      try {
        const text=await readText(await guarded(base,relative),64000);
        const meta=/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
        const description=meta?.match(/^description:\s*(.+)$/m)?.[1]?.slice(0,200)??'加载技能说明';
        result.set(child.name,{base,relative,description});
      } catch { /* An unavailable skill is omitted. */ }
    }
  }
  return result;
}
export async function extensions(root:string,globalRoot:string,mcp:McpConfig[],signal:AbortSignal) {
  const registry=new Registry();
  for(const tool of [...builtins,...customTools.values()]) registry.register(tool);
  const available=await skills(root,globalRoot);
  registry.register(define('load_skill','read','读取项目或全局 SKILL.md。',z.object({name:z.string().max(120)}),async(i)=>{
    const skill=available.get(i.name);
    if(!skill) throw new Error('未发现此技能');
    return {ok:true,name:i.name,text:await readText(await guarded(skill.base,skill.relative),64000)};
  }));
  const agents = await guarded(root,'AGENTS.md').then(p=>readText(p,64000)).catch(()=> '');
  const clients:Client[]=[];
  const errors:string[]=[];
  await Promise.all(mcp.map(async config=>{
    const client = new Client({name:'Atom',version:'0.1.0'});
    clients.push(client);
    const clientSignal=AbortSignal.any([signal,AbortSignal.timeout(12000)]);
    const close=()=>void client.close().catch(()=>{});
    clientSignal.addEventListener('abort',close,{once:true});
    try {
      clientSignal.throwIfAborted();
      const transport=config.url ? new StreamableHTTPClientTransport(new URL(config.url),{
        requestInit:{redirect:'error'},
      }) : new StdioClientTransport({
        command:config.command!,args:config.args,env:Object.fromEntries(Object.entries(safeEnv()).filter((v):v is [string,string]=>v[1]!=null)),
        cwd:root,stderr:'ignore',
      });
      await client.connect(transport,{signal:clientSignal,timeout:10000});
      let cursor:string|undefined;
      for(let page=0;page<5;page++) {
        const listing=await client.listTools(cursor ? {cursor} : undefined,{signal:clientSignal,timeout:10000});
        for(const tool of listing.tools) {
          const name=`mcp_${config.name}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,64);
          registry.register({
            name,access:'extension',description:tool.description??tool.name,schema:tool.inputSchema as Tool['schema'],
            run:async(input,ctx)=>{
              const result=await client.callTool({name:tool.name,arguments:input as Record<string,unknown>},undefined,{signal:ctx.signal,timeout:60000});
              return {ok:result.isError!==true,result:result.structuredContent??result.content};
            },
          });
        }
        cursor=listing.nextCursor;
        if(!cursor) break;
      }
    } catch (error) {
      errors.push(`${config.name} · ${error instanceof Error ? error.message : '连接失败'}`);
      await client.close().catch(()=>{});
    } finally {clientSignal.removeEventListener('abort',close);}
  }));
  return {registry,errors,agents,skillList:[...available].map(([name,s])=>`- ${name} · ${s.description}`).join('\n'),
    close:()=>Promise.allSettled(clients.map(client=>client.close()))};
}

