import React, {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {Archive,ArrowDown,ArrowRight,ArrowUp,BookOpen,Check,ChevronRight,CircleAlert,CircleDashed,CircleHelp,Ellipsis,FileCode2,Folder,FolderOpen,GitBranch,ListTodo,Minus,PanelLeft,PanelRight,Pause,Pencil,Pin,PinOff,Play,Plus,Settings2,Shield,Square,Terminal,Trash2,Wrench,X} from 'lucide-react';
import {preset,stages,persistenceLabels,type Bridge,type Review,type PlanStep,type Status,type SessionIndex,type Snapshot,type Request,type Profile,type Settings,type Mode,type TaskPermission,type Provider,type Project,type SessionView} from './types';
import {RenameDialog,Sidebar,SessionSearch} from './sidebar';
import {Statusbar} from './statusbar';
import {MemoryDialog} from './memory-ui';
import {ContextDialog} from './context-ui';
import {ComposerControls} from './composer-model';
import {compatibleRuntime,effectiveProfile} from './model-options';
import './ui.css';
import type { Attachment } from './types';

const api=(window as unknown as {atom:Bridge & {tools:()=>Promise<{name:string;access:string;alwaysAsk?:boolean}[]>}}).atom;
const providerNames={deepseek:'DeepSeek',openai:'OpenAI',anthropic:'Anthropic',gemini:'Gemini',compatible:'OpenAI-compatible'};
const icons={
  plan:ListTodo, files:GitBranch, tools:Wrench,
};
function IconButton({label,children,...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&{label:string}) {
  return <button {...props} type="button" className={`icon-button ${props.className??''}`} aria-label={label} title={label}>{children}</button>;
}
type Send=(r:Request)=>Promise<{ok:true;data?:unknown}|{ok:false;error:string}>;
function pretty(value:unknown){return JSON.stringify(value,null,2);}

function App(){
  const [snapshot,setSnapshot]=useState<Snapshot>();
  const [mode,setMode]=useState<Mode>('standard');
  const [permission,setPermission]=useState<TaskPermission>('full');
  const [text,setText]=useState('');
  const [attached,setAttached]=useState<Attachment[]>([]);
  const [issue,setIssue]=useState('');
  const [page,setPage]=useState<'models'|'preferences'>();
  const [search,setSearch]=useState<'active'|'archived'>();
  const [memoryOpen,setMemoryOpen]=useState(false);
  const [contextOpen,setContextOpen]=useState(false);
  const [rename,setRename]=useState<SessionIndex>();
  const [panel,setPanel]=useState(false);
  const [left,setLeft]=useState(true);
  const [tab,setTab]=useState<'plan'|'files'|'tools'>('plan');
  const [focusFile,setFocusFile]=useState<string>();
  const [busy,setBusy]=useState(false);
  const [bottom,setBottom]=useState(true);
  const transcript=useRef<HTMLDivElement>(null);
  const input=useRef<HTMLTextAreaElement>(null);
  const isComposing=useRef(false);
  const send:Send=async request=>{
    setIssue('');
    try{
      const result=await api.request(request);
      if(!result.ok)setIssue(result.error);
      if(result.ok&&request.type==='select'&&result.data)setSnapshot(result.data as Snapshot);
      return result;
    }catch(error){const message=String(error);setIssue(message);return {ok:false,error:message};}
  };
  useEffect(()=>{
    const stop=api.subscribe(setSnapshot);
    void api.request({type:'snapshot'}).then(r=>{if(r.ok)setSnapshot(r.data as Snapshot);else setIssue(r.error);});
    return stop;
  },[]);
  const session=snapshot?.session;
  const project=snapshot?.projects.find(p=>p.id===session?.projectId);
  const fallbackProject=snapshot?.projects.find(p=>p.id===snapshot?.sessions.find(s=>!s.archivedAt)?.projectId)??snapshot?.projects[0];
  const newChat=()=>{
    const target=project??fallbackProject;
    void send(target?{type:'session.add',projectId:target.id}:{type:'project.add'});
  };
  const openSearch=(archived=false)=>{setPage(undefined);setSearch(archived?'archived':'active');};
  const archive=(target:SessionIndex)=>{
    const running=target.status==='running';
    if(!running||window.confirm('暂停当前任务并归档会话？')) void send({type:'session.archive',id:target.id,archived:true,pauseActive:running});
  };
  const showFiles=(file?:string)=>{setFocusFile(file);setTab('files');setPanel(true);};
  const profile=snapshot?.profiles.find(p=>p.id===snapshot?.composer?.profileId)??snapshot?.profiles[0];
  const runtime=profile&&snapshot?.composer?.profileId===profile.id?compatibleRuntime(profile,snapshot.composer.runtime):{};
  const activeModel=profile?effectiveProfile(profile,runtime):undefined;
  useEffect(()=>{
    setAttached([]);setText('');setBottom(true);setPermission('full');isComposing.current=false;
    setFocusFile(undefined);
    if(transcript.current)transcript.current.scrollTop=transcript.current.scrollHeight;
  },[session?.id]);
  useEffect(()=>{
    if(bottom&&transcript.current)transcript.current.scrollTop=transcript.current.scrollHeight;
  },[session?.entries.length,session?.live,session?.approval?.id,bottom]);
  useEffect(()=>{document.documentElement.dataset.theme=snapshot?.settings.theme??'dark';},[snapshot?.settings.theme]);
  useEffect(()=>{
    const listener=(event:KeyboardEvent)=>{
      if(event.repeat||(!event.ctrlKey&&!event.metaKey))return;
      switch(event.key.toLowerCase()){
        case ',':event.preventDefault();setContextOpen(false);setMemoryOpen(false);setRename(undefined);setSearch(undefined);setPage('preferences');break;
        case 'k':event.preventDefault();setContextOpen(false);setMemoryOpen(false);setRename(undefined);openSearch();break;
        case 'n':
          if(document.querySelector('dialog[open]'))return;
          event.preventDefault();newChat();break;
      }
    };
    document.addEventListener('keydown',listener);
    return ()=>document.removeEventListener('keydown',listener);
  },[project?.id,fallbackProject?.id]);
  const running=session?.status==='running';
  const question=session?.status==='paused'?session.run?.question:undefined;
  const blockedGoal=session?.status==='paused'&&(session.run?.goalOutcome?.status==='blocked'||session.run?.review?.status==='blocked');
  const lockedMode=running||blockedGoal||Boolean(question);
  const activePermission=lockedMode?session?.run?.permission??'rules':permission;
  const canResume=session?.run&&['paused','interrupted','error'].includes(session.status);
  const submit=async()=>{
    if(!session||(!text.trim()&&!attached.length)||busy)return;
    if(text.trim()==='/context'&&!attached.length){setContextOpen(true);setText('');return;}
    if(!profile){setPage('models');return;}
    setBusy(true);
    const result=await send({type:'send',id:session.id,text:text.trim()||'请分析附加图片或文件。',mode,profileId:profile.id,attachments:attached.map(item=>item.id),runtime,permission});
    setBusy(false);
    if(result.ok){setText('');setAttached([]);setBottom(true);input.current?.focus();}
  };
  return <div className="app">
    <div className={`columns ${left?'with-left':''} ${panel?'with-right':''}`}>
      {left&&<Sidebar snapshot={snapshot} selected={session?.id} project={project} send={send} newChat={newChat} openSearch={openSearch}
        renameSession={setRename} archiveSession={archive}/>}
      <main className="main">
        <header className="workspace-heading">
          <div className="workspace-leading">
            <IconButton label={left?'隐藏项目列表':'显示项目列表'} aria-pressed={left} onClick={()=>setLeft(!left)}><PanelLeft size={18}/></IconButton>
            <div className="breadcrumb">{project?<><Folder size={15}/><small>{project.name}</small><ChevronRight size={13}/><strong title={session?.title}>{session?.title}</strong></>:<strong>Atom 工作台</strong>}</div>
          </div>
          <div className="workspace-actions">
            <IconButton label="长期记忆" onClick={()=>setMemoryOpen(true)}><BookOpen size={17}/></IconButton>
            <IconButton label="应用设置" onClick={()=>setPage('preferences')}><Settings2 size={17}/></IconButton>
            {session&&<WorkspaceMenu key={session.id} session={session} rename={()=>setRename(session)} pin={()=>void send({type:'session.pin',id:session.id,pinned:!session.pinnedAt})} archive={()=>archive(session)}/>}
            <IconButton label={panel?'隐藏检查器':'显示检查器'} aria-pressed={panel} onClick={()=>setPanel(!panel)}><PanelRight size={17}/></IconButton>
          </div>
        </header>
        <div className="transcript" ref={transcript} onScroll={e=>{const d=e.currentTarget;setBottom(d.scrollHeight-d.scrollTop-d.clientHeight<80);}}>
          {(!session?.entries.length&&!session?.live)?<div className="welcome">
            <img className="welcome-symbol" src="./atom.png" width={64} height={64} alt=""/>
            <h1>{project?'开始一个新任务':'你的本地 Agent 工作台'}</h1>
            <p>{project?'描述任务，Atom 会在当前项目中读取文件、执行工具并汇报结果。':'打开一个本地目录，在项目里交付编码与文件任务。'}</p>
            <div className="welcome-actions">
              {!project&&<button className="primary" type="button" onClick={()=>void send({type:'project.add'})}><FolderOpen size={16}/>选择工作目录<ArrowRight size={15}/></button>}
              {!profile&&<button className="secondary" type="button" onClick={()=>setPage('models')}><Settings2 size={16}/>配置模型</button>}
              {project&&profile&&<button className="primary" type="button" onClick={()=>input.current?.focus()}>编写任务<ArrowRight size={15}/></button>}
            </div>
          </div>:<div className="messages">
            {session?.entries.map((item,index)=>{
              if(item.kind==='notice')return <div className="notice" key={`${item.id}-${index}`}><CircleHelp size={14}/>{item.text}</div>;
              if(item.kind==='review')return item.review&&<ReviewDetails key={item.id} review={item.review}/>;
              if(item.kind==='plan')return item.steps&&<TaskPlan key={item.id} steps={item.steps}
                status={item.id===session.run?.planEntryId?session.status:'done'}/>;
              if(item.kind==='tool'&&item.state==='ok'&&['update_plan','ask_user','finish_goal'].includes(item.title??''))return null;
              if(item.kind==='tool')return <details className="tool-line" key={`${item.id}-${index}`}>
                <summary><Terminal size={15}/><code>{item.title}</code><span className={`tool-status ${item.state}`}>{({pending:'等待',ok:'完成',error:'失败',unknown:'待核对'})[item.state??'pending']}</span></summary>
                <pre>{pretty(item.input)}</pre><pre>{item.text}</pre>
              </details>;
              return <article className={`message ${item.kind}`} key={item.id}>
                <div className="message-label">{item.kind==='assistant'?<><img src="./atom.png" width={18} height={18} alt=""/>Atom{item.progress?' · 执行进度':''}</>:<>你</>}</div>
                {item.kind==='assistant'?<Markdown remarkPlugins={[remarkGfm]} skipHtml>{item.text}</Markdown>:<div className="user-text">{item.text}</div>}
                {item.images?.length&&<div className="message-images">{item.images.map(image=><img key={image.id} src={image.image} alt={image.name}/>)}</div>}
              </article>;
            })}
            {session?.live&&<article className="message assistant"><div className="message-label"><img src="./atom.png" width={18} height={18} alt=""/>Atom <span className="dot running"/></div><Markdown remarkPlugins={[remarkGfm]} skipHtml>{session.live}</Markdown></article>}
            {session?.approval&&<section className="approval" aria-label="工具授权">
              <h3>{session.approval.name==='remember_project'?<><BookOpen size={17}/>保存到项目长期记忆？</>:<><Terminal size={17}/>允许本次操作？</>}</h3>
              <code>{session.approval.name}</code>
              {session.approval.access==='terminal'&&<p>命令会以你的 Windows 用户权限执行。</p>}
              <pre>{pretty(session.approval.input)}</pre>
              <div className="button-row">
                <button className="secondary" type="button" onClick={()=>void send({type:'approve',id:session.id,approval:session.approval!.id,allow:false})}>拒绝</button>
                <button className="primary" type="button" onClick={()=>void send({type:'approve',id:session.id,approval:session.approval!.id,allow:true})}>允许一次</button>
              </div>
            </section>}
            {running&&!session?.live&&!session?.approval&&<div className="notice" role="status"><i className="dot running"/>{session?.meter?.kind==='review'?'正在独立验收':'任务正在执行'}</div>}
            {!running&&session&&<ChangeSummary changes={session.changes} show={showFiles}/>}
          </div>}
        </div>
        {!bottom&&<IconButton className="scroll-down" label="跳到最新消息" onClick={()=>setBottom(true)}><ArrowDown size={17}/></IconButton>}
        <div className="composer-wrap">
          {issue&&!page&&<div className="error-line" role="alert">{issue}<IconButton label="关闭错误信息" onClick={()=>setIssue('')}><X size={15}/></IconButton></div>}
          {canResume&&<div className="resume-strip">
            {question?<div className="agent-question" role="status"><strong><CircleHelp size={15}/>Agent 等待回答</strong><p id="agent-question">{question}</p></div>
              :<><span>{blockedGoal?'目标受阻，可补充信息后继续':'有可恢复的任务'}{session.run?.permission==='full'?' · 完全访问权限':''}</span><button type="button" className="secondary" onClick={()=>void send({type:'resume',id:session.id})}><Play size={14}/>继续</button></>}
            <IconButton label="结束待恢复任务" onClick={()=>void send({type:'cancel',id:session.id})}><Square size={14}/></IconButton>
          </div>}
          <form className="composer" onSubmit={event=>{event.preventDefault();void submit();}}>
            {attached.length>0&&<div className="attachments">{attached.map(file=><button key={file.id} type="button" onClick={()=>{
              setAttached(items=>items.filter(f=>f.id!==file.id));
              void send({type:'attach.remove',id:session!.id,attachmentId:file.id});
            }} title={`移除 ${file.name}`}>{file.image?<img src={file.image} alt={file.name}/>:<FileCode2 size={13}/>}<span>{file.name}</span><X size={13}/></button>)}</div>}
            <textarea ref={input} aria-label="任务指令" aria-describedby={question?'agent-question':undefined} value={text} onChange={event=>setText(event.target.value)}
              onPaste={async event=>{
                const files=Array.from(event.clipboardData.files).filter(file=>file.type.startsWith('image/'));
                if(!files.length||!session||lockedMode)return;
                event.preventDefault();
                const id=session.id;
                for(const file of files.slice(0,4)){
                  if(file.size>10*1024*1024){setIssue('图片大小需在 10 MB 以内');continue;}
                  const data=await new Promise<string>((resolve,reject)=>{
                    const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);
                    reader.onerror=()=>reject(new Error('图片读取失败'));reader.readAsDataURL(file);
                  }).catch(()=>{setIssue('图片读取失败');return '';});
                  if(!data)continue;
                  const r=await send({type:'attach.image',id,name:file.name||'粘贴的图片.png',data});
                  if(r.ok&&Array.isArray(r.data))setAttached(items=>[...items,...r.data as Attachment[]].slice(0,8));
                }
              }}
              onCompositionStart={()=>{isComposing.current=true;}} onCompositionEnd={()=>{isComposing.current=false;}}
              onKeyDown={event=>{
                if(event.key!=='Enter'||event.shiftKey||event.nativeEvent.isComposing||event.nativeEvent.keyCode===229||isComposing.current)return;
                event.preventDefault();
                if(!event.repeat)void submit();
              }}
              placeholder={!project?'打开项目后输入任务…':question?'回答问题并继续…':blockedGoal?'补充信息以继续目标…':running?'追加给 Agent 的指令…':'描述要完成的工作…'} disabled={!project}/>
            <div className="composer-actions">
              <IconButton label="添加附件" disabled={!session||lockedMode} onClick={async()=>{
                if(!session)return;
                const r=await send({type:'attach',id:session.id});
                if(r.ok&&Array.isArray(r.data))setAttached(items=>[...new Map([...items,...r.data as Attachment[]].map(item=>[item.id,item])).values()].slice(0,8));
              }}><Plus size={18}/></IconButton>
              <label className="combo" title="执行模式"><ListTodo size={15}/><select aria-label="运行模式" value={lockedMode?session?.run?.mode??mode:mode} disabled={lockedMode} onChange={event=>setMode(event.target.value as Mode)}><option value="standard">普通执行</option><option value="iterate">持续迭代</option><option value="goal">目标模式</option></select></label>
              <label className={`combo task-permission ${activePermission==='full'?'full':''}`} title={activePermission==='full'
                ?'本次任务可执行命令和修改文件，无需逐项确认。显式禁止项和长期记忆授权仍生效。':'执行前按各工具的权限规则处理。'}>
                <Shield size={15}/><select aria-label="任务权限" value={activePermission} disabled={lockedMode||busy}
                  onChange={event=>setPermission(event.target.value as TaskPermission)}>
                  <option value="full">完全访问权限</option><option value="rules">按规则审批</option>
                </select>
              </label>
              <div className="compose-spacer"/>
              <ComposerControls profiles={snapshot?.profiles??[]} profile={profile} runtime={runtime} session={session} running={Boolean(lockedMode)}
                persistence={snapshot?.settings.persistence??'standard'} changePersistence={async level=>(await send({type:'persistence.set',level})).ok}
                request={api.request} change={async choice=>{
                  const result=await send({type:'model.quick',...choice});
                  if(result.ok)setSnapshot(old=>old&&({...old,composer:choice}));
                  return result.ok;
                }} manage={()=>setPage('models')} details={()=>setContextOpen(true)}/>
              {running&&<><IconButton label="暂停任务" onClick={()=>void send({type:'pause',id:session!.id})}><Pause size={17}/></IconButton><IconButton label="取消任务" onClick={()=>void send({type:'cancel',id:session!.id})}><Square size={16}/></IconButton></>}
              <button className="send" aria-label={question?'回答并继续':running?'追加指令':'发送任务'} title="发送 · Enter" disabled={!project||(!text.trim()&&!attached.length)||busy}><ArrowUp size={19}/></button>
            </div>
          </form>
          <div className="composer-note"><span><i className="dot"/>{project?.root??'未选择工作目录'}</span><span>Enter 发送 · Shift+Enter 换行</span></div>
        </div>
      </main>
      {panel&&<aside className="inspector">
        <div className="side-heading"><span>检查器</span><IconButton label="关闭检查器" onClick={()=>setPanel(false)}><X size={16}/></IconButton></div>
        <div className="tabs" aria-label="检查器视图">{([['plan','任务'],['files','变更'],['tools','工具']] as const).map(([id,label])=>{
          const Icon=icons[id];return <button type="button" className={tab===id?'active':''} key={id} onClick={()=>setTab(id)}><Icon size={15}/>{label}</button>;
        })}</div>
        <Inspector tab={tab} session={session} send={send} focusFile={focusFile}/>
      </aside>}
    </div>
    <Statusbar session={session} profile={activeModel} openContext={()=>setContextOpen(true)}/>
    {page&&snapshot&&<SettingsDialog page={page} navigate={setPage} close={()=>setPage(undefined)} snapshot={snapshot} send={send} project={project} selectedProfile={profile?.id}/>}
    {search&&<SessionSearch key={search} archived={search==='archived'} onClose={()=>setSearch(undefined)} snapshot={snapshot} request={api.request} send={send}/>}
    {memoryOpen&&snapshot&&<MemoryDialog project={project} enabled={snapshot.settings.memoryEnabled} onClose={()=>setMemoryOpen(false)} request={api.request} revision={session?.entries.length}/>}
    {contextOpen&&<ContextDialog key={session?.id??'no-session'} session={session} request={api.request} close={()=>setContextOpen(false)}/>}
    {rename&&<RenameDialog key={rename.id} session={rename} close={()=>setRename(undefined)} save={async title=>{
      if((await send({type:'session.rename',id:rename.id,title})).ok)setRename(undefined);
    }}/>}
  </div>;
}
function WorkspaceMenu({session,rename,pin,archive}:{session:SessionView;rename:()=>void;pin:()=>void;archive:()=>void}){
  const menu=useRef<HTMLDetailsElement>(null);
  const action=(fn:()=>void)=>{if(menu.current)menu.current.open=false;fn();};
  return <details className="workspace-menu" ref={menu}
    onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))event.currentTarget.open=false;}}
    onKeyDown={event=>{if(event.key==='Escape') {event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();}}}>
    <summary className="icon-button" aria-label="当前会话操作" title="当前会话操作"><Ellipsis size={17}/></summary>
    <div className="thread-menu">
      <button type="button" onClick={()=>action(rename)}><Pencil size={15}/>重命名</button>
      <button type="button" onClick={()=>action(pin)}>{session.pinnedAt?<PinOff size={15}/>:<Pin size={15}/>} {session.pinnedAt?'取消置顶':'置顶'}</button>
      <button type="button" onClick={()=>action(archive)}><Archive size={15}/>归档</button>
    </div>
  </details>;
}
function ChangeSummary({changes,show}:{changes:SessionView['changes'];show:(file?:string)=>void}){
  const [expanded,setExpanded]=useState(false);
  const files=[...new Set(changes.filter(change=>!change.pending).map(change=>change.path))];
  if(!files.length)return null;
  return <section className="change-summary" aria-label="文件变更摘要">
    <header><FileCode2 size={18}/><strong>已编辑 {files.length} 个文件</strong><button className="secondary" type="button" onClick={()=>show()}>查看变更</button></header>
    <div>{(expanded?files:files.slice(0,3)).map(file=><button className="change-row" key={file} title={file} type="button" onClick={()=>show(file)}><span>{file}</span><ChevronRight size={14}/></button>)}</div>
    {files.length>3&&<button className="change-more" type="button" onClick={()=>setExpanded(!expanded)}>{expanded?'收起':`再显示 ${files.length-3} 个文件`}</button>}
  </section>;
}
const planStyles={
  pending:{text:'待执行',icon:CircleDashed},
  in_progress:{text:'进行中',icon:Ellipsis},
  completed:{text:'已完成',icon:Check},
  blocked:{text:'受阻',icon:CircleAlert},
  skipped:{text:'已跳过',icon:Minus},
};
function TaskPlan({steps,status}:{steps:PlanStep[];status:Status}){
  const completed=steps.filter(step=>step.status==='completed').length;
  const inactiveProgress={paused:'已暂停',interrupted:'待恢复',cancelled:'已取消',error:'未完成',done:'未完成',idle:'未执行',running:'进行中'}[status];
  return <section className="task-plan" aria-label="任务计划">
    <header><ListTodo size={16} aria-hidden="true"/><h3>任务计划</h3><span aria-live="polite">{completed} / {steps.length} 已完成</span></header>
    <ol>
      {steps.map(step=>{
        const {icon:Icon,text}=planStyles[step.status];
        const label=step.status==='in_progress'?inactiveProgress:text;
        return <li key={step.id} data-step-status={step.status} className={step.status==='in_progress'&&status==='running'?'current':''}>
          <span className="plan-step-icon"><Icon size={14} aria-hidden="true"/></span>
          <span className="plan-step-label">{step.title}{step.detail&&<small>{step.detail}</small>}</span>
          <span className="plan-step-state">{label}</span>
        </li>;
      })}
    </ol>
  </section>;
}
function ReviewDetails({review}:{review:Review}){
  const label={completed:'验收通过',continue:'验收后继续',blocked:'验收受阻'}[review.status];
  return <details className="inspect-item review-details"><summary><ListTodo size={15}/><span>{label}</span></summary>
    <p>{review.reason}</p>
    {([["剩余事项",review.remaining_items],["下一步",review.next_actions],["依据",review.evidence]] as const).map(([title,list])=>
      list.length>0&&<div key={title}><strong>{title}</strong><ul>{list.map((item,index)=><li key={index}>{item}</li>)}</ul></div>)}
  </details>;
}
function Inspector({tab,session,send,focusFile}:{tab:'plan'|'files'|'tools';session?:SessionView;send:Send;focusFile?:string}){
  const plan=session?.entries.find(item=>item.kind==='plan'&&item.id===session.run?.planEntryId);
  if(tab==='plan')return <div className="inspect-body">
    {session?.run?<><h3>任务目标</h3><p className="task-goal">{session.run.goal}</p>
      {plan?.steps&&<TaskPlan steps={plan.steps} status={session.status}/>}
      {session.run.mode==='goal'&&<div className="run-count"><span>目标模式</span><strong>{session.status==='cancelled'?'已取消':session.run.goalOutcome?.status==='achieved'?'已达成':session.run.goalOutcome?.status==='blocked'?'受阻':session.run.question?'等待回答':session.status==='running'?'执行中':'待验收'}</strong></div>}
      {session.run.goalOutcome&&<p className="task-goal">{session.run.goalOutcome.evidence}</p>}
      <div className="run-count"><span>模型请求</span><code>{session.run.calls} / {session.run.limits.maxCalls}</code></div>
      <div className="run-count"><span>已用时间</span><code>{Math.round(session.run.activeMs/1000)} / {session.run.limits.maxSeconds}s</code></div>
      {session.run.limits.persistence&&<div className="run-count"><span>执行毅力</span><code>{persistenceLabels[session.run.limits.persistence]}</code></div>}
      <div className="run-count"><span>任务 Token</span><code>{session.run.tokens?.toLocaleString()??'—'}{session.run.tokenUnknown?'+':''}{session.run.limits.maxTokens!=null?` / ${session.run.limits.maxTokens.toLocaleString()}`:''}</code></div>
      <div className="run-count"><span>已知任务费用</span><code>${session.run.spent.toFixed(4)}{session.run.limits.maxDollars!=null?` / $${session.run.limits.maxDollars}`:''}</code></div>
      {session.run.review&&<ReviewDetails review={session.run.review}/>}
      {session.run.mode==='iterate'&&<ol className="phase-list">{stages.map((stage,i)=><li key={stage} className={i===session.run!.stage?'current':''}>{i<session.run!.stage||session.status==='done'?<Check size={15}/>:<i className="dot"/>}{stage}</li>)}</ol>}
    </>:<div className="inspector-empty"><ListTodo size={21}/><strong>暂无任务</strong><span>执行进度会显示在这里</span></div>}
  </div>;
  if(tab==='files')return <div className="inspect-body">
    {session?.changes.length?<><h3>工作区修改</h3>{[...session.changes].reverse().map(change=><details className="inspect-item" key={change.id} open={focusFile===change.path||undefined}>
      <summary><FileCode2 size={15}/><span>{change.path}</span>{change.pending&&<small>待核对</small>}</summary>
      <pre className="diff-text">{change.diff.split('\n').map((line,index)=><span key={index} className={
        line.startsWith('+++')||line.startsWith('---')?'diff-meta':line.startsWith('+')?'diff-add':line.startsWith('-')?'diff-delete':line.startsWith('@@')?'diff-meta':''
      }>{line+'\n'}</span>)}</pre>
    </details>)}</>:<div className="inspector-empty"><GitBranch size={21}/><strong>暂无文件变更</strong><span>文件工具的检查点会显示在这里</span></div>}
  </div>;
  const entries=session?.entries.filter(e=>e.kind==='tool')??[];
  return <div className="inspect-body">{entries.length||session?.jobs.length?<><h3>调用与进程</h3>
    {session?.jobs.map(job=><details className="inspect-item" key={job.id}><summary><Terminal size={15}/><span>{job.command}</span><small>{job.running?'运行中':job.interrupted?'待核对':`退出 ${job.exitCode??'—'}`}</small></summary>
      <pre>{job.output||'暂无输出'}</pre>
      {job.running&&<button type="button" className="secondary" onClick={()=>void send({type:'job.stop',id:session.id,job:job.id})}><Square size={13}/>停止进程</button>}
    </details>)}
    {[...entries].reverse().map((tool,index)=><details className="inspect-item" key={tool.id+'-'+index}><summary><Wrench size={15}/><span>{tool.title}</span></summary><pre>{pretty(tool.input)}</pre><pre>{tool.text}</pre></details>)}
  </>:<div className="inspector-empty"><Wrench size={21}/><strong>暂无工具调用</strong><span>工具请求与结果会显示在这里</span></div>}</div>;
}

