import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Check,ChevronDown,ChevronRight,Cpu,ListChecks,SlidersHorizontal,X} from 'lucide-react';
import {contextPresets,persistenceLabels,persistenceLevels,type Bridge,type ComposerModel,type ContextHeader,type ContextTrace,type ModelRuntime,type Persistence,type Profile,type SessionView} from './types';
import {compatibleRuntime,contextCapacity,effectiveProfile,formatContextPercent,isOfficialDeepSeek,modelVariants} from './model-options';

const effortKeys=['off','low','medium','high'] as const;
const k=(value:number)=>value>=1000?`${(value/1000).toLocaleString('zh-CN',{maximumFractionDigits:1})}k`:String(value);
const variantLabels:Record<string,string>={'deepseek-flash':'DeepSeek Flash','deepseek-v4-pro':'DeepSeek V4 Pro'};
const variantLabel=(model:string)=>variantLabels[model]??model;
const modelLabel=(profile:Profile,model:string)=>isOfficialDeepSeek(profile)?variantLabel(model):profile.name;
function effortLabel(profile:Profile,effort:Profile['effort']){
  const labels=isOfficialDeepSeek(profile)?['关闭','低','高','最高']:['供应商默认','低','中','高'];
  return labels[effortKeys.indexOf(effort)];
}
type Page='root'|'model'|'usage';
const buckets=[
  {label:'系统提示词与记忆',color:'#a6b7f9'},
  {label:'工具定义',color:'#42c6aa'},
  {label:'对话与工具结果',color:'#e7ab71'},
  {label:'MCP 工具',color:'#b099e7'},
  {label:'技能资料',color:'#df83b4'},
];

