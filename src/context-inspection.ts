import type { ModelMessage } from 'ai';
import type { ContextGroup, ContextHeader, ContextItem, ContextTrace } from './types';
import { estimate } from './context';
import { trimOutput } from './redact';
import { sanitizeValue } from './errors';
import type { Tool } from './tool-registry';

export type SystemPart = {title:string;content:string;group?:'memory'|'summary'};
export const joinSystem=(parts:SystemPart[])=>parts.map(part=>part.content).filter(Boolean).join('\n\n');
const messageGroups:Record<ModelMessage['role'],ContextGroup>={system:'instructions',user:'user',assistant:'assistant',tool:'results'};
function titleOf(message:ModelMessage,index:number){
  if((message.role==='assistant'||message.role==='tool')&&Array.isArray(message.content)){
    const names=message.content.flatMap(part=>'toolName' in part?[part.toolName]:[]);
    if(names.length)return (message.role==='tool'?'工具结果':'工具调用')+' · '+names.join('、');
  }
  return ({system:'系统消息',user:'用户消息',assistant:'模型消息',tool:'工具结果'})[message.role]+' '+(index+1);
}
export function captureContext(
  header:ContextHeader,system:SystemPart[],messages:ModelMessage[],sources:Record<number,string>,
  tools:Map<string,Tool>,redact:(value:string)=>string,
):ContextTrace {
  const items:ContextItem[]=[];
  let bytesLeft=1048576;
  let redacted=false;
  let partial=false;
  const scrub=(text:string)=>{
    const clean=redact(text).replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/g,'[私钥已隐藏]');
    if(clean!==text)redacted=true;
    return clean;
  };
  const add=(group:ContextGroup,title:string,source:string,raw:string|object,count=estimate(raw))=>{
    const clean=typeof raw==='string'?scrub(raw):JSON.stringify(sanitizeValue(raw,scrub),(_key,value)=>
      typeof value==='string'&&value.startsWith('data:image/')?`[图片正文，编码长度 ${value.length}，视觉 Token 为估算]`:value,2);
    const cap=Math.min(bytesLeft,262144);
    const omitted=Buffer.byteLength(clean)>cap;
    const content=omitted?cap>=96?trimOutput(clean,Math.floor(cap/3)):'':clean;
    bytesLeft=Math.max(0,bytesLeft-Buffer.byteLength(content));
    partial ||= omitted;
    items.push({group,title:scrub(title),source,content,estimate:count,...omitted&&{omitted:true}});
  };
  for(const part of system) if(part.content) add(part.group??'instructions',part.title,'system',part.content);
  messages.forEach((message,index)=>{
    const source=sources[index];
    const injected=source&&source!=='用户附件';
    add(messageGroups[message.role],injected?source:titleOf(message,index),
      source?`${message.role} · ${injected?'框架注入':source}`:message.role,message);
  });
  for(const [name,tool] of tools){
    add('tools',name,'工具定义',{name,description:tool.description,inputSchema:tool.schema},
      estimate([name,tool.schema,tool.description]));
  }
  return {header,items,partial,redacted};
}

