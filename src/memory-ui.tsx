import {useEffect,useRef,useState} from 'react';
import {BookOpen,Globe,Folder,Pin,Plus,Search,Trash2,X} from 'lucide-react';
import type {Bridge,MemoryDraft,MemoryNote,Project} from './types';

const emptyDraft:MemoryDraft={title:'',body:'',pinned:false};
export function MemoryDialog({project,enabled,onClose,request,revision}:{
  project?:Project;enabled:boolean;onClose:()=>void;request:Bridge['request'];revision?:number;
}){
  const dialog=useRef<HTMLDialogElement>(null);
  const titleBox=useRef<HTMLInputElement>(null);
  const [scope,setScope]=useState(project?'project':'global');
  const [notes,setNotes]=useState<MemoryNote[]>([]);
  const [query,setQuery]=useState('');
  const [record,setRecord]=useState<{id?:string;draft:MemoryDraft}>();
  const [failure,setFailure]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [generation,refresh]=useState(0);
  const projectId=scope==='project'?project?.id:undefined;
  useEffect(()=>{dialog.current?.showModal();},[]);
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);
    void request({type:'memory.list',projectId}).then(result=>{
      if(cancelled)return;
      setLoading(false);
      if(result.ok)setNotes(result.data as MemoryNote[]);else setFailure(result.error);
    }).catch(error=>{if(!cancelled){setLoading(false);setFailure(String(error));}});
    return ()=>{cancelled=true;};
  },[request,projectId,generation,revision]);
  useEffect(()=>{if(record&&!record.id)titleBox.current?.focus();},[Boolean(record)]);
  const visible=notes.filter(note=>!query.trim()||(note.title+' '+note.body).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updated-a.updated);
  async function action(operation:Parameters<Bridge['request']>[0],onSuccess?:()=>void) {
    setFailure('');setBusy(true);
    try{
      const result=await request(operation);
      if(result.ok){onSuccess?.();refresh(n=>n+1);}else setFailure(result.error);
    } catch(error){setFailure(String(error));}
    finally{setBusy(false);}
  }
  const selectScope=(next:string)=>{
    if(next===scope)return;
    setScope(next);setNotes([]);setLoading(true);setRecord(undefined);setQuery('');setFailure('');
  };
  return <dialog ref={dialog} className="command-dialog memory-dialog" aria-label="长期记忆" onCancel={event=>{event.preventDefault();onClose();}}>
    <div className="command-heading">
      <h2><BookOpen size={17}/>长期记忆</h2>
      <button className="icon-button" type="button" onClick={onClose} aria-label="关闭长期记忆"><X size={18}/></button>
    </div>
    <div className="memory-toolbar">
      <div className="memory-scopes" role="group" aria-label="记忆范围">
        {project&&<button type="button" aria-pressed={scope==='project'} onClick={()=>selectScope('project')} disabled={busy}><Folder size={15}/>{project.name}</button>}
        <button type="button" aria-pressed={scope==='global'} onClick={()=>selectScope('global')} disabled={busy}><Globe size={15}/>全局</button>
      </div>
      <label className="memory-toggle"><input type="checkbox" checked={enabled} onChange={event=>void action({type:'memory.toggle',enabled:event.target.checked})} disabled={busy}/>在任务中使用记忆</label>
    </div>
    <div className="memory-layout">
      <div className="memory-browser">
        <div className="memory-list-tools">
          <label><Search size={15}/><input aria-label="搜索记忆" placeholder="搜索记忆…" value={query} onChange={event=>setQuery(event.target.value)}/></label>
          <button className="icon-button" type="button" onClick={()=>{setRecord({draft:{...emptyDraft}});setFailure('');}} aria-label="新建记忆" title="新建记忆" disabled={busy}><Plus size={19}/></button>
        </div>
        {!loading&&visible.length===0&&<p className="memory-empty">{query.trim()?'没有匹配的记忆':'这个范围还没有记忆'}</p>}
        {visible.map(note=><button className={record?.id===note.id?'chosen':''} type="button" key={note.id} disabled={busy}
          onClick={()=>{setRecord({id:note.id,draft:{title:note.title,body:note.body,pinned:note.pinned}});setFailure('');}}>
          {note.pinned?<Pin size={14}/>:<BookOpen size={14}/>}
          <span><strong>{note.title}</strong><small>{note.sourceSessionId?'会话建议 · ':''}{note.body}</small></span>
        </button>)}
      </div>
      {record?<form className="memory-editor" onSubmit={event=>{
        event.preventDefault();
        if(!record.draft.title.trim()||!record.draft.body.trim()||busy)return;
        void action({type:'memory.save',id:record.id,projectId,...record.draft},()=>setRecord(undefined));
      }}>
        <label>标题<input ref={titleBox} value={record.draft.title} onChange={event=>setRecord({...record,draft:{...record.draft,title:event.target.value}})} maxLength={80} required/></label>
        <label>内容<textarea value={record.draft.body} onChange={event=>setRecord({...record,draft:{...record.draft,body:event.target.value}})} maxLength={1800} rows={7} required/></label>
        <label className="memory-check"><input type="checkbox" checked={record.draft.pinned} onChange={event=>setRecord({...record,draft:{...record.draft,pinned:event.target.checked}})}/>优先召回</label>
        <div className="memory-actions">
          {record.id&&<button aria-label="删除记忆" title="删除记忆" className="icon-button" type="button" disabled={busy} onClick={()=>{
            if(window.confirm('删除这条长期记忆？'))void action({type:'memory.remove',id:record.id!,projectId},()=>setRecord(undefined));
          }}><Trash2 size={17}/></button>}
          <button type="submit" className="primary" disabled={busy||!record.draft.title.trim()||!record.draft.body.trim()}>保存记忆</button>
        </div>
      </form>:<div className="memory-guide"><BookOpen size={25}/><p>{scope==='project'?'该项目的新会话可召回这里的约定和决定。':'所有项目的会话都可召回这里的偏好。'}</p></div>}
    </div>
    <footer className="memory-footnote">记忆保存在本机。被召回的条目会随任务发送给所选模型。</footer>
    {failure&&<div className="memory-message" role="alert">{failure}</div>}
  </dialog>;
}