export function ComposerControls({profiles,profile,runtime,session,running,request,change,manage,details,persistence,changePersistence}:{
  profiles:Profile[];profile?:Profile;runtime:ModelRuntime;session?:SessionView;running:boolean;request:Bridge['request'];
  change:(value:ComposerModel)=>Promise<boolean>;manage:()=>void;details:()=>void;
  persistence:Persistence;changePersistence:(level:Persistence)=>Promise<boolean>;
}){
  const host=useRef<HTMLDivElement>(null);
  const pane=useRef<HTMLElement>(null);
  const opener=useRef<HTMLButtonElement|null>(null);
  const [page,setPage]=useState<Page>();
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [trace,setTrace]=useState<ContextTrace>();
  const active=profile?effectiveProfile(profile,runtime):undefined;
  const last=session?.lastTurn;
  const live=session?.meter;
  const limit=(running?live?.contextLimit??last?.contextLimit:undefined)??active?.context;
  const input=live?.estimatedInput??last?.input??last?.estimatedInput??0;
  const knownInput=!live&&last?.input!=null;
  const usage=limit?input/limit:0;
  const choosePage=(next?:Page)=>{setPage(next);setMessage('');};
  const close=()=>{choosePage(undefined);opener.current?.focus();};
  useEffect(()=>{
    if(!page)return;
    const outside=(event:PointerEvent)=>{if(!host.current?.contains(event.target as Node))setPage(undefined);};
    const keyboard=(event:KeyboardEvent)=>{
      if(event.key!=='Escape')return;
      event.preventDefault();event.stopPropagation();
      close();
    };
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',keyboard);
    return ()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',keyboard);};
  },[page]);
  useEffect(()=>{
    if(!page||busy)return;
    pane.current?.querySelector<HTMLElement>('.quick-menu button:not(:disabled), .context-presets button[aria-pressed="true"]:not(:disabled), .context-details-link')?.focus({preventScroll:true});
  },[page,busy]);
  useEffect(()=>{
    if(!session||page!=='usage')return;
    let stop=false;
    void request({type:'context.list',id:session.id}).then(async result=>{
      if(!result.ok||stop)return;
      const [latest]=result.data as ContextHeader[];
      if(!latest){if(!stop)setTrace(undefined);return;}
      const response=await request({type:'context.read',id:session.id,traceId:latest.id});
      if(!stop&&response.ok)setTrace(response.data as ContextTrace);
    }).catch(()=>{if(!stop)setTrace(undefined);});
    return ()=>{stop=true;};
  },[page,request,session?.id,session?.run?.calls,session?.usage.steps]);
  useEffect(()=>{setTrace(undefined);},[session?.id]);
  const estimates=buckets.map(()=>0);
  for(const item of trace?.items??[]){
    const index=item.title==='技能目录'||item.group==='results'&&item.title.includes('load_skill')?4
      :item.group==='tools'?item.title.startsWith('mcp_')?3:1
      :['instructions','memory','summary'].includes(item.group)?0:2;
    estimates[index]+=item.estimate;
  }
  const usedEstimate=estimates.reduce((a,b)=>a+b,0);
  const choose=async(p:Profile,next:ModelRuntime)=>{
    if(running||busy)return;
    setBusy(true);
    try {
      if(await change({profileId:p.id,runtime:next}))setPage(now=>now===page&&now?(now==='usage'?'usage':'root'):now);
    }finally{setBusy(false);}
  };
  const test=async()=>{
    if(!profile||busy)return;
    if(!profile.hasKey&&profile.provider!=='compatible'){choosePage(undefined);manage();return;}
    setBusy(true);setMessage('正在测试…');
    try{
      const result=await request({type:'model.test',id:profile.id,runtime});
      setMessage(result.ok?`API 已连接 · ${(result.data as {chunks?:number})?.chunks??0} 个流式分段`:result.error);
    }catch(error){setMessage(String(error));}finally{setBusy(false);}
  };
  const selectContext=profile&&active&&<div className="context-presets" role="group" aria-label="上下文档位">
    {contextPresets.map(value=><button key={value} type="button" aria-pressed={active.context===value}
      disabled={running||busy||value>contextCapacity(profile,active.model)||value<=profile.output}
      title={value>contextCapacity(profile,active.model)?'超过该模型配置的窗口上限':undefined}
      onClick={()=>void choose(profile,{...runtime,context:value})}>{k(value)}</button>)}
  </div>;
  const localState=page==='usage';
  let occupied=0;
  return <div className="composer-model" ref={host}>
    <button type="button" className="quick-context" aria-label="上下文用量" title="上下文用量" aria-expanded={page==='usage'}
      onClick={event=>{opener.current=event.currentTarget;choosePage(page==='usage'?undefined:'usage');}}>
      <svg width="23" height="23" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" opacity=".3" strokeWidth="2.2"/>
        {limit&&<circle cx="12" cy="12" r="8" fill="none" stroke="var(--accent)" strokeWidth="2.2" transform="rotate(-90 12 12)"
          strokeDasharray={`${Math.min(1,usage)*50.27} 50.27`}/>}
      </svg>
    </button>
    <label className="inline-choice" title="推理强度">
      <SlidersHorizontal size={15} aria-hidden="true"/>
      <span>推理</span><select aria-label="推理强度" value={active?.effort??'off'} disabled={running||busy||!profile}
        onChange={event=>profile&&void choose(profile,{...runtime,effort:event.target.value as Profile['effort']})}>
        {effortKeys.map(effort=><option key={effort} value={effort}>{profile?effortLabel(profile,effort):effort}</option>)}
      </select>
    </label>
    <label className="inline-choice" title="执行毅力">
      <ListChecks size={15} aria-hidden="true"/>
      <span>毅力</span><select aria-label="执行毅力" value={persistence} disabled={running||busy}
        onChange={async event=>{
          setBusy(true);
          try{await changePersistence(event.target.value as Persistence);}finally{setBusy(false);}
        }}>
        {persistenceLevels.map(level=><option key={level} value={level}>{persistenceLabels[level]}</option>)}
      </select>
    </label>
    <button type="button" className="quick-model" aria-label="模型选项" aria-expanded={page==='root'||page==='model'}
      onClick={event=>{opener.current=event.currentTarget;if(!active){manage();return;}choosePage(page&&page!=='usage'?undefined:'root');}}>
      <Cpu size={16}/><span>{profile&&active?modelLabel(profile,active.model):'添加模型'}</span><ChevronDown size={14}/>
    </button>
    {page&&<section ref={pane} className={`quick-popover ${localState?'context-popover':''}`} aria-label={page==='usage'?'上下文浮层':'任务模型设置'}>
      <header>
        {page!=='root'&&page!=='usage'&&<button className="icon-button" type="button" aria-label="返回模型选项" onClick={()=>choosePage('root')}><ArrowLeft size={16}/></button>}
        <strong>{{root:'模型设置',model:'选择模型',usage:'上下文用量'}[page]}</strong>
        <button className="icon-button" type="button" aria-label="关闭模型浮层" onClick={close}><X size={16}/></button>
      </header>
      {page==='root'&&active&&profile&&<>
        <div className="quick-menu">
          <button type="button" onClick={()=>choosePage('model')}><Cpu size={16}/><span>模型</span><small>{variantLabel(active.model)}</small><ChevronRight size={14}/></button>

        </div>
        <div className="quick-actions">
          <button type="button" onClick={()=>{choosePage(undefined);manage();}}>管理 API</button>
          <button type="button" onClick={()=>void test()} disabled={busy}>测试 API</button>
        </div>
        {message&&<p role="status" className="quick-message">{message}</p>}
      </>}
      {page==='model'&&<div className="quick-menu">
        {profiles.flatMap(p=>modelVariants(p).map(model=><button type="button" key={p.id+model} disabled={running||busy}
          onClick={()=>void choose(p,compatibleRuntime(p,{...(p.id===profile?.id?runtime:{}),model}))}>
          <span><strong>{modelLabel(p,model)}</strong><small>{model}{!p.hasKey&&p.provider!=='compatible'?' · 待配置密钥':''}</small></span>
          {p.id===profile?.id&&active?.model===model&&<Check size={16}/>}
        </button>))}
        <button type="button" onClick={()=>{choosePage(undefined);manage();}}>管理模型配置</button>
      </div>}
      {page==='usage'&&<div className="quick-context-body">
        <div className="context-readout"><strong>{limit?formatContextPercent(usage):'—'}</strong>
          <span>{limit?`${knownInput?'':'≈'}${k(input)} / ${k(limit)} Tokens`:'尚未选择模型'}</span></div>
        <svg viewBox="0 0 100 6" height="8" preserveAspectRatio="none" className="quick-stack" role="img" aria-label="上下文组成估算">
          {buckets.map((bucket,i)=>{
            const width=usedEstimate?Math.min(100,usage*100)*estimates[i]/usedEstimate:0;
            const start=occupied;occupied+=width;
            return <rect key={bucket.label} x={start} width={width} height="6" fill={bucket.color}/>;
          })}
          {!usedEstimate&&<rect width={Math.min(100,usage*100)} height="6" fill="var(--accent)"/>}
        </svg>
        <div className="context-breakdown-head"><span>输入组成</span><small>估算</small></div>
        <ul className="quick-legend">{buckets.map((bucket,i)=><li key={bucket.label}>
          <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><circle cx="4" cy="4" r="4" fill={bucket.color}/></svg>
          <span>{bucket.label}</span><small>{usedEstimate?formatContextPercent(usage*estimates[i]/usedEstimate):'—'}</small>
        </li>)}</ul>
        {active&&<div className="context-tier"><p className="context-tier-current">{k(active.context)} 上下文</p>{selectContext}</div>}
        <button type="button" className="context-details-link" onClick={()=>{choosePage(undefined);details();}}>查看请求明细 <ChevronRight size={14}/></button>
      </div>}
      {running&&page!=='usage'&&<p className="quick-message">任务运行中，结束后可调整。</p>}
    </section>}
  </div>;
}

