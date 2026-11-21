import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {mockApi} from './fixture-api.mjs';
await build({entryPoints:['test/exports.ts'],outfile:'build/test-core.mjs',bundle:true,packages:'external',platform:'node',format:'esm'});
const {Engine,newSession,Store,Processes,streamModel,defaults,guarded,webTools,fileTools,MemoryBank}=await import('../build/test-core.mjs');

async function rig(t,choose,setting={},withMemory=false){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'atom-core-'));
  const project={id:randomUUID(),name:'fixture',root,prompt:''};
  const store=new Store(path.join(root,'data.sqlite'));
  const session=newSession(project.id);
  const mock=await mockApi(choose);
  const profile={id:randomUUID(),name:'DeepSeek fixture',provider:'deepseek',url:mock.url,model:'deepseek-flash',effort:'off',
    context:64000,timeout:5,output:384,inputPrice:1,outputPrice:2,cachePrice:0.3,cacheWritePrice:0};
  const settings={...defaults,persistence:'off',...setting};
  const memory=new MemoryBank(store,()=>settings.memoryEnabled,text=>text.replaceAll('fixture-credential','[凭据已隐藏]'));
  const engine=new Engine(store,root,()=>{},()=>['fixture-credential'],undefined,withMemory?memory:undefined,
    id=>({profile:{...profile,id,model:'reviewer-fixture',effort:'high'},key:'fixture-credential'}));
  t.after(async()=>{await engine.shutdown();await mock.close();store.close();await fs.rm(root,{recursive:true,force:true});});
  const until=async predicate=>{
    for(let attempt=0;attempt<400;attempt++){
      const result=predicate();if(result)return result;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert.fail('Condition took too long: '+JSON.stringify(engine.view(session)));
  };
  return {root,project,store,session,mock,profile,settings,engine,until,memory,
    begin:(mode='standard',permission='rules')=>engine.start(session,project,profile,'fixture-credential',settings,{mode,permission,text:'交付回归任务',attachments:''})};
}

test('full task access runs local tools without prompts and honors deny and memory consent',async t=>{
  const f=await rig(t,(_,n)=>n===1?{calls:[
    ['write_file',{path:'permission.txt',text:'fixture'}],
    ['run_command',{shell:'cmd',command:'echo full-access-ok'}],
    ['replace_text',{path:'permission.txt',old:'fixture',replacement:'denied'}],
    ['delete_file',{path:'permission.txt'}],
    ['remember_project',{title:'长期偏好',body:'口头确认后保存'}],
  ]}:{text:['已验证']},{policies:{replace_text:'deny'}},true);
  f.begin('standard','full');
  const approval=await f.until(()=>f.engine.view(f.session).approval);
  assert.equal(approval.name,'remember_project');
  assert.equal(f.store.sessions()[0].run.permission,'full');
  assert.ok(f.session.entries.find(e=>e.title==='run_command').text.includes('full-access-ok'));
  assert.match(f.session.entries.find(e=>e.title==='replace_text').text,/denied/);
  assert.equal(f.session.entries.find(e=>e.title==='delete_file').state,'ok');
  await assert.rejects(fs.stat(path.join(f.root,'permission.txt')),{code:'ENOENT'});
  f.engine.approve(f.session.id,approval.id,false);
  await f.until(()=>!f.engine.isActive(f.session.id));
  assert.equal(f.session.status,'done');
  assert.equal(f.memory.list(f.project.id).length,0);
});

