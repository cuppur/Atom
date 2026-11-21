import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { applyPatch } from 'diff';
import { z } from 'zod';
import { define, type ToolContext } from './tool-registry';
import { trimOutput } from './redact';
const scope = z.string().max(1024);
const file = {path:scope};
const large = 1024*1024;
const hidden = /^(?:\.git|\.env(?:\..*)?|\.npmrc|\.netrc|\.pypirc|\.aws|\.ssh|.*\.(?:pem|key|pfx|p12))$/i;
const ignored = /^(?:node_modules|\.next|\.venv|dist|build|release)$/i;
export async function guarded(root:string, relative:string) {
  if (relative === '.' || relative === '') return root;
  const segments = relative.split(/[\\/]/);
  if (segments.some(s => !s || s === '..' || s === '.' || /[<>:"|?*\x00-\x1f]/.test(s) ||
    /[. ]$/.test(s) || /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(s) ||
    hidden.test(s) || /^\.atom-/.test(s))) throw new Error('路径被工作区限制拦截');
  let current = root;
  const canonicalRoot = await fs.realpath(root);
  for (const segment of segments) {
    current = path.join(current,segment);
    const found = await fs.lstat(current).catch(e => { if(e.code === 'ENOENT') return null; throw e; });
    if (found?.isSymbolicLink() || (found?.isFile() && found.nlink > 1)) throw new Error('工作区工具禁止符号链接、目录联接和硬链接');
    if (found) {
      const resolved = await fs.realpath(current);
      const relativeToRoot = path.relative(canonicalRoot,resolved);
      if (path.isAbsolute(relativeToRoot) || relativeToRoot.split(path.sep)[0] === '..') throw new Error('路径超出工作区');
    }
  }
  return current;
}
export async function readText(absolute: string, limit=large) {
  const handle = await fs.open(absolute,'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink > 1 || stat.size > limit) throw new Error('仅支持工作区内大小符合限制的普通文本文件');
    const buffer = Buffer.alloc(limit+1);
    const {bytesRead} = await handle.read(buffer,0,limit+1,0);
    const bytes = buffer.subarray(0,bytesRead);
    if (bytesRead > limit || bytes.includes(0)) throw new Error('文件过大或为二进制');
    return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  } finally {await handle.close();}
}
async function change(ctx:ToolContext, relative:string, operation:(before:string|null)=>string|null) {
  const absolute = await guarded(ctx.root,relative);
  if (absolute === ctx.root) throw new Error('需要指定文件');
  const current = () => readText(absolute).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const before = await current();
  const after = operation(before);
  if(after === before) return {ok:true,path:relative,changed:false};
  if(after != null && Buffer.byteLength(after)>large) throw new Error('修改后文件超过 1 MiB');
  ctx.signal.throwIfAborted();
  const done = ctx.beforeChange(relative,before,after);
  if (after === null) {
    await guarded(ctx.root,relative);
    if (before !== await current()) throw new Error('文件已被其他进程修改');
    await fs.unlink(absolute);
  } else {
    await fs.mkdir(path.dirname(absolute),{recursive:true});
    await guarded(ctx.root,relative);
    const temp = path.join(path.dirname(absolute),'.atom-'+randomUUID());
    try {
      await fs.writeFile(temp,after,{flag:'wx'});
      await guarded(ctx.root,relative);
      if (before !== await current()) throw new Error('文件已被其他进程修改');
      if (before === null) await fs.link(temp,absolute);
      else { await fs.chmod(temp,(await fs.stat(absolute)).mode); await fs.rename(temp,absolute); }
    } finally { await fs.rm(temp,{force:true}); }
  }
  done();
  return {ok:true,path:relative,changed:true};
}
async function find(ctx:ToolContext, root:string, kind:'list'|'name'|'content', query:string) {
  if(kind !== 'list' && !query.trim()) throw new Error('请输入搜索词');
  const start = await guarded(ctx.root,root);
  const pending = [start];
  const matches:string[] = [];
  let scanned=0;
  const target = query.toLowerCase();
  while (pending.length && matches.length<200 && scanned<4000) {
    ctx.signal.throwIfAborted();
    const dir = pending.pop()!;
    const children = await fs.opendir(dir);
    for await (const entry of children) {
      if (++scanned>4000 || matches.length>=200) break;
      if (hidden.test(entry.name) || ignored.test(entry.name) || entry.isSymbolicLink() || /^\.atom-/.test(entry.name)) continue;
      const relative = path.relative(ctx.root,path.join(dir,entry.name));
      if (kind === 'list' || (kind === 'name' && entry.name.toLowerCase().includes(target))) matches.push(relative+(entry.isDirectory()?'/':''));
      if (entry.isDirectory()) pending.push(await guarded(ctx.root,relative));
      if (kind === 'content' && entry.isFile()) {
        const text = await readText(await guarded(ctx.root,relative),200000).catch(() => '');
        for (const [i,line] of text.split(/\r?\n/).entries()) {
          if (line.toLowerCase().includes(target)) matches.push(`${relative}:${i+1}: ${line.slice(0,400)}`);
          if(matches.length>=200) break;
        }
      }
    }
  }
  return {ok:true,matches,scanned,truncated:matches.length>=200||scanned>=4000};
}
export const fileTools = [
  define('read_file','read','读取 UTF-8 工作区文件，行号从 1 开始。',z.object({...file,start:z.number().int().min(1).optional(),lines:z.number().int().min(1).max(1000).optional()}),async (i,c) => {
    const rows=(await readText(await guarded(c.root,i.path))).split(/\r?\n/);
    const start=(i.start ?? 1)-1;
    return {ok:true,path:i.path,totalLines:rows.length,text:trimOutput(rows.slice(start,start+(i.lines??300)).map((line,index)=>`${start+index+1} | ${line}`).join('\n'))};
  }),
  define('write_file','edit','创建或覆盖 UTF-8 工作区文本文件。覆盖时须传 overwrite=true。',z.object({...file,text:z.string().max(large),overwrite:z.boolean().optional()}),async (i,c) =>
    change(c,i.path,before => {if(before!==null&&!i.overwrite) throw new Error('文件已存在');return i.text;})),
  define('delete_file','edit','删除单个工作区文本文件并保存差异。',z.object(file),async(i,c)=>change(c,i.path,before=> {
    if(before===null) throw new Error('文件不存在');return null;
  }),true),
  define('replace_text','edit','精确替换文件中唯一匹配的原文。',z.object({...file,old:z.string().min(1),replacement:z.string()}),async(i,c)=>
    change(c,i.path,before=> {
      const pos = before?.indexOf(i.old) ?? -1;
      if(before==null || pos<0 || before.indexOf(i.old,pos+1)>=0) throw new Error('原文必须恰好出现一次');
      return before.slice(0,pos)+i.replacement+before.slice(pos+i.old.length);
    })),
  define('apply_patch','edit','按严格上下文将单文件 unified diff 应用到指定路径。',z.object({...file,patch:z.string().max(large)}),async(i,c)=>
    change(c,i.path,before=> {
      if(before==null) throw new Error('文件不存在');
      const after=applyPatch(before,i.patch,{fuzzFactor:0});
      if(after===false) throw new Error('补丁上下文不匹配');
      return after;
    })),
  define('list_directory','read','递归列出工作区目录。',z.object({path:scope.optional()}),(i,c)=>find(c,i.path??'.','list','')),
  define('search_files','read','按文件名子串搜索。',z.object({path:scope.optional(),query:z.string().max(500)}),(i,c)=>find(c,i.path??'.','name',i.query)),
  define('search_text','read','在 UTF-8 文件中按子串搜索，返回路径及行号。',z.object({path:scope.optional(),query:z.string().max(500)}),(i,c)=>find(c,i.path??'.','content',i.query)),
];

