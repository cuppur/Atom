import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, safeStorage } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from './store';
import { Engine, newSession, planToolName, goalToolName, questionToolName } from './engine';
import { MemoryBank, memoryFields } from './memory';
import { effectiveProfile } from './model-options';
import { streamModel } from './models';
import { builtins } from './extensions';
import { guarded, readText } from './workspace';
import { ellipsizeError } from './errors';
import { contextPresets, type ComposerModel, type ModelRuntime, type Profile, type Project, type Session, type SessionIndex, type Settings, type Snapshot } from './types';

protocol.registerSchemesAsPrivileged([{scheme:'atom',privileges:{standard:true,secure:true}}]);
app.setAppUserModelId('local.atom.desktop');
if(!app.requestSingleInstanceLock()) app.quit();

const id=z.uuid();
const str=z.string().max(64000);
const price=z.number().nonnegative().nullable();
const endpoint=z.url().refine(value=>{
  const url=new URL(value);
  return !url.username&&!url.password&&!url.search&&!url.hash &&
    (url.protocol==='https:' || url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname));
},'服务地址需要使用 HTTPS，本机服务可用 HTTP');
const profileSchema=z.object({
  id,name:z.string().trim().min(1).max(80),provider:z.enum(['openai','anthropic','gemini','compatible','deepseek']),
  url:endpoint,model:z.string().trim().min(1).max(160),effort:z.enum(['off','low','medium','high']),
  timeout:z.number().int().min(5).max(600),context:z.number().int().min(4096).max(4000000),
  output:z.number().int().min(32).max(100000),inputPrice:price,outputPrice:price,cachePrice:price,cacheWritePrice:price,
}).refine(p=>p.output<p.context,'最大输出必须小于上下文上限');
const runtimeSchema=z.object({
  model:z.string().trim().min(1).max(160).optional(),
  effort:z.enum(['off','low','medium','high']).optional(),
  context:z.literal(contextPresets).optional(),
});
const settingsSchema=z.object({
  theme:z.enum(['dark','light']),prompt:str,
  memoryEnabled:z.boolean(),
  persistence:z.enum(['off','standard','high','extreme']),evaluatorId:id.nullable(),maxTokens:z.number().int().positive().max(100000000).nullable(),
  policies:z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),z.enum(['allow','ask','deny'])),
  maxCalls:z.number().int().min(1).max(300),maxSeconds:z.number().int().min(5).max(86400),
  maxDollars:z.number().positive().nullable(),
  mcp:z.array(z.object({
    name:z.string().regex(/^[a-zA-Z0-9_-]{1,24}$/),url:endpoint.optional(),
    command:z.string().trim().min(1).max(1024).optional(),args:z.array(z.string().max(1024)).max(30).optional(),
  }).refine(p=>Boolean(p.url)!==Boolean(p.command),'请选择 MCP 的 URL 或可执行程序')).max(12)
    .refine(p=>p.length===new Set(p.map(x=>x.name)).size,'MCP 服务名称必须唯一'),
});
const commands=z.discriminatedUnion('type',[
  z.object({type:z.literal('snapshot')}),
  z.object({type:z.literal('persistence.set'),level:settingsSchema.shape.persistence}),
  z.object({type:z.literal('select'),id:id.optional()}),
  z.object({type:z.literal('project.add')}),
  z.object({type:z.literal('project.prompt'),id,prompt:str}),
  z.object({type:z.literal('session.add'),projectId:id}),
  z.object({type:z.literal('session.rename'),id,title:z.string().trim().min(1).max(100)}),
  z.object({type:z.literal('session.pin'),id,pinned:z.boolean()}),
  z.object({type:z.literal('session.archive'),id,archived:z.boolean(),pauseActive:z.boolean().optional()}),
  z.object({type:z.literal('session.search'),query:z.string().trim().max(160),archived:z.boolean()}),
  z.object({type:z.literal('memory.list'),projectId:id.optional()}),
  z.object({type:z.literal('memory.save'),id:id.optional(),projectId:id.optional(),pinned:z.boolean(),...memoryFields}),
  z.object({type:z.literal('memory.remove'),id,projectId:id.optional()}),
  z.object({type:z.literal('memory.toggle'),enabled:z.boolean()}),
  z.object({type:z.literal('context.list'),id}),
  z.object({type:z.literal('context.read'),id,traceId:id}),
  z.object({type:z.literal('settings.save'),settings:settingsSchema}),
  z.object({type:z.literal('model.save'),profile:profileSchema,key:z.string().max(4096).optional(),clearKey:z.boolean().optional()}),
  z.object({type:z.literal('model.remove'),id}),
  z.object({type:z.literal('model.test'),id,runtime:runtimeSchema.optional()}),
  z.object({type:z.literal('model.quick'),profileId:id,runtime:runtimeSchema}),
  z.object({type:z.literal('attach'),id}),
  z.object({type:z.literal('send'),id,text:str,mode:z.enum(['standard','iterate','goal']),profileId:id,attachments:z.array(z.string().max(1024)).max(8),
    runtime:runtimeSchema.optional(),permission:z.enum(['rules','full']).optional()}),
  z.object({type:z.enum(['pause','resume','cancel']),id}),
  z.object({type:z.literal('approve'),id,approval:id,allow:z.boolean()}),
  z.object({type:z.literal('job.stop'),id,job:id}),
]);