test('the autonomous plan persists over pause/resume and keeps blocked steps honest',async t=>{
  const plan=(status,detail)=>({steps:[{id:'edit',title:'修改文件',status,detail},{id:'verify',title:'运行验证',status:'pending'}]});
  const f=await rig(t,(_body,n)=>n===1?{calls:[['update_plan',plan('in_progress')]]}
    :n===2?{calls:[['write_file',{path:'plan.txt',text:'not written'}]]}
    :n===3?{calls:[['update_plan',plan('blocked','修改尚未获准')]]}:{text:['等待授权']});
  f.begin();
  const approval=await f.until(()=>f.engine.view(f.session).approval);
  assert.equal(approval.name,'write_file');
  assert.match(f.mock.requests[0].body.messages[0].content,/多步骤任务要主动拆解/);
  assert.match(f.mock.requests[1].body.messages[0].content,/已记录的任务步骤/);
  const previousId=f.session.run.planEntryId;
  await f.engine.stop(f.session,'pause');
  const restored=f.store.sessions()[0];
  assert.equal(restored.entries.find(item=>item.id===previousId).steps[0].status,'in_progress');
  f.engine.start(restored,f.project,f.profile,'fixture-credential',f.settings);
  await f.until(()=>!f.engine.isActive(restored.id));
  const saved=f.store.sessions()[0];
  const plans=saved.entries.filter(item=>item.kind==='plan');
  assert.equal(plans.length,1);
  assert.equal(plans[0].id,previousId);
  assert.equal(plans[0].steps[0].status,'blocked');
  assert.equal(plans[0].steps[1].status,'pending');
  await assert.rejects(fs.stat(path.join(f.root,'plan.txt')),{code:'ENOENT'});
});

test('goal mode continues past a premature summary and restores a question before final verification',async t=>{
  const steps=status=>({steps:[{id:'verify',title:'验证实际结果',status}]});
  const f=await rig(t,(_,n)=>([
    {calls:[['update_plan',steps('in_progress')]]},
    {text:['提前汇报']},
    {calls:[['finish_goal',{status:'achieved',evidence:'尝试提前结束'}]]},
    {calls:[['ask_user',{question:'使用哪一种输出格式？'}]]},
    {calls:[['write_file',{path:'goal.txt',text:'JSON'}],['read_file',{path:'goal.txt'}]]},
    {calls:[['update_plan',steps('completed')]]},
    {calls:[['finish_goal',{status:'achieved',evidence:'读取 goal.txt 验证内容为 JSON'}]]},
  ])[n-1]);
  f.begin('goal','full');
  await f.until(()=>!f.engine.isActive(f.session.id));
  const restored=f.store.sessions()[0];
  assert.equal(restored.status,'paused');
  assert.equal(restored.run.question,'使用哪一种输出格式？');
  assert.equal(restored.entries.find(e=>e.title==='finish_goal').state,'error');
  assert.match(f.mock.requests[2].body.messages.at(-1).content,/目标结果/);
  assert.throws(()=>f.engine.start(restored,f.project,f.profile,'fixture-credential',f.settings),/回答/);
  f.engine.start(restored,f.project,f.profile,'fixture-credential',f.settings,undefined,'请使用 JSON');
  await f.until(()=>!f.engine.isActive(restored.id));
  const saved=f.store.sessions()[0];
  assert.equal(saved.status,'done');
  assert.equal(saved.run.question,undefined);
  assert.equal(saved.run.planEntryId,f.session.run.planEntryId);
  assert.equal(saved.run.goalOutcome.status,'achieved');
  assert.match(f.mock.requests[4].body.messages.at(-1).content,/请使用 JSON/);
  assert.equal(await fs.readFile(path.join(f.root,'goal.txt'),'utf8'),'JSON');
});

test('goal mode pauses for real blockers and terminates after a bounded number of text-only replies',async t=>{
  const f=await rig(t,(_,n)=>n===1?{calls:[['finish_goal',{status:'blocked',evidence:'上游服务离线'}]]}:{text:['仍在准备']});
  f.begin('goal');
  await f.until(()=>!f.engine.isActive(f.session.id));
  assert.equal(f.session.status,'paused');
  assert.deepEqual(f.session.run.goalOutcome,{status:'blocked',evidence:'上游服务离线'});
  f.engine.start(f.session,f.project,f.profile,'fixture-credential',f.settings,undefined,'服务已恢复');
  await f.until(()=>!f.engine.isActive(f.session.id));
  assert.equal(f.session.status,'error');
  assert.equal(f.mock.requests.length,4);
  assert.match(f.session.entries.at(-1).text,/未提交目标验收结果/);
});

const verdict=(status,reason,remaining_items=[],next_actions=[],evidence=[])=>({text:[JSON.stringify({status,reason,remaining_items,next_actions,evidence})]});