type ToolPolicy={name:string;access:string;alwaysAsk?:boolean};
const blankProfile=(provider:Provider='deepseek'):Profile=>({
  id:crypto.randomUUID(),name:providerNames[provider],provider,...preset[provider],effort:'off',
  timeout:60,context:provider==='deepseek'?1000000:64000,output:4096,inputPrice:null,outputPrice:null,cachePrice:null,cacheWritePrice:null,
});
function SettingsDialog({page,navigate,close,snapshot,send,project,selectedProfile}:{
  page:'models'|'preferences';navigate:(page:'models'|'preferences')=>void;close:()=>void;snapshot:Snapshot;send:Send;project?:Project;selectedProfile?:string;
}){
  const dialog=useRef<HTMLDialogElement>(null);
  const [model,setModel]=useState<Profile>(()=>snapshot.profiles.find(item=>item.id===selectedProfile)??snapshot.profiles[0]??blankProfile());
  const [key,setKey]=useState('');
  const [clear,setClear]=useState(false);
  const [prefs,setPrefs]=useState<Settings>(()=>structuredClone(snapshot.settings));
  const [prompt,setPrompt]=useState(project?.prompt??'');
  const [mcp,setMcp]=useState(pretty(snapshot.settings.mcp));
  const [policy,setPolicy]=useState(pretty(snapshot.settings.policies));
  const [known,setKnown]=useState<ToolPolicy[]>([]);
  const [feedback,setFeedback]=useState('');
  const [isBusy,setBusy]=useState(false);
  useEffect(()=>{dialog.current?.showModal();void api.tools().then(setKnown).catch(()=>{});},[]);
  const edit=(p:Profile)=>{setModel(p);setKey('');setClear(false);setFeedback('');};
  const action=async(r:Request,message:string,format?:(data:unknown)=>string)=>{
    setBusy(true);setFeedback('');
    const result=await send(r);
    setBusy(false);
    setFeedback(result.ok?(format?format(result.data):message):result.error);
    return result.ok;
  };
  const changeModel=<K extends keyof Profile>(name:K,value:Profile[K])=>setModel({...model,[name]:value});
  const save=async()=>{
    if(await action({type:'model.save',profile:model,key,clearKey:clear},'模型已保存')){
      setModel({...model,hasKey:!!key||(!clear&&model.hasKey)});
      setKey('');setClear(false);
    }
  };
  const savePrefs=async()=>{
    try{
      await action({type:'settings.save',settings:{...prefs,mcp:JSON.parse(mcp),policies:JSON.parse(policy)}},'偏好已保存');
    }catch{setFeedback('工具权限和 MCP 配置必须是有效 JSON。');}
  };
  const numeric=([['timeout','超时（秒）'],['context','上下文上限'],['output','最大输出']] as const);
  const prices=([['inputPrice','输入'],['outputPrice','输出'],['cachePrice','缓存读取'],['cacheWritePrice','缓存写入']] as const);
  return <dialog ref={dialog} className="settings" onCancel={e=>{e.preventDefault();close();}}>
    <div className="settings-top"><div><Settings2 size={19}/><h2>设置</h2></div><IconButton label="关闭设置" onClick={close}><X size={19}/></IconButton></div>
    <div className="settings-frame">
      <nav><button type="button" className={page==='models'?'selected':''} onClick={()=>navigate('models')}><img src="./atom.png" width={18} height={18} alt=""/>模型配置</button>
        <button type="button" className={page==='preferences'?'selected':''} onClick={()=>navigate('preferences')}><Settings2 size={16}/>执行与权限</button></nav>
      <div className="settings-content">
        {page==='models'?<><div className="section-heading"><h3>模型配置</h3><button className="secondary" type="button" onClick={()=>edit(blankProfile())}><Plus size={15}/>新建</button></div>
          {snapshot.profiles.length>0&&<div className="profile-list">{snapshot.profiles.map(p=><button className={p.id===model.id?'selected':''} type="button" key={p.id} onClick={()=>edit(p)}>{p.name}</button>)}</div>}
          <div className="form-grid">
            <label>供应商<select aria-label="供应商" value={model.provider} onChange={e=>{const provider=e.target.value as Provider; const next=blankProfile(provider);edit({...next,id:snapshot.profiles.some(p=>p.id===model.id)?next.id:model.id});}}>
              {Object.entries(providerNames).map(([value,title])=><option key={value} value={value}>{title}</option>)}
            </select></label>
            <label>显示名称<input value={model.name} onChange={e=>changeModel('name',e.target.value)}/></label>
            <label className="span-all">Base URL<input value={model.url} onChange={e=>changeModel('url',e.target.value)} spellCheck={false}/></label>
            <label>模型名称<input value={model.model} onChange={e=>changeModel('model',e.target.value)} spellCheck={false}/></label>
            <label>推理强度<select aria-label="推理强度" value={model.effort} onChange={e=>changeModel('effort',e.target.value as Profile['effort'])}>
              <option value="off">{model.provider==='deepseek'?'关闭':'供应商默认'}</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option>
            </select></label>
            <label className="span-all">API Key<input type="password" value={key} onChange={e=>setKey(e.target.value)} placeholder={model.hasKey?'已加密保存，留空保留':'输入供应商 API Key'} autoComplete="off" spellCheck={false}/></label>
            {model.hasKey&&<label className="checkbox span-all"><input type="checkbox" checked={clear} onChange={e=>setClear(e.target.checked)}/>保存时清除原密钥</label>}
            {numeric.map(([field,label])=><label key={field}>{label}<input type="number" step="1" value={model[field]} onChange={e=>changeModel(field,Number(e.target.value))}/></label>)}
          </div>
          <h4>每百万 Token 单价（USD）</h4>
          <div className="form-grid">{prices.map(([field,label])=><label key={field}>{label}<input type="number" min="0" step="any" value={model[field]??''} placeholder="未配置" onChange={e=>changeModel(field,e.target.value===''?null:Number(e.target.value))}/></label>)}</div>
          <div className="button-row settings-buttons">
            {snapshot.profiles.some(p=>p.id===model.id)&&<><IconButton label="删除当前模型" disabled={isBusy} onClick={async()=>{if(window.confirm('删除这项模型配置？')&&await action({type:'model.remove',id:model.id},'模型已删除'))edit(blankProfile());}}><Trash2 size={17}/></IconButton>
              <button className="secondary" type="button" disabled={isBusy} onClick={()=>void action({type:'model.test',id:model.id},'',data=>{
                const report=data as {text:string;chunks:number;input?:number;output?:number};
                return `串流成功 · ${report.chunks} 段 · IN ${report.input??'—'} · OUT ${report.output??'—'} · ${report.text}`;
              })}>测试已保存配置</button></>}
            <button className="primary" type="button" disabled={isBusy} onClick={()=>void save()}>{isBusy?'处理中…':'保存模型'}</button>
          </div>
        </>:<><h3>执行与权限</h3>
          <div className="form-grid">
            <label>主题<select aria-label="主题" value={prefs.theme} onChange={e=>setPrefs({...prefs,theme:e.target.value as Settings['theme']})}><option value="dark">深色</option><option value="light">浅色</option></select></label>
            <label>最大模型请求次数<input type="number" value={prefs.maxCalls} onChange={e=>setPrefs({...prefs,maxCalls:Number(e.target.value)})}/></label>
            <label>Token 上限<input type="number" min={1} value={prefs.maxTokens??''} placeholder="未设置" onChange={e=>setPrefs({...prefs,maxTokens:e.target.value===''?null:Number(e.target.value)})}/></label>
            <label>执行毅力<select value={prefs.persistence} onChange={e=>setPrefs({...prefs,persistence:e.target.value as Settings['persistence']})}>{Object.entries(persistenceLabels).map(([level,label])=><option key={level} value={level}>{label}</option>)}</select></label>
            <label>独立验收模型<select value={prefs.evaluatorId??''} onChange={e=>setPrefs({...prefs,evaluatorId:e.target.value||null})}><option value="">复用执行模型</option>{snapshot.profiles.map(model=><option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
            <label>任务时限（秒）<input type="number" value={prefs.maxSeconds} onChange={e=>setPrefs({...prefs,maxSeconds:Number(e.target.value)})}/></label>
            <label>费用上限（USD）<input type="number" step="any" value={prefs.maxDollars??''} placeholder="未设置" onChange={e=>setPrefs({...prefs,maxDollars:e.target.value===''?null:Number(e.target.value)})}/></label>
            <label className="span-all">全局 System Prompt<textarea rows={4} value={prefs.prompt} onChange={e=>setPrefs({...prefs,prompt:e.target.value})}/></label>
            <label className="span-all">工具权限（JSON）<textarea rows={4} value={policy} onChange={e=>setPolicy(e.target.value)} spellCheck={false}/></label>
          </div>
          <details className="help"><summary>权限键与默认行为</summary><p>权限值为 allow、ask 或 deny。单工具优先于权限类别。按规则审批时，读取默认允许，命令、删除文件和停止进程需要逐次确认。完全访问权限仍保留显式禁止和 Agent 写入记忆前的确认。</p><p>类别：read、edit、terminal、network、extension</p><code>{known.map(t=>t.name).join(' · ')}</code></details>
          <label>MCP 服务（JSON）<textarea rows={5} value={mcp} onChange={e=>setMcp(e.target.value)} spellCheck={false}/></label>
          <details className="help"><summary>MCP 配置示例</summary><p>启用 stdio 服务会在项目目录启动指定程序。</p><pre>{pretty([{name:'local',command:'node',args:['C:/mcp/server.mjs']},{name:'remote',url:'https://example.com/mcp'}])}</pre></details>
          <div className="button-row settings-buttons"><button className="primary" type="button" disabled={isBusy} onClick={()=>void savePrefs()}>保存偏好</button></div>
          {project&&<><hr/><h3>{project.name} · 项目指令</h3><label>项目 System Prompt<textarea rows={4} value={prompt} onChange={e=>setPrompt(e.target.value)}/></label>
            <div className="button-row settings-buttons"><button className="secondary" type="button" disabled={isBusy} onClick={()=>void action({type:'project.prompt',id:project.id,prompt},'项目指令已保存')}>保存项目指令</button></div></>}
        </>}
        {feedback&&<div className="feedback" role="status">{feedback}</div>}
      </div>
    </div>
  </dialog>;
}
createRoot(document.getElementById('root')!).render(<App/>);