const startPage='atom://app/index.html';
const windowsChrome=process.platform==='win32';
function titleBar(theme:Settings['theme']) {
  return {height:42,color:theme==='dark'?'#14171c':'#f8fafc',symbolColor:theme==='dark'?'#c0c9d7':'#465772'};
}
let win:BrowserWindow|null=null;
let quitting=false;
let closed=false;
let store:Store;
let engine:Engine;
let memory:MemoryBank;
let sessions:Session[];
let projects:Project[];
let profiles:ReturnType<Store['profiles']>;
let composer:ComposerModel|undefined;
let settings:ReturnType<Store['settings']>;
let selected:string|undefined;
let timer: ReturnType<typeof setTimeout>|undefined;
let testing=false;
const attachments=new Map<string,Set<string>>();

function getSession(sid:string) {
  const s=sessions.find(value=>value.id===sid);
  if(!s) throw new Error('会话不存在');
  return s;
}
function getProject(pid:string) {
  const p=projects.find(value=>value.id===pid);
  if(!p) throw new Error('项目不存在');
  return p;
}
function getProfile(pid:string,runtime?:ModelRuntime) {
  const p=profiles.find(value=>value.profile.id===pid);
  if(!p) throw new Error('请先添加模型配置');
  const key=decrypt(p);
  if(!key && (p.profile.provider!=='compatible'||new URL(p.profile.url).protocol!=='http:')) throw new Error('请先配置此模型的 API Key');
  return {profile:effectiveProfile(p.profile,runtime),key:key??'atom-local'};
}
function decrypt(record: {encrypted?:string}) {
  if(!record.encrypted) return undefined;
  return safeStorage.decryptString(Buffer.from(record.encrypted,'base64'));
}
function indexOf({id,projectId,title,status,updated,pinnedAt,archivedAt}:Session):SessionIndex {
  return {id,projectId,title,status,updated,pinnedAt,archivedAt};
}
function orderedSessions(){
  return [...sessions].sort((a,b)=>b.updated-a.updated);
}
function select(id?:string) {
  selected=id;
  store.saveSelection(id);
}
function searchSessions(query:string,archived:boolean) {
  const term=query.toLocaleLowerCase();
  return orderedSessions().filter(s=>Boolean(s.archivedAt)===archived).flatMap(s=>{
    const index=indexOf(s);
    if(!term||s.title.toLocaleLowerCase().includes(term)||getProject(s.projectId).name.toLocaleLowerCase().includes(term)) return [index];
    for(let i=s.entries.length-1;i>=0;i--) {
      const entry=s.entries[i];
      if(entry.kind!=='user'&&entry.kind!=='assistant') continue;
      const text=entry.text.replace(/\s+/g,' ');
      const offset=text.toLocaleLowerCase().indexOf(term);
      if(offset<0) continue;
      const from=Math.max(0,offset-30);
      return [{...index,excerpt:(from?'…':'')+text.slice(from,offset+term.length+50)+(text.length>offset+term.length+50?'…':'')}];
    }
    return [];
  }).slice(0,100);
}
function snapshot():Snapshot {
  const s=sessions.find(value=>value.id===selected);
  return {projects,sessions:orderedSessions().map(indexOf),
    profiles:profiles.map(({profile,encrypted})=>({...profile,hasKey:!!encrypted})),settings,composer,session:s?engine.view(s):undefined};
}
function notify() {
  if(timer) return;
  timer=setTimeout(()=>{
    timer=undefined;
    if(win&&!win.isDestroyed()&&win.webContents.getURL()===startPage) win.webContents.send('atom:update',snapshot());
  },65);
}
function createSession(projectId:string) {
  getProject(projectId);
  const s=newSession(projectId);
  sessions.unshift(s);engine.save(s);select(s.id);
  return s.id;
}
function requireProjectSlot(s:Session) {
  if(sessions.some(other=>other.id!==s.id&&other.projectId===s.projectId&&engine.isActive(other.id))) {
    throw new Error('该项目已有任务在运行');
  }
}
function requireMain(e:Electron.IpcMainInvokeEvent) {
  const frame=e.senderFrame;
  if(!win||win.webContents!==e.sender||!frame||frame.parent||frame.url!==startPage) throw new Error('IPC 来源无效');
}