test('standard mode independently reviews an early answer, then requires a failed test to be repaired',async t=>{
  const f=await rig(t,(body,n)=>{
    if([2,5,9].includes(n)){
      assert.equal(body.model,'reviewer-fixture');
      assert.equal(body.reasoning_effort,'max');
      assert.ok(!body.tools?.length);
    }else assert.equal(body.model,'deepseek-flash');
    return [
      {text:['完工了']},
      verdict('continue','缺少程序',['编写并运行测试'],['写文件并验证']),
      {calls:[['write_file',{path:'test.js',text:'process.exit(1)'}],['run_command',{shell:'cmd',command:'node test.js'}]]},
      {text:['测试已经处理']},
      verdict('continue','测试失败',['修复退出码 1'],['修正程序并重跑']),
      {calls:[['replace_text',{path:'test.js',old:'process.exit(1)',replacement:'console.log(42)'}]]},
      {calls:[['run_command',{shell:'cmd',command:'node test.js'}]]},
      {text:['程序已验证']},
      verdict('completed','真实执行通过',[],[],['node test.js 退出码为 0，输出 42']),
    ][n-1];
  },{persistence:'high',evaluatorId:'reviewer'});
  f.begin('standard','full');
  await f.until(()=>!f.engine.isActive(f.session.id));
  assert.equal(f.session.status,'done');
  assert.equal(f.session.run.tokens,9*143);
  assert.equal(f.session.run.calls,9);
  const reviews=f.session.entries.filter(item=>item.kind==='review');
  assert.deepEqual(reviews.map(item=>item.review.status),['continue','continue','completed']);
  assert.equal(f.session.entries.find(item=>item.text==='完工了').progress,true);
  assert.equal(f.session.entries.find(item=>item.text==='程序已验证').progress,false);
  assert.match(f.mock.requests[4].body.messages.at(-1).content,/"exitCode": 1/);
  assert.match(f.mock.requests[8].body.messages.at(-1).content,/"exitCode": 0/);
  assert.match(f.mock.requests[8].body.messages.at(-1).content,/当前交付文件：test\.js\nconsole\.log\(42\)/);
  assert.equal(f.store.contextList(f.session.id).filter(item=>item.kind==='review').length,3);
});

test('simple requests take one light independent review, and blocking reviews persist with remaining work',async t=>{
  const f=await rig(t,(_,n)=>[
    {text:['答案是 42']},verdict('completed','可核对的简答',[],[],['候选答案 42']),
    {text:['暂未执行']},verdict('blocked','用户需选择发布位置',['发布成果'],[],['没有发布目标']),
  ][n-1],{persistence:'standard'});
  f.begin();
  await f.until(()=>!f.engine.isActive(f.session.id));
  assert.equal(f.session.status,'done');
  assert.equal(f.mock.requests.length,2);
  f.begin();
  await f.until(()=>!f.engine.isActive(f.session.id));
  assert.equal(f.session.status,'paused');
  assert.deepEqual(f.store.sessions()[0].run.review.remaining_items,['发布成果']);
});

test('review failures and Token budgets cannot finalize unverified work',async t=>{
  const f=await rig(t,(_,n)=>n===2?{text:['bad evaluator format']}:{text:['候选答复']},{persistence:'standard'});
  f.begin();
  await f.until(()=>!f.engine.isActive(f.session.id));
  assert.equal(f.session.status,'error');
  assert.match(f.session.entries.at(-1).text,/未返回有效结论/);
  f.settings.maxTokens=350;
  f.begin();
  await f.until(()=>!f.engine.isActive(f.session.id));
  assert.equal(f.session.status,'error');
  assert.match(f.session.entries.at(-1).text,/Token/);
});

