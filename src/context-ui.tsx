import {useEffect,useMemo,useRef,useState} from 'react';
import {Braces,Layers,Search,X} from 'lucide-react';
import type {Bridge,ContextGroup,ContextHeader,ContextTrace,SessionView} from './types';

const groups=[
  ['instructions','指令','#88aef2'],['memory','长期记忆','#bc9be5'],['summary','历史摘要','#e6a8be'],
  ['user','用户与注入消息','#dfb370'],['assistant','模型消息','#80c7b5'],['results','工具结果','#a4c480'],['tools','工具定义','#778fc3'],
] as const;
const states={running:'请求中',completed:'已完成',failed:'失败',interrupted:'已中断'};
const digits=new Intl.NumberFormat('zh-CN');
const when=new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
const num=(value:number|null|undefined)=>value==null?'—':digits.format(value);

export function ContextDialog({session,request,close}:{
  session?:SessionView;request:Bridge['request'];close:()=>void;
}){
  const dialog=useRef<HTMLDialogElement>(null);
  const [headers,setHeaders]=useState<ContextHeader[]>([]);
  const [selected,setSelected]=useState('');
  const [trace,setTrace]=useState<ContextTrace>();
  const [error,setError]=useState('');
  const [indexing,setIndexing]=useState(Boolean(session));
  const [filter,setFilter]=useState<ContextGroup>();
  const [query,setQuery]=useState('');
  const [opened,setOpened]=useState<number>();
  const sid=session?.id;
  const revision=`${session?.run?.calls??0}/${session?.usage.steps??0}/${session?.status??''}/${Boolean(session?.meter)}`;
  useEffect(()=>{dialog.current?.showModal();},[]);
  useEffect(()=>{
    if(!sid)return;
    let stale=false;
    void request({type:'context.list',id:sid}).then(result=>{
      if(stale)return;
      if(result.ok){setHeaders(result.data as ContextHeader[]);setError('');}else setError(result.error);
    }).catch(failure=>{if(!stale)setError(String(failure));})
      .finally(()=>{if(!stale)setIndexing(false);});
    return ()=>{stale=true;};
  },[request,sid,revision]);
  const header=headers.find(item=>item.id===selected)??headers[0];
  const traceId=header?.id;
  useEffect(()=>{
    if(!sid||!traceId)return;
    let stale=false;
    setOpened(undefined);
    void request({type:'context.read',id:sid,traceId}).then(result=>{
      if(stale)return;
      if(result.ok){setTrace(result.data as ContextTrace);setError('');}else setError(result.error);
    }).catch(failure=>{if(!stale)setError(String(failure));});
    return ()=>{stale=true;};
  },[request,sid,traceId]);
  const current=trace?.header.id===traceId?trace:undefined;
  const counts=useMemo(()=>{
    const values=new Map<ContextGroup,number>();
    for(const item of current?.items??[])values.set(item.group,(values.get(item.group)??0)+item.estimate);
    return values;
  },[current]);
  const total=[...counts.values()].reduce((sum,count)=>sum+count,0);
  let left=0;
  const stacks=groups.flatMap(([group,label,color])=>{
    const value=counts.get(group)??0;
    if(!value||!total)return [];
    const width=1000*value/total;
    const segment={group,label,color,left,width};
    left+=width;
    return [segment];
  });
  const matches=(current?.items??[]).map((item,index)=>({item,index})).filter(({item})=>{
    const term=query.trim().toLocaleLowerCase();
    return (!filter||item.group===filter)&&(!term||(item.title+' '+item.source+' '+item.content).toLocaleLowerCase().includes(term));
  });
  return <dialog ref={dialog} className="command-dialog context-dialog" aria-label="请求上下文"
    onCancel={event=>{event.preventDefault();close();}}>
    <div className="command-heading"><h2><Layers size={18}/>请求上下文</h2>
      <button className="icon-button" type="button" aria-label="关闭请求上下文" onClick={close}><X size={18}/></button></div>
    {error&&<p className="context-error" role="alert">{error}</p>}
    {!header?<div className="context-empty"><Braces size={24}/><strong>{indexing?'正在读取请求记录…':'暂无上下文记录'}</strong>
      <p>{sid?'发出一个模型请求后，可以在这里查看该轮内容。':'打开会话后可以查看模型请求。'}</p></div>:<>
      <div className="context-brief">
        <label>请求记录<select aria-label="请求记录" value={header.id} onChange={event=>{setSelected(event.target.value);setFilter(undefined);setQuery('');}}>
          {headers.map(item=><option key={item.id} value={item.id}>{when.format(item.time)} · #{item.series} · {({summary:'历史压缩',answer:'Agent 推理',review:'独立验收'})[item.kind]} · {item.model}</option>)}
        </select></label>
        <span className="context-request-state">{states[header.state]}{header.attempts>1?` · ${header.attempts} 次尝试`:''}</span>
      </div>
      <div className="context-stats">
        <div><small>组装时估算</small><strong>≈{num(header.estimate)}</strong></div>
        <div><small>供应商输入</small><strong>{num(header.usage?.input)}</strong></div>
        <div><small>上下文上限</small><strong>{num(header.limit)}</strong></div>
        <div><small>缓存读取</small><strong>{num(header.usage?.cache)}</strong></div>
      </div>
      {header.error&&<p className="context-error">{header.error}</p>}
      {current?<div className="context-details">
        <div className="context-composition">
          <h3>输入组成</h3>
          <svg viewBox="0 0 1000 10" height="10" preserveAspectRatio="none" role="img" aria-label="输入上下文分类占比">
            {stacks.map(segment=><rect key={segment.group} x={segment.left} y="0" width={segment.width} height="10" fill={segment.color}/>)}
          </svg>
          <div className="context-legend" role="group" aria-label="按上下文组成筛选">
            <button type="button" aria-pressed={!filter} onClick={()=>setFilter(undefined)}>全部</button>
            {groups.filter(([group])=>counts.has(group)).map(([group,label,color])=>
              <button type="button" key={group} aria-pressed={filter===group} onClick={()=>setFilter(filter===group?undefined:group)}>
                <svg viewBox="0 0 8 8" width="8" height="8" aria-hidden="true"><circle cx="4" cy="4" r="4" fill={color}/></svg>{label}<code>≈{num(counts.get(group))}</code>
              </button>)}
          </div>
        </div>
        <label className="query-input context-search"><Search size={16}/><input aria-label="在请求内容中搜索" placeholder="搜索提示词、消息或工具…" value={query} onChange={event=>setQuery(event.target.value)}/></label>
        <div className="context-items">
          {!matches.length&&<p>没有匹配的内容。</p>}
          {matches.map(({item,index})=><div className="context-item" key={index}>
            <button type="button" aria-expanded={opened===index} onClick={()=>setOpened(opened===index?undefined:index)}>
              <span><strong>{item.title}</strong><small>{item.source}{item.omitted?' · 部分内容已裁剪':''}</small></span><code>≈{num(item.estimate)}</code>
            </button>
            {opened===index&&<pre>{item.content||'此项正文超出本地快照大小限制。'}</pre>}
          </div>)}
        </div>
        <p className="context-note">内容取自模型适配前的请求。本地保留每个会话最近 20 条。分类 Token 为估算。{current.redacted?'部分内容已脱敏。':''}{current.partial?'超大内容已裁剪。':''}</p>
      </div>:<div className="context-empty"><p>正在读取请求内容…</p></div>}
    </>}
  </dialog>;
}

