import {useEffect,useState} from 'react';
import {Database,Gauge} from 'lucide-react';
import type {Profile,SessionView,Status} from './types';
import {formatContextPercent} from './model-options';
const statuses:Record<Status,string>={idle:'就绪',running:'运行中',paused:'已暂停',interrupted:'已中断',done:'已完成',cancelled:'已取消',error:'需处理'};
const format=new Intl.NumberFormat('zh-CN');
const number=(value:number|null|undefined)=>value==null?'—':format.format(value);
const percent=new Intl.NumberFormat('zh-CN',{style:'percent',maximumFractionDigits:1});
function total(key:'input'|'output'|'cache'|'cacheWrite',s:SessionView|undefined) {
  return number(s?.usage[key])+(s?.usage[key]!=null&&s.usage.missing.includes(key)?'+':'');
}
export function Statusbar({session,profile,openContext}:{session?:SessionView;profile?:Profile;openContext:()=>void}){
  const meter=session?.meter;
  const last=session?.lastTurn;
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{
    if(!meter)return;
    const timer=setInterval(()=>setNow(Date.now()),350);
    return ()=>clearInterval(timer);
  },[Boolean(meter)]);
  const rate=meter?(meter.lastDeltaAt&&now-meter.lastDeltaAt>3000?0:meter.rate):last?.rate;
  const input=meter?meter.estimatedInput:last?.input;
  const output=meter?(meter.lastDeltaAt==null?null:meter.estimatedOutput):last?.output;
  const hasCache=last?.cache!=null&&last.input!=null&&last.input>0&&last.cache<=last.input;
  const hit=hasCache?percent.format(last.cache!/last.input!):'—';
  const limit=meter?.contextLimit??last?.contextLimit??profile?.context;
  const context=meter?.estimatedInput??last?.input??last?.estimatedInput??(session?.context||null);
  const fraction=limit&&context!=null?context/limit:null;
  const contextLabel=fraction==null?'—':formatContextPercent(fraction);
  const circle=2*Math.PI*5.5;
  const status=session?.status??'idle';
  const approx=(v:number|null|undefined)=>v==null?'—':(meter?'≈':'')+number(v);
  const cash=session?.usage.dollars;
  return <footer className="statusbar" aria-label="用量状态栏">
    <span className="status-state"><i className={`dot ${status}`}/>{statuses[status]}</span>
    <div className="status-metrics">
      <span className="metric" title={meter?'按最近输出增量估算的生成速率，包含可观测的推理和工具参数。':'上次响应的供应商输出 Token 除以请求总耗时。'} data-atom-metric="rate">
        <Gauge size={16}/>{approx(rate)} tok/s
      </span>
      <span className="metric" title={`当前或最近请求的输入 / 输出 Token。会话累计输入 ${total('input',session)}，输出 ${total('output',session)}。`} data-atom-metric="tokens">
        <span className="metric-label">输入</span>{approx(input)}<span className="metric-label">输出</span>{approx(output)}
      </span>
      <span className="metric" title={`最近已结算请求缓存读取 ${number(last?.cache)} / 输入 ${number(last?.input)}。累计缓存读取 ${total('cache',session)}，写入 ${total('cacheWrite',session)}。`} data-atom-metric="cache">
        <Database size={15}/><span className="metric-label">缓存命中率</span>{hit}
      </span>
      <button type="button" onClick={openContext} aria-label="查看请求上下文" className="metric context-metric" title="查看请求上下文。发送前显示估算值，完成后显示供应商回报。" data-atom-metric="context">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" opacity=".27" strokeWidth="2.5"/>
          {fraction!=null&&<circle className="context-arc" cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="2.5"
            transform="rotate(-90 8 8)" strokeDasharray={`${Math.min(1,Math.max(0,fraction))*circle} ${circle}`}/>}
        </svg>
        <span className="metric-label">上下文</span>{context==null?'—':((meter||last?.input==null)?'≈':'')+number(context)} / {number(limit)}<strong>{contextLabel}</strong>
      </button>
    </div>
    <span className="status-end" title="会话费用按配置的每百万 Token 单价估算">{cash==null?'费用 —':`US$ ${cash.toFixed(5)}${session!.usage.missing.includes('dollars')?'+':''}`}</span>
  </footer>;
}

