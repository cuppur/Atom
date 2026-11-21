import {useEffect,useMemo,useRef,useState} from 'react';
import {Archive,ArchiveRestore,ChevronDown,ChevronRight,Clock3,Ellipsis,Folder,FolderOpen,MessageSquare,Pencil,Pin,PinOff,Plus,Search,X} from 'lucide-react';
import type {Bridge,Project,SessionIndex,SessionMatch,Snapshot} from './types';

type Action=Bridge['request'];
type SidebarProps={
  snapshot?:Snapshot; project?:Project; selected?:string; send:Action;
  newChat:()=>void; openSearch:(archived?:boolean)=>void; renameSession:(s:SessionIndex)=>void;
  archiveSession:(s:SessionIndex)=>void;
};
function initialGroups():Record<string,boolean>{
  try {return JSON.parse(localStorage.getItem('atom.project-groups')??'{}')??{};}
  catch{return {};}
}
export function Sidebar({snapshot,project,selected,send,newChat,openSearch,renameSession,archiveSession}:SidebarProps){
  const [collapsed,setCollapsed]=useState(initialGroups);
  const [menu,setMenu]=useState<string>();
  const [recent,setRecent]=useState(false);
  const active=(snapshot?.sessions??[]).filter(s=>!s.archivedAt);
  const pinned=active.filter(s=>s.pinnedAt).sort((a,b)=>b.pinnedAt!-a.pinnedAt!);
  const groups=new Map<string,SessionIndex[]>();
  for(const session of active){
    const group=groups.get(session.projectId)??[];
    group.push(session);groups.set(session.projectId,group);
  }
  const projects=[...(snapshot?.projects??[])].sort((a,b)=>(groups.get(b.id)?.[0].updated??0)-(groups.get(a.id)?.[0].updated??0));
  const archived=snapshot?.sessions.filter(s=>s.archivedAt).length??0;
  const toggle=(id:string)=>{
    const next={...collapsed,[id]:!collapsed[id]};
    setCollapsed(next);
    try {localStorage.setItem('atom.project-groups',JSON.stringify(next));} catch {}
  };
  const select=(id:string)=>{setMenu(undefined);void send({type:'select',id});};
  const row=(s:SessionIndex,pinnedGroup:boolean)=><SessionRow key={s.id} session={s} project={snapshot?.projects.find(p=>p.id===s.projectId)}
    pinnedGroup={pinnedGroup} selected={selected===s.id} menu={menu===s.id}
    showMenu={()=>setMenu(menu===s.id?undefined:s.id)} closeMenu={()=>setMenu(undefined)} select={()=>select(s.id)}
    rename={()=>{setMenu(undefined);renameSession(s);}}
    pin={()=>{setMenu(undefined);void send({type:'session.pin',id:s.id,pinned:!s.pinnedAt});}}
    archive={()=>{setMenu(undefined);archiveSession(s);}}/>;
  return <aside className="sidebar" aria-label="项目与会话">
    <div className="sidebar-top"><span className="workspace-brand"><img src="./atom.png" width={24} height={24} alt=""/><strong>工作区</strong></span><button type="button" className="icon-button" aria-label="搜索会话" title="搜索会话 · Ctrl+K" onClick={()=>openSearch()}><Search size={16}/></button></div>
    <nav className="side-actions" aria-label="会话操作">
      <button className="sidebar-action" type="button" aria-keyshortcuts="Control+N" onClick={newChat}>
        <Plus size={17}/><span>新会话</span><kbd>Ctrl N</kbd>
      </button>
    </nav>
    <div className="project-list">
      {pinned.length>0&&<section className="pinned-group" aria-label="已置顶">
        <div className="side-heading"><span>已置顶</span></div>
        {pinned.map(s=>row(s,true))}
      </section>}
      <div className="sidebar-views" role="group" aria-label="会话列表视图">
        <button type="button" aria-pressed={!recent} onClick={()=>setRecent(false)}><Folder size={14}/>项目</button>
        <button type="button" aria-pressed={recent} onClick={()=>setRecent(true)}><Clock3 size={14}/>最近</button>
        <button className="icon-button" type="button" aria-label="添加项目" title="添加项目" onClick={()=>void send({type:'project.add'})}><FolderOpen size={15}/></button>
      </div>
      {recent?<section aria-label="最近会话" className="recent-threads">
        {active.filter(s=>!s.pinnedAt).map(s=>row(s,false))}
        {active.every(s=>s.pinnedAt)&&<p className="memory-empty">暂无最近会话</p>}
      </section>:<section aria-label="项目">
        {!projects.length&&<button className="sidebar-action empty-projects" type="button" onClick={()=>void send({type:'project.add'})}><Folder size={15}/><span>打开本地目录</span></button>}
        {projects.map(p=><div key={p.id} className="project-group">
          <div className={'project-row'+(project?.id===p.id?' current-project':'')}>
            <button className="project-title" type="button" aria-expanded={!collapsed[p.id]} onClick={()=>toggle(p.id)} title={p.root}>
              {collapsed[p.id]?<ChevronRight size={13}/>:<ChevronDown size={13}/>}<Folder size={15}/><span>{p.name}</span>
            </button>
            <button className="icon-button" type="button" aria-label={`在 ${p.name} 中新建会话`} title="在项目中新建会话" onClick={()=>{if(collapsed[p.id])toggle(p.id);void send({type:'session.add',projectId:p.id});}}><Plus size={15}/></button>
          </div>
          {!collapsed[p.id]&&(groups.get(p.id)??[]).filter(s=>!s.pinnedAt).map(s=>row(s,false))}
        </div>)}
      </section>}
    </div>
    <div className="side-footer">
      <button className="sidebar-action" type="button" onClick={()=>openSearch(true)}><Archive size={16}/><span>已归档</span>{archived>0&&<small>{archived}</small>}</button>
    </div>
  </aside>;
}
function SessionRow({session,project,pinnedGroup,selected,menu,showMenu,closeMenu,select,rename,pin,archive}:{
  session:SessionIndex;project?:Project;pinnedGroup:boolean;selected:boolean;menu:boolean;
  showMenu:()=>void;closeMenu:()=>void;select:()=>void;rename:()=>void;pin:()=>void;archive:()=>void;
}){
  const row=useRef<HTMLDivElement>(null);
  const popover=useRef<HTMLDivElement>(null);
  const more=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!menu)return;
    popover.current?.querySelector('button')?.focus();
    const outside=(event:PointerEvent)=>{if(!row.current?.contains(event.target as Node))closeMenu();};
    document.addEventListener('pointerdown',outside);return ()=>document.removeEventListener('pointerdown',outside);
  },[menu]);
  const waiting=['paused','interrupted','error'].includes(session.status);
  return <div ref={row} className={`sidebar-thread ${pinnedGroup?'pinned-thread':''} ${selected?'selected':''} ${menu?'has-menu':''}`}>
    <button className="session-row" type="button" aria-current={selected?'page':undefined}
      title={[project?.name,session.title].filter(Boolean).join(' / ')} onClick={select}
      onContextMenu={event=>{event.preventDefault();if(!menu)showMenu();}}>
      {pinnedGroup?<Pin size={13}/>:<MessageSquare size={14}/>}<span>{session.title}</span>
      {(waiting||session.status==='running')&&<i className={`dot ${session.status}`} title={waiting?'任务可恢复':'任务运行中'}/>}
    </button>
    <button ref={more} className="thread-more icon-button" type="button" aria-expanded={menu} aria-label={`${session.title}的更多操作`} onClick={showMenu}><Ellipsis size={16}/></button>
    {menu&&<div ref={popover} aria-label="会话管理" className="thread-menu" onKeyDown={event=>{
      if(event.key==='Escape'){event.stopPropagation();closeMenu();more.current?.focus();}
    }}>
      <button type="button" onClick={pin}>{session.pinnedAt?<PinOff size={14}/>:<Pin size={14}/>} {session.pinnedAt?'取消置顶':'置顶'}</button>
      <button type="button" onClick={rename}><Pencil size={14}/>重命名</button>
      <button type="button" onClick={archive}><Archive size={14}/>归档</button>
    </div>}
  </div>;
}
export function RenameDialog({session,close,save}:{session:SessionIndex;close:()=>void;save:(title:string)=>Promise<void>}){
  const dialog=useRef<HTMLDialogElement>(null);
  const input=useRef<HTMLInputElement>(null);
  const [title,setTitle]=useState(session.title);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{dialog.current?.showModal();input.current?.select();},[]);
  return <dialog ref={dialog} className="command-dialog" onCancel={e=>{e.preventDefault();close();}} aria-label="重命名会话">
    <form onSubmit={async event=>{event.preventDefault();if(!title.trim()||busy)return;setBusy(true);try{await save(title.trim());}finally{setBusy(false);}}}>
      <div className="command-heading"><h2>重命名会话</h2><button type="button" className="icon-button" aria-label="关闭重命名" onClick={close}><X size={17}/></button></div>
      <div className="rename-fields"><input ref={input} aria-label="会话名称" value={title} onChange={event=>setTitle(event.target.value)} maxLength={100} required/>
        <button className="primary" type="submit" disabled={!title.trim()||busy}>保存名称</button></div>
    </form>
  </dialog>;
}
export function SessionSearch({archived,onClose,snapshot,request,send}:{
  archived:boolean;onClose:()=>void;snapshot?:Snapshot;request:Action;send:Action;
}){
  const dialog=useRef<HTMLDialogElement>(null);
  const input=useRef<HTMLInputElement>(null);
  const list=useRef<HTMLDivElement>(null);
  const [query,setQuery]=useState('');
  const [matches,setMatches]=useState<SessionMatch[]>([]);
  const [issue,setIssue]=useState('');
  const [busy,setBusy]=useState(false);
  const [working,setWorking]=useState<string>();
  const local=useMemo(()=>snapshot?.sessions.filter(s=>Boolean(s.archivedAt)===archived)??[],[snapshot?.sessions,archived]);
  useEffect(()=>{dialog.current?.showModal();input.current?.focus();},[]);
  useEffect(()=>{
    const text=query.trim();
    if(!text){setBusy(false);setIssue('');return;}
    let stale=false;
    setBusy(true);
    const timer=setTimeout(()=>{
      void request({type:'session.search',query:text,archived}).then(result=>{
        if(stale)return;
        setIssue(result.ok?'':result.error);setMatches(result.ok?result.data as SessionMatch[]:[]);setBusy(false);
      }).catch(error=>{if(!stale){setIssue(String(error));setBusy(false);}});
    },140);
    return ()=>{stale=true;clearTimeout(timer);};
  },[query,archived,request]);
  const results:SessionMatch[]=(query.trim()?(busy?[]:matches.filter(s=>local.some(x=>x.id===s.id))):local).slice(0,100);
  const choose=async(s:SessionMatch)=>{
    setWorking(s.id);
    try {
      if(archived){
        const restored=await send({type:'session.archive',id:s.id,archived:false});
        if(!restored.ok){setIssue(restored.error);return;}
      }
      const selected=await send({type:'select',id:s.id});
      if(selected.ok)onClose();else setIssue(selected.error);
    }finally{setWorking(undefined);}
  };
  return <dialog ref={dialog} className="command-dialog" onCancel={e=>{e.preventDefault();onClose();}}
    aria-label={archived?'已归档会话':'搜索会话'}
    onKeyDown={event=>{
      if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;
      const items=Array.from(list.current?.querySelectorAll('button:enabled')??[]) as HTMLButtonElement[];
      if(!items.length)return;
      event.preventDefault();
      const index=items.indexOf(document.activeElement as HTMLButtonElement)+(event.key==='ArrowDown'?1:-1);
      if(index<0)input.current?.focus();else(items[index]??items.at(-1))?.focus();
    }}>
    <div className="command-heading"><h2>{archived?'已归档会话':'搜索会话'}</h2><button type="button" className="icon-button" aria-label="关闭会话搜索" onClick={onClose}><X size={17}/></button></div>
    <label className="query-input"><Search size={17}/><input ref={input} aria-label="搜索关键词" value={query} onChange={event=>setQuery(event.target.value)}
      onKeyDown={event=>{if(event.key==='Enter'&&results.length&&!working){event.preventDefault();void choose(results[0]);}}}
      maxLength={160} placeholder="搜索标题、项目和对话…"/></label>
    <div className="search-results" ref={list}>
      {issue&&<p role="alert">{issue}</p>}
      {busy?<p role="status">搜索中…</p>:!results.length&&!issue?<p>{query?'没有匹配的会话':archived?'暂无归档会话':'暂无会话'}</p>:results.map(s=><button type="button" key={s.id}
        disabled={Boolean(working)} className="search-result" onClick={()=>void choose(s)}>
        {archived?<ArchiveRestore size={17}/>:<MessageSquare size={16}/>}
        <span><strong>{s.title}</strong><small>{snapshot?.projects.find(p=>p.id===s.projectId)?.name}{s.excerpt?' · '+s.excerpt:''}</small></span>
        {archived&&<small>恢复并打开</small>}
      </button>)}
    </div>
  </dialog>;
}