app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
app.whenReady().then(async()=>{
  const home=app.getPath('userData');
  store=new Store(path.join(home,'atom.sqlite'));
  store.recoverContexts();
  projects=store.projects();sessions=store.sessions();profiles=store.profiles();settings=store.settings();composer=store.composer();
  memory=new MemoryBank(store,()=>settings.memoryEnabled,value=>engine.redact(value));
  engine=new Engine(store,home,notify,()=>profiles.flatMap(p=>{
    try {const secret=decrypt(p);return secret?[secret]:[];} catch {return [];}
  }),undefined,memory,getProfile);
  for(const s of sessions) engine.repair(s);
  const last=store.selected();
  selected=last===null?undefined:sessions.find(s=>s.id===last&&!s.archivedAt)?.id??orderedSessions().find(s=>!s.archivedAt)?.id;
  protocol.handle('atom',req=>{
    const url=new URL(req.url);
    if(url.host!=='app'||!['/index.html','/ui.js','/ui.css','/atom.png'].includes(url.pathname)) return new Response(null,{status:404});
    return net.fetch(pathToFileURL(path.join(import.meta.dirname,url.pathname.slice(1))).href);
  });
  ipcMain.handle('atom:request',async(e,raw:unknown)=>{
    try {
      requireMain(e);
      if(quitting) throw new Error('应用正在关闭');
      const req=commands.parse(raw);
      let data:unknown;
      switch(req.type){
        case 'snapshot': data=snapshot();break;
        case 'select':
          if(req.id&&getSession(req.id).archivedAt) throw new Error('请先恢复归档会话');
          select(req.id);data=snapshot();break;
        case 'project.add': {
          const res=await dialog.showOpenDialog(win!,{properties:['openDirectory'],title:'选择项目工作目录'});
          if(res.canceled)break;
          const root=await realpath(res.filePaths[0]);
          const existing=projects.find(p=>p.root.toLowerCase()===root.toLowerCase());
          const project=existing??{id:randomUUID(),name:path.basename(root)||root,root,prompt:''};
          if(!existing) {store.project(project);projects.push(project);}
          data=createSession(project.id);break;
        }
        case 'project.prompt': {
          const project=getProject(req.id);
          project.prompt=engine.redact(req.prompt);store.project(project);break;
        }
        case 'session.add': data=createSession(req.projectId);break;
        case 'session.rename': {
          const s=getSession(req.id);
          s.title=engine.redact(req.title);store.session(s);break;
        }
        case 'session.pin': {
          const s=getSession(req.id);
          if(s.archivedAt) throw new Error('请先恢复归档会话');
          if(req.pinned)s.pinnedAt=Date.now();else delete s.pinnedAt;
          store.session(s);break;
        }
        case 'session.archive': {
          const s=getSession(req.id);
          if(req.archived && engine.isActive(s.id)) {
            if(!req.pauseActive) throw new Error('先确认暂停正在运行的任务');
            await engine.stop(s,'pause');
          }
          if(req.archived)s.archivedAt=Date.now();else delete s.archivedAt;
          store.session(s);
          if(req.archived&&s.id===selected){
            const remaining=orderedSessions().filter(item=>!item.archivedAt);
            select((remaining.find(item=>item.projectId===s.projectId)??remaining[0])?.id);
          }
          break;
        }
        case 'session.search': data=searchSessions(req.query,req.archived);break;
        case 'context.list':
          getSession(req.id);
          return {ok:true,data:store.contextList(req.id)};
        case 'context.read':
          getSession(req.id);
          data=store.contextRead(req.id,req.traceId);
          if(!data)throw new Error('此会话中未找到该请求');
          return {ok:true,data};
        case 'memory.list':
          if(req.projectId)getProject(req.projectId);
          data=memory.list(req.projectId);break;
        case 'memory.save':
          if(req.projectId)getProject(req.projectId);
          data=memory.save(req,req).note;break;
        case 'memory.remove':
          if(req.projectId)getProject(req.projectId);
          memory.remove(req.id,req.projectId);break;
        case 'memory.toggle':
          settings={...settings,memoryEnabled:req.enabled};store.saveSettings(settings);break;
        case 'persistence.set': {
          settings={...settings,persistence:req.level};store.saveSettings(settings);break;
        }
        case 'settings.save': {
          if(req.settings.evaluatorId)getProfile(req.settings.evaluatorId);
          const themeChanged=settings.theme!==req.settings.theme;
          settings={...req.settings,prompt:engine.redact(req.settings.prompt)};
          store.saveSettings(settings);
          if(windowsChrome&&themeChanged)win?.setTitleBarOverlay(titleBar(settings.theme));
          break;
        }
        case 'model.save': {
          const prior=profiles.find(p=>p.profile.id===req.profile.id);
          if(prior && sessions.some(s=>engine.isActive(s.id) && s.run?.profileId===req.profile.id)) throw new Error('任务正在使用这项模型配置');
          if(prior && (prior.profile.provider!==req.profile.provider || prior.profile.model!==req.profile.model ||
            prior.profile.url!==req.profile.url.replace(/\/+$/,'')) && sessions.some(s=>
              s.run?.profileId===req.profile.id&&['paused','interrupted','error'].includes(s.status))) throw new Error('待恢复任务正在使用该端点和模型');
          let encrypted=req.clearKey?undefined:prior?.encrypted;
          const key=req.key?.trim();
          if(key) {
            if(!safeStorage.isEncryptionAvailable()) throw new Error('Windows 加密存储当前不可用');
            encrypted=safeStorage.encryptString(key).toString('base64');
          } else if(encrypted && prior && new URL(prior.profile.url).origin!==new URL(req.profile.url).origin) {
            throw new Error('更改服务域名时，请重新输入或清除该密钥');
          }
          const profile:Profile={...req.profile,url:req.profile.url.replace(/\/+$/,'')};
          store.profile(profile,encrypted);profiles=store.profiles();break;
        }
        case 'model.remove':
          if(settings.evaluatorId===req.id || sessions.some(s=>engine.isActive(s.id)&&s.run?.limits.evaluatorId===req.id)) throw new Error('请先切换独立验收模型，并等待正在验收的任务结束');
          if(sessions.some(s=>s.run?.profileId===req.id && ['running','paused','interrupted','error'].includes(s.status))) throw new Error('有待处理任务正在使用此配置');
          store.removeProfile(req.id);profiles=store.profiles();break;
        case 'model.quick': {
          const record=profiles.find(p=>p.profile.id===req.profileId);
          if(!record)throw new Error('模型配置不存在');
          effectiveProfile(record.profile,req.runtime);
          composer={profileId:req.profileId,runtime:req.runtime};
          store.saveComposer(composer);data=composer;break;
        }
        case 'model.test': {
          if(testing)throw new Error('已有连接测试正在运行');
          const {profile,key}=getProfile(req.id,req.runtime);
          testing=true;
          try {
            let chunks=0;
            const result=await streamModel({profile,key,signal:AbortSignal.timeout(profile.timeout*1000),system:'',
              messages:[{role:'user',content:'Reply with only OK.'}],tools:new Map(),output:Math.min(512,profile.output),onText:()=>chunks++});
            if(!chunks)throw new Error('连接已响应，模型没有返回文本流');
            data={text:engine.redact(result.text.slice(0,500)),chunks,input:result.usage.inputTokens,output:result.usage.outputTokens};
          } finally {testing=false;}
          break;
        }
        case 'attach': {
          const s=getSession(req.id);const project=getProject(s.projectId);
          const res=await dialog.showOpenDialog(win!,{defaultPath:project.root,properties:['openFile','multiSelections'],title:'添加工作区文本文件'});
          if(res.canceled)break;
          const picked=await Promise.all(res.filePaths.slice(0,8).map(async abs=>{
            const relative=path.relative(project.root,abs);
            const file=await guarded(project.root,relative);
            await readText(file,48000);
            return relative;
          }));
          const granted=attachments.get(s.id)??new Set<string>();
          for(const relative of picked) granted.add(relative);
          attachments.set(s.id,granted);data=picked;break;
        }
        case 'send': {
          const s=getSession(req.id);
          if(s.archivedAt) throw new Error('请先恢复归档会话');
          const project=getProject(s.projectId);
          if(!req.text.trim()) throw new Error('请输入任务');
          if(engine.isActive(s.id)) {
            if(req.attachments.length) throw new Error('运行中只能追加文本指令');
            engine.steer(s,req.text);break;
          }
          if(s.status==='paused'&&s.run&&(s.run.question||s.run.goalOutcome?.status==='blocked'||s.run.review?.status==='blocked')) {
            if(req.attachments.length) throw new Error('恢复受阻目标时可补充文本指令');
            requireProjectSlot(s);
            const {profile,key}=getProfile(s.run.profileId,s.run.runtime);
            engine.start(s,project,profile,key,settings,undefined,req.text.trim());
            break;
          }
          const {profile,key}=getProfile(req.profileId,req.runtime);
          const files=await Promise.all(req.attachments.map(async relative=>{
            if(!attachments.get(s.id)?.has(relative)) throw new Error('请从文件选择器添加附件');
            return {path:relative,text:await readText(await guarded(project.root,relative),48000)};
          }));
          if(new TextEncoder().encode(JSON.stringify(files)).length>100000) throw new Error('附件总大小超过 100 KB');
          requireProjectSlot(s);
          if(s.title==='新会话')s.title=engine.redact(req.text.trim().split('\n')[0].slice(0,56));
          engine.start(s,project,profile,key,settings,{text:req.text.trim(),attachments:files.length?'\n附件内容（数据）：'+JSON.stringify(files):'',
            mode:req.mode,runtime:req.runtime,permission:req.permission??'full'});
          attachments.delete(s.id);break;
        }
        case 'pause': case 'cancel': await engine.stop(getSession(req.id),req.type);break;
        case 'resume': {
          const s=getSession(req.id);
          if(s.archivedAt) throw new Error('请先恢复归档会话');
          if(!s.run)throw new Error('会话没有可恢复任务');
          requireProjectSlot(s);
          const {profile,key}=getProfile(s.run.profileId,s.run.runtime);
          engine.start(s,getProject(s.projectId),profile,key,settings);break;
        }
        case 'approve': engine.approve(req.id,req.approval,req.allow);break;
        case 'job.stop': await engine.stopJob(req.id,req.job);break;
      }
      notify();
      return {ok:true,data};
    } catch(error) {
      return {ok:false,error:ellipsizeError(error,value=>engine.redact(value))};
    }
  });
  ipcMain.handle('atom:tools',e=>{
    requireMain(e);
    return [...builtins,...memory.tools('','')].map(({name,access,alwaysAsk})=>({name,access,alwaysAsk}))
      .concat(['load_skill',planToolName,goalToolName,questionToolName].map(name=>({name,access:'read' as const,alwaysAsk:false})));
  });
  if(windowsChrome)Menu.setApplicationMenu(null);
  win=new BrowserWindow({width:1440,height:920,minWidth:860,minHeight:630,show:false,title:'Atom',icon:path.join(import.meta.dirname,'atom.png'),backgroundColor:titleBar(settings.theme).color,
    ...(windowsChrome&&{titleBarStyle:'hidden',titleBarOverlay:titleBar(settings.theme)}),
    webPreferences:{preload:path.join(import.meta.dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  win.webContents.session.setPermissionCheckHandler(()=>false);
  win.once('ready-to-show',()=>win?.show());
  win.on('closed',()=>{win=null;});
  await win.loadURL(startPage);
}).catch(error=>{dialog.showErrorBox('Atom 启动失败',String(error));app.exit(1);});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{
  if(!engine||closed)return;
  event.preventDefault();
  if(quitting)return;
  quitting=true;
  void engine.shutdown().finally(()=>{store.close();closed=true;app.quit();});
});

