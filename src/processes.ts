import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { z } from 'zod';
import { define, type Jobs, type ToolResult } from './tool-registry';
import type { JobView } from './types';
import { trimOutput } from './redact';
const exec=promisify(execFile);
export function safeEnv() {
  const names = /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|HOMEDRIVE|HOMEPATH|PROGRAMFILES(?:\(X86\))?|PROGRAMDATA|NUMBER_OF_PROCESSORS)$/i;
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => names.test(name)));
}
const windows = process.env.SystemRoot ?? 'C:\\Windows';
const cmd = path.join(windows,'System32','cmd.exe');
const powershell = path.join(windows,'System32','WindowsPowerShell','v1.0','powershell.exe');

export class Processes implements Jobs {
  private jobs = new Map<string,{view:JobView; child:ChildProcess; done:Promise<ToolResult>}>();
  constructor(private root:string,private redact:(text:string)=>string,private update:()=>void) {}
  async start(command:string,shell:'powershell'|'cmd',background:boolean) {
    if (this.jobs.size >= 80) {
      const ended=[...this.jobs].find(([,job])=>!job.view.running);
      if(ended) this.jobs.delete(ended[0]); else throw new Error('后台进程过多');
    }
    if(shell==='cmd' && /[\r\n\x00]|\^\s*$/.test(command)) throw new Error('CMD 需要单行命令');
    const script = `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'
& {
${command}
}
if (-not $?) { exit 1 }
if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }`;
    const argv = shell==='powershell'
      ? ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')]
      : ['/d','/q','/v:off'];
    const child = spawn(shell==='powershell'?powershell:cmd,argv,{
      cwd:this.root,env:safeEnv(),windowsHide:true,stdio:'pipe',shell:false,
    });
    const id=randomUUID();
    const view:JobView={id,command:this.redact(command),output:'',running:true,exitCode:null};
    let raw='';
    for (const readable of [child.stdout,child.stderr]) {
      const decoder=new StringDecoder('utf8');
      const append=(value:string) => {raw=(raw+value).slice(-40000);view.output=trimOutput(this.redact(raw),20000);this.update();};
      readable.on('data',data=>append(decoder.write(data)));
      readable.on('end',()=>append(decoder.end()));
    }
    child.stdin.on('error',()=>{});
    if(shell==='cmd') child.stdin.end('chcp 65001 >nul\r\n'+command+'\r\nexit /b %errorlevel%\r\n');
    else child.stdin.end();
    const done=new Promise<ToolResult>(resolve => {
      child.once('error',error=>{view.output=this.redact(error.message);});
      child.once('close',code=>{
        view.exitCode=code;view.running=false;this.update();
        resolve({ok:code===0,job:id,exitCode:code,output:view.output,running:false});
      });
    });
    this.jobs.set(id,{view,child,done});
    this.update();
    return background ? {ok:true,job:id,running:true} : done;
  }
  list(id?:string) {return [...this.jobs.values()].map(job=>job.view).filter(view=>!id||id===view.id);}
  async stop(id:string) {
    const job=this.jobs.get(id);
    if(!job) throw new Error('进程不存在');
    if(!job.view.running || !job.child.pid) return;
    try {
      await exec(path.join(windows,'System32','taskkill.exe'),['/PID',String(job.child.pid),'/T','/F'],{windowsHide:true,timeout:6000});
    } catch {
      if(job.view.running && !job.child.kill()) throw new Error('无法终止进程');
    }
  }
  async stopAll() {await Promise.allSettled(this.list().filter(j=>j.running).map(j=>this.stop(j.id)));}
}
const jobId=z.object({id:z.string().uuid()});
export const terminalTools=[
  define('run_command','terminal','经确认后在项目目录执行 PowerShell 或 CMD。后台模式返回进程 ID。',z.object({
    command:z.string().min(1).max(12000),shell:z.enum(['powershell','cmd']),background:z.boolean().optional(),
  }),(i,c)=>c.jobs.start(i.command,i.shell,i.background??false),true),
  define('process_output','read','查看当前会话进程状态和实时输出。',z.object({id:z.string().uuid().optional()}),async(i,c)=>({ok:true,jobs:c.jobs.list(i.id)})),
  define('stop_process','terminal','停止指定会话进程及其子进程。',jobId,async(i,c)=>{await c.jobs.stop(i.id);return {ok:true,id:i.id};},true),
];

async function git(root:string,args:string[],signal:AbortSignal) {
  try {
    const {stdout,stderr}=await exec('git',['--no-pager','-c','core.fsmonitor=false','-c','core.untrackedCache=false',...args],{
      cwd:root,signal,env:{...safeEnv(),GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'NUL'},
      windowsHide:true,timeout:10000,maxBuffer:2*1024*1024,
    });
    return {ok:true,output:trimOutput(stdout),stderr:trimOutput(stderr)};
  } catch (e) {const error=e as {stdout?:string;stderr?:string;code?:string|number};return {ok:false,code:error.code,output:trimOutput(error.stdout??''),stderr:trimOutput(error.stderr??'Git 未安装、超时或输出超过限制')};}
}
export const gitTools=[
  define('git_status','read','查询 Git 工作区状态。',z.object({}),(_,c)=>git(c.root,['status','--short','--untracked-files=normal'],c.signal)),
  define('git_diff','read','查看 Git 已暂存或未暂存差异。',z.object({staged:z.boolean().optional()}),(i,c)=>
    git(c.root,['diff','--no-ext-diff','--no-textconv','--ignore-submodules',...(i.staged?['--cached']:[]),'--'],c.signal)),
];