test('independent review keeps requirements and unresolved checks across context compaction',async t=>{
  let compacted=false;
  let checks=0;
  const f=await rig(t,(body,n)=>{
    const system=body.messages[0].content;
    if(system.includes('你是独立验收器')){
      return ++checks===1?verdict('continue','仍需核对',['保留交付约束'],['重新核对原始要求'])
        :verdict('completed','已核对',[],[],['候选回答包含回归结果']);
    }
    if(system.includes('压缩执行历史')){compacted=true;return {text:['上下文已压缩，保留先前决策']};}
    if(compacted){
      assert.match(system,/交付回归任务/);
      assert.match(system,/重新核对原始要求/);
      return {text:['回归结果']};
    }
    return {text:['第一次报告 '+ 'detail '.repeat(4800)]};
  },{persistence:'standard'});
  f.profile.context=9000;
  f.begin();
  await f.until(()=>!f.engine.isActive(f.session.id));
  assert.equal(f.session.status,'done');
  assert.equal(checks,2);
  assert.ok(compacted);
});

test('DeepSeek-shaped streamed deltas and 429 retry use the real SDK transport',async t=>{
  const mock=await mockApi((body,n)=>n===1?{error:429}:{text:['流式','响应']});
  t.after(()=>mock.close());
  const profile={name:'fixture',provider:'deepseek',url:mock.url,model:'deepseek-flash',effort:'off',timeout:5,output:80};
  const deltas=[];
  const result=await streamModel({profile,key:'test-key',system:'test',messages:[{role:'user',content:'hello'}],tools:new Map(),signal:AbortSignal.timeout(5000),onText:text=>deltas.push(text)});
  assert.deepEqual(deltas,['流式','流式响应']);
  assert.equal(result.usage.inputTokens,125);
  assert.equal(mock.requests.length,2);
  assert.equal(mock.requests[0].body.thinking.type,'disabled');
});

test('agent writes code, requests approval, executes PowerShell, reads MCP and persists changes',async t=>{
  const f=await rig(t,(_,n)=>({
    1:{calls:[['write_file',{path:'program.js',text:'console.log(6*7)'}]]},
    2:{calls:[['run_command',{shell:'powershell',command:'node program.js'}]]},
    3:{calls:[['mcp_local_echo',{value:'roundtrip'}]]},
    4:{text:['真实工具已返回',' 42']},
  })[n],{mcp:[{name:'local',command:process.execPath,args:[path.resolve('test/mcp-server.mjs')]}]});
  f.begin();
  for(const name of ['write_file','run_command','mcp_local_echo']){
    const a=await f.until(()=>f.engine.view(f.session).approval);
    assert.equal(a.name,name);
    f.engine.approve(f.session.id,a.id,true);
    await f.until(()=>f.engine.view(f.session).approval?.id!==a.id);
  }
  await f.until(()=>!f.engine.isActive(f.session.id));
  assert.equal(f.session.status,'done');
  assert.equal(await fs.readFile(path.join(f.root,'program.js'),'utf8'),'console.log(6*7)');
  assert.ok(f.session.entries.some(e=>e.title==='run_command'&&e.text.includes('42')));
  assert.ok(f.session.entries.some(e=>e.title==='mcp_local_echo'&&e.text.includes('MCP roundtrip')));
  assert.equal(f.session.usage.input,500);
  assert.equal(f.session.usage.cache,80);
  assert.ok(f.session.usage.dollars>0);
  assert.equal(f.store.sessions()[0].changes[0].pending,false);
  assert.match(f.store.sessions()[0].changes[0].diff,/console.log/);
  assert.ok(f.mock.requests[3].body.messages.some(message=>message.role==='tool'&&message.content.includes('MCP roundtrip')));
});

test('denials prevent writes, and failed regression runs another fix and regression cycle',async t=>{
  const f=await rig(t,(_body,n)=> n===1?{calls:[['write_file',{path:'blocked.txt',text:'blocked'}]]}
    :[3,7,11].includes(n)?{calls:[['run_command',{shell:'cmd',command:n===7?'exit /b 7':'exit /b 0'}]]}
    :{calls:[['finish_stage',{passed:n!==9,summary:'Evidence '+n}]]},{policies:{write_file:'deny'}});
  f.begin('iterate');
  for(let round=0;round<3;round++){
    const approval=await f.until(()=>f.engine.view(f.session).approval);
    f.engine.approve(f.session.id,approval.id,true);
    await f.until(()=>f.engine.view(f.session).approval?.id!==approval.id);
  }
  await f.until(()=>!f.engine.isActive(f.session.id));
  assert.equal(f.session.status,'done');
  assert.equal(f.mock.requests.length,12);
  await assert.rejects(fs.stat(path.join(f.root,'blocked.txt')),{code:'ENOENT'});
  assert.match(f.session.entries.find(e=>e.title==='write_file').text,/denied/);
  assert.equal(f.session.entries.filter(e=>e.text.startsWith('回归测试 ·')).length,2);
  const [latest]=f.store.contextList(f.session.id);
  const captured=f.store.contextRead(f.session.id,latest.id);
  assert.ok(captured.items.some(item=>item.title==='阶段推进'&&item.source.includes('框架注入')));
  assert.ok(captured.items.some(item=>item.title==='finish_stage'&&item.group==='tools'));
});

test('context compacts, cancellation stops a live request, and pause resumes from feedback',async t=>{
  const f=await rig(t,(body,n)=>n===1?{text:['保留关键决策']}:n===2?{hang:true}:{text:['恢复完成']});
  f.profile.context=8200;
  f.session.messages.push(...Array.from({length:15},()=>({role:'user',content:'Some previous context '.repeat(200)})));
  f.begin();
  await f.until(()=>f.mock.requests.length===2);
  await f.engine.stop(f.session,'pause');
  assert.equal(f.session.status,'paused');
  assert.match(f.session.summary,/关键决策/);
  assert.ok(f.session.entries.some(e=>e.text.includes('压缩历史')));
  f.engine.start(f.session,f.project,f.profile,'fixture-credential',f.settings);
  await f.until(()=>!f.engine.isActive(f.session.id));
  assert.equal(f.session.status,'done');
  assert.match(f.mock.requests.at(-1).body.messages[0].content,/保留关键决策/);
  const [latest,aborted,compressed]=f.store.contextList(f.session.id);
  assert.equal(latest.state,'completed');
  assert.equal(aborted.state,'interrupted');
  assert.equal(compressed.kind,'summary');
  assert.ok(f.store.contextRead(f.session.id,latest.id).items.some(item=>item.group==='summary'));
  const compact=f.store.contextRead(f.session.id,compressed.id);
  assert.ok(compact.items.some(item=>item.title==='压缩输入'));
  assert.ok(!compact.items.some(item=>item.group==='tools'));
});

test('crash recovery closes the in-flight call without replaying it',async t=>{
  const f=await rig(t,()=>({text:['已核对']}),{policies:{edit:'allow'}});
  const id='lost-write';
  f.session.status='running';
  f.session.messages.push({role:'user',content:'write the result'},{role:'assistant',content:[{type:'tool-call',toolCallId:id,toolName:'write_file',input:{path:'one.txt',text:'initial'}}]});
  f.session.entries.push({id,time:0,kind:'tool',text:'等待执行',state:'pending'});
  f.session.pending=[{id,name:'write_file',input:{path:'one.txt',text:'initial'},started:true}];
  f.session.run={started:0,activeMs:0,calls:1,spent:0,stage:0,mode:'standard',profileId:f.profile.id,limits:f.settings,goal:'write the result',last:'',repeats:0};
  f.store.session(f.session);
  const restored=f.store.sessions()[0];
  f.engine.repair(restored);
  assert.equal(restored.status,'interrupted');
  assert.equal(restored.entries[0].state,'unknown');
  f.engine.start(restored,f.project,f.profile,'fixture-credential',f.settings);
  await f.until(()=>!f.engine.isActive(restored.id));
  assert.equal(restored.status,'done');
  assert.match(f.mock.requests[0].body.messages.find(e=>e.role==='tool').content,/禁止直接重放/);
  await assert.rejects(fs.stat(path.join(f.root,'one.txt')),{code:'ENOENT'});
});

test('workspace rejects protected paths and junctions; web reads block loopback',async t=>{
  const f=await rig(t,()=>({text:['ok']}));
  for(const target of ['../outside','C:/x','//unc/x','.env.local','file.txt:alternate','NUL','test/.. /secret'])
    await assert.rejects(guarded(f.root,target));
  await fs.symlink(os.tmpdir(),path.join(f.root,'outside'),'junction');
  await assert.rejects(guarded(f.root,'outside/hidden.txt'));
  const web=webTools.find(tool=>tool.name==='web_read');
  await assert.rejects(web.run({url:'http://127.0.0.1/'},{signal:AbortSignal.timeout(2000)}),/禁止访问/);
});

test('patch and exact replacement preserve document and journal, with deletion explicit',async t=>{
  const f=await rig(t,()=>({text:['ok']}));
  const journal=[];
  const ctx={root:f.root,signal:AbortSignal.timeout(5000),beforeChange:(...record)=>()=>journal.push(record)};
  const run=(name,input)=>fileTools.find(tool=>tool.name===name).run(input,ctx);
  await run('write_file',{path:'a.txt',text:'\ufeffone\r\ntwo\r\n'});
  await run('replace_text',{path:'a.txt',old:'two',replacement:'three'});
  await run('apply_patch',{path:'a.txt',patch:'--- a.txt\n+++ a.txt\n@@ -2 +2 @@\n-three\n+four\n'});
  assert.match(await fs.readFile(path.join(f.root,'a.txt'),'utf8'),/^\ufeffone\r\nfour\r\n$/);
  await run('delete_file',{path:'a.txt'});
  assert.equal(journal.length,4);
  await assert.rejects(fs.stat(path.join(f.root,'a.txt')),{code:'ENOENT'});
});

test('CMD yields real exit code and background cancellation reaps the process',async t=>{
  const f=await rig(t,()=>({text:['ok']}));
  const jobs=new Processes(f.root,s=>s,()=>{});
  t.after(()=>jobs.stopAll());
  const hello=await jobs.start('echo hi','cmd',false);
  assert.equal(hello.exitCode,0);
  assert.match(hello.output,/hi/);
  const failure=await jobs.start('exit /b 7','cmd',false);
  assert.equal(failure.exitCode,7);
  const background=await jobs.start('Write-Output "started"; Start-Sleep -Seconds 30','powershell',true);
  await f.until(()=>jobs.list(background.job)[0]?.output.includes('started'));
  await jobs.stop(background.job);
  await f.until(()=>!jobs.list(background.job)[0].running);
});

test('run can accept steering, cancel, and enforce a request budget',async t=>{
  const f=await rig(t,(_body,n)=>n===1?{calls:[['list_directory',{}]]}:{hang:true},{maxCalls:1});
  f.begin();
  await f.until(()=>!f.engine.isActive(f.session.id));
  assert.equal(f.session.status,'error');
  assert.equal(f.mock.requests.length,1);
  assert.match(f.session.entries.at(-1).text,/次数上限/);
  f.settings.maxCalls=10;
  f.begin();
  await f.until(()=>f.mock.requests.length===2);
  f.engine.steer(f.session,'追加目标');
  assert.equal(f.session.queued[0],'追加目标');
  await f.engine.stop(f.session,'cancel');
  assert.equal(f.session.status,'cancelled');
  assert.equal(f.session.queued.length,0);
});

test('project instructions, skills and real Git status/diff reach the model',async t=>{
  const f=await rig(t,(_body,n)=>n===1?{calls:[
    ['load_skill',{name:'verification'}],['git_status',{}],['git_diff',{}],
  ]}:{text:['检查完毕']});
  const git=(...args)=>execFileSync('git',args,{cwd:f.root,stdio:'ignore'});
  git('init','-q');
  await fs.writeFile(path.join(f.root,'sample.txt'),'old fixture\n');
  git('add','sample.txt');
  git('-c','user.name=Atom fixture','-c','user.email=fixture@localhost','commit','-qm','Fixture state');
  await fs.writeFile(path.join(f.root,'sample.txt'),'new fixture\n');
  await fs.writeFile(path.join(f.root,'AGENTS.md'),'Unique project policy');
  await fs.mkdir(path.join(f.root,'.agents','skills','verification'),{recursive:true});
  await fs.writeFile(path.join(f.root,'.agents','skills','verification','SKILL.md'),'---\ndescription: Local smoke workflow\n---\nSkill detail');
  f.begin();
  await f.until(()=>!f.engine.isActive(f.session.id));
  assert.equal(f.session.status,'done');
  assert.match(f.mock.requests[0].body.messages[0].content,/Unique project policy/);
  assert.match(f.mock.requests[0].body.messages[0].content,/Local smoke workflow/);
  const responses=f.mock.requests[1].body.messages.filter(m=>m.role==='tool').map(m=>m.content);
  assert.match(responses[0],/Skill detail/);
  assert.match(responses[1],/M sample.txt/);
  assert.match(responses[2],/\+new fixture/);
});

test('approved memory survives new sessions, respects scope and can be paused or removed',async t=>{
  const f=await rig(t,(_,n)=>n===1?{calls:[['remember_project',{title:'发布规则',body:'发布使用 Node 24 和蓝色标签'}]]}
    :{text:['已验证']},{policies:{remember_project:'allow'}},true);
  f.begin();
  const approval=await f.until(()=>f.engine.view(f.session).approval);
  assert.equal(approval.name,'remember_project');
  assert.equal(f.memory.list(f.project.id).length,0);
  f.engine.approve(f.session.id,approval.id,true);
  await f.until(()=>!f.engine.isActive(f.session.id));
  const [note]=f.memory.list(f.project.id);
  assert.equal(note.sourceSessionId,f.session.id);
  assert.match(note.body,/Node 24/);
  assert.throws(()=>f.memory.save({title:'key',body:'fixture-credential',pinned:false}),/凭据/);
  f.memory.save({title:'输出语言',body:'使用中文',pinned:true});
  const other={...f.project,id:randomUUID()};
  const run=async project=>{
    const session=newSession(project.id);
    f.engine.start(session,project,f.profile,'fixture-credential',f.settings,{mode:'standard',text:'查看发布规则',attachments:''});
    await f.until(()=>!f.engine.isActive(session.id));
    assert.equal(session.status,'done');
    return f.mock.requests.at(-1).body.messages[0].content;
  };
  const same=await run(f.project);
  assert.match(same,/蓝色标签/);assert.match(same,/使用中文/);
  const separated=await run(other);
  assert.doesNotMatch(separated,/蓝色标签/);assert.match(separated,/使用中文/);
  f.settings.memoryEnabled=false;
  assert.doesNotMatch(await run(f.project),/蓝色标签|使用中文/);
  f.settings.memoryEnabled=true;
  assert.throws(()=>f.memory.remove(note.id,other.id),/不存在/);
  f.memory.remove(note.id,f.project.id);
  assert.doesNotMatch(await run(f.project),/蓝色标签/);
});

test('request inspection records the assembled input once across retries and redacts keys',async t=>{
  const f=await rig(t,(_,n)=>n===1?{error:429}:{text:['已检查']});
  f.project.prompt='Project instruction fixture-credential';
  await fs.writeFile(path.join(f.root,'AGENTS.md'),'Project root guidance');
  f.begin();
  await f.until(()=>!f.engine.isActive(f.session.id));
  assert.equal(f.session.status,'done');
  assert.equal(f.mock.requests.length,2);
  const rows=f.store.contextList(f.session.id);
  assert.equal(rows.length,1);
  assert.equal(rows[0].attempts,2);
  assert.equal(rows[0].usage.input,125);
  const trace=f.store.contextRead(f.session.id,rows[0].id);
  assert.equal(trace.redacted,true);
  assert.doesNotMatch(JSON.stringify(trace),/fixture-credential/);
  assert.ok(trace.items.some(item=>item.title==='项目根目录 AGENTS.md'&&item.content==='Project root guidance'));
  const assembled=trace.items.filter(item=>item.source==='system').map(item=>item.content).join('\n\n').replace('[凭据已隐藏]','fixture-credential');
  assert.equal(assembled,f.mock.requests[1].body.messages[0].content);
  const read=f.mock.requests[1].body.tools.find(tool=>tool.function.name==='read_file').function;
  const definition=JSON.parse(trace.items.find(item=>item.title==='read_file').content);
  assert.equal(definition.description,read.description);
  assert.deepEqual(definition.inputSchema.properties,read.parameters.properties);
  assert.equal(f.store.contextRead(randomUUID(),rows[0].id),undefined);
});

