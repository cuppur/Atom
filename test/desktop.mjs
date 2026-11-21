import { _electron as electron } from 'playwright';
import { strict as assert } from 'node:assert';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {mockApi} from './fixture-api.mjs';

const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'atom-desktop-')));
const profilePath=path.join(root,'profile');
const projectPath=path.join(root,'project');
await fs.mkdir(projectPath);
const evidence=process.env.ATOM_SCREENSHOT_DIR;
if(evidence)await fs.mkdir(evidence,{recursive:true});
const key='sk-fixture-'+randomUUID();
const taskSteps=(first,second)=>({steps:[
  {id:'write',title:'创建输出 42 的脚本',status:first},{id:'verify',title:'运行脚本并核对输出',status:second},
]});
const mock=await mockApi((_body,n)=>n===1?{text:['O','K']}:n===2?{calls:[
  ['update_plan',taskSteps('in_progress','pending')],['write_file',{path:'solution.js',text:'console.log(21*2)'}],
]}:n===3?{calls:[['update_plan',taskSteps('completed','in_progress')],['run_command',{shell:'cmd',command:'node solution.js'}]]}
  :n===4?{calls:[['update_plan',taskSteps('completed','completed')]]}
  :n===5?{text:['测试','完成，','输出 42。'],delayMs:440}
  :n===6?{text:['已召回项目验收约定。']}
  :n===7?{calls:[['update_plan',taskSteps('completed','in_progress')]]}
  :n===8?{calls:[['ask_user',{question:'要验证哪个文件？'}]]}
  :n===9?{calls:[['read_file',{path:'solution.js'}]]}
  :n===10?{calls:[['update_plan',taskSteps('completed','completed')]]}
  :n===11?{calls:[['finish_goal',{status:'achieved',evidence:'已检查 solution.js 的内容。'}]]}
  :n===12?{text:['第一次报告']}
  :n===13?{text:[JSON.stringify({status:'continue',reason:'缺少文件证据',remaining_items:['验证脚本'],next_actions:['读取 solution.js'],evidence:[]})]}
  :n===14?{calls:[['read_file',{path:'solution.js'}]]}
  :n===15?{text:['最终结果：脚本计算 42。']}
  :{text:[JSON.stringify({status:'completed',reason:'脚本内容已核对',remaining_items:[],next_actions:[],evidence:['读取 solution.js 得到 console.log(21*2)']})]});
const executablePath=process.env.ATOM_EXECUTABLE;
let desktop;
const boot=async()=>{
  desktop=await electron.launch({
    ...(executablePath?{executablePath}:{}),
    args:[...(!executablePath?['.']:[]),'--user-data-dir='+profilePath],
    timeout:35000,
  });
  const window=await desktop.firstWindow();
  window.on('pageerror',error=>console.error('Renderer error:',error.message));
  return window;
};
try{
  let window=await boot();
  await window.getByRole('heading',{name:'你的本地 Agent 工作台'}).waitFor();
  if(process.platform==='win32'){
    await window.waitForFunction(()=>navigator.windowControlsOverlay?.visible);
    const chrome=await window.evaluate(()=>{
      const title=navigator.windowControlsOverlay.getTitlebarAreaRect();
      const heading=document.querySelector('.workspace-heading');
      const button=heading.querySelector('.workspace-actions button:last-child');
      return {height:heading.getBoundingClientRect().height,limit:title.right,buttonRight:button.getBoundingClientRect().right,
        region:getComputedStyle(heading).getPropertyValue('app-region')};
    });
    assert.ok(chrome.height<=44 && chrome.buttonRight<chrome.limit);
    assert.equal(chrome.region,'drag');
    assert.equal(await desktop.evaluate(({Menu})=>Menu.getApplicationMenu()===null),true);
  }
  if(evidence)await window.screenshot({path:path.join(evidence,'atom-welcome.png')});
  // Supply the same value that a user would pick via the native directory dialog.
  await desktop.evaluate(({dialog},chosen)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[chosen]});},projectPath);
  await window.getByRole('button',{name:'选择工作目录',exact:true}).click();
  await window.getByRole('heading',{name:'开始一个新任务'}).waitFor();
  await window.getByRole('button',{name:'配置模型',exact:true}).click();
  await window.getByLabel('供应商',{exact:true}).selectOption('compatible');
  await window.getByLabel('显示名称').fill('Local transport fixture');
  await window.getByLabel('Base URL').fill(mock.url);
  await window.getByLabel('模型名称').fill('fixture');
  await window.getByLabel('上下文上限',{exact:true}).fill('900000');
  await window.getByLabel('API Key').fill(key);
  await window.getByRole('button',{name:'保存模型'}).click();
  await window.getByText('模型已保存',{exact:true}).waitFor();
  await window.getByRole('button',{name:'测试已保存配置'}).click();
  await window.getByText(/串流成功 · 2 段/).waitFor();
  assert.equal(mock.requests[0].authorization,'Bearer '+key);
  await window.getByRole('button',{name:'关闭设置'}).click();
  await window.getByRole('button',{name:'模型选项'}).click();
  await window.locator('.quick-menu').getByRole('button',{name:/推理强度/}).click();
  await window.locator('.quick-menu').getByRole('button',{name:'高',exact:true}).click();
  await window.locator('.quick-menu').getByRole('button',{name:/执行毅力/}).click();
  await window.getByRole('button',{name:'关闭',exact:true}).click();
  await window.locator('.quick-menu').getByRole('button',{name:/上下文长度/}).click();
  await window.getByRole('button',{name:'900k',exact:true}).click();
  await window.getByRole('button',{name:'关闭模型浮层'}).click();
  assert.equal(await window.locator('.app-rail').count(),0);
  await window.getByRole('button',{name:'上下文用量',exact:true}).click();
  await window.getByRole('button',{name:'600k',exact:true}).click();
  await window.getByRole('button',{name:'600k',exact:true,pressed:true}).waitFor();
  await window.keyboard.press('Escape');
  assert.equal(await window.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'上下文用量');
  const permission=window.getByRole('combobox',{name:'任务权限'});
  assert.equal(await permission.inputValue(),'full');
  await permission.selectOption('rules');
  const composer=window.getByRole('textbox',{name:'任务指令'});
  await composer.fill('实现并运行返回 42 的程序');
  await composer.press('Shift+Enter');
  assert.match(await composer.inputValue(),/\n$/);
  await composer.dispatchEvent('compositionstart');
  await composer.dispatchEvent('keydown',{key:'Enter',isComposing:true});
  await composer.dispatchEvent('compositionend');
  assert.equal(mock.requests.length,1);
  await composer.press('Enter');
  const plan=window.getByRole('region',{name:'任务计划'});
  await plan.locator('[data-step-status="in_progress"]').getByText('创建输出 42 的脚本').waitFor();
  await window.getByRole('button',{name:'允许一次'}).click();
  await window.waitForFunction(()=>document.querySelector('.approval pre')?.textContent.includes('node solution.js'));
  await plan.locator('[data-step-status="in_progress"]').getByText('运行脚本并核对输出').waitFor();
  if(evidence)await window.screenshot({path:path.join(evidence,'atom-plan-running.png')});
  await window.getByRole('button',{name:'允许一次'}).click();
  await window.waitForFunction(()=>document.querySelector('[data-atom-metric="rate"]')?.textContent.includes('≈'));
  assert.match(await window.locator('[data-atom-metric="tokens"]').innerText(),/输入\s*≈[\d,]+\s*输出\s*≈\d+/);
  assert.match(await window.locator('[data-atom-metric="context"]').innerText(),/≈.*600,000.*%/s);
  await window.getByText('测试完成，输出 42。',{exact:true}).waitFor();
  await window.locator('.status-state').getByText('已完成',{exact:true}).waitFor();
  await plan.getByText('2 / 2 已完成',{exact:true}).waitFor();
  assert.match(await window.locator('[data-atom-metric="tokens"]').innerText(),/输入\s*125\s*输出\s*18/);
  assert.match(await window.locator('[data-atom-metric="cache"]').innerText(),/缓存命中率\s*16%/);
  assert.match(await window.locator('[data-atom-metric="context"]').innerText(),/125.*600,000.*%/s);
  assert.equal(mock.requests[1].body.reasoning_effort,'high');
  if(evidence)await window.screenshot({path:path.join(evidence,'atom-workspace.png')});
  await window.getByRole('button',{name:'上下文用量',exact:true}).click();
  await window.waitForFunction(()=>document.querySelector('.quick-legend li small')?.textContent?.includes('%'));
  if(evidence)await window.screenshot({path:path.join(evidence,'atom-quick-context.png')});
  await window.getByRole('button',{name:'关闭模型浮层'}).click();
  await window.getByRole('button',{name:'查看请求上下文'}).click();
  const inspector=window.getByRole('dialog',{name:'请求上下文'});
  await inspector.getByRole('heading',{name:'输入组成'}).waitFor();
  await inspector.getByRole('button',{name:/Atom 内置系统提示词/}).click();
  await inspector.getByText(/你是 Atom，一个在用户指定项目中工作的桌面 Agent/).waitFor();
  await inspector.getByRole('group',{name:'按上下文组成筛选'}).getByRole('button',{name:/工具定义/}).click();
  await inspector.getByRole('textbox',{name:'在请求内容中搜索'}).fill('read_file');
  await inspector.getByRole('button',{name:/read_file/}).click();
  await inspector.getByText(/"inputSchema"/).waitFor();
  if(evidence)await window.screenshot({path:path.join(evidence,'atom-context.png')});
  await inspector.getByRole('button',{name:'关闭请求上下文'}).click();
  await window.getByRole('textbox',{name:'任务指令'}).fill('/context');
  await window.getByRole('button',{name:'发送任务'}).click();
  await inspector.getByRole('heading',{name:'输入组成'}).waitFor();
  assert.equal(mock.requests.length,5);
  const records=inspector.getByRole('combobox',{name:'请求记录'});
  assert.equal(await records.locator('option').count(),4);
  await records.selectOption({index:3});
  await inspector.getByRole('button',{name:/当前任务目标/}).click();
  await inspector.getByText('当前任务：实现并运行返回 42 的程序',{exact:true}).waitFor();
  await inspector.getByRole('button',{name:'关闭请求上下文'}).click();
  await window.getByRole('button',{name:'查看变更',exact:true}).click();
  if(process.platform==='win32')assert.equal(await window.getByRole('button',{name:'关闭检查器'}).evaluate(button=>
    button.getBoundingClientRect().right<navigator.windowControlsOverlay.getTitlebarAreaRect().right),true);
  await window.locator('.inspector').getByText('solution.js',{exact:true}).click();
  await window.getByText(/\+console\.log\(21\*2\)/).waitFor();
  assert.equal(await fs.readFile(path.join(projectPath,'solution.js'),'utf8'),'console.log(21*2)');
  if(evidence)await window.screenshot({path:path.join(evidence,'atom-task.png')});
  await window.locator('.inspector').getByRole('button',{name:'任务',exact:true}).click();
  await window.locator('.inspector').getByRole('region',{name:'任务计划'}).getByText('2 / 2 已完成',{exact:true}).waitFor();
  await window.locator('.sidebar-thread').first().hover();
  await window.getByRole('button',{name:'实现并运行返回 42 的程序的更多操作'}).click();
  await window.getByRole('button',{name:'重命名',exact:true}).click();
  await window.getByRole('textbox',{name:'会话名称'}).fill('首轮编程验收');
  await window.getByRole('button',{name:'保存名称'}).click();
  await window.locator('.sidebar-thread').first().hover();
  await window.getByRole('button',{name:'首轮编程验收的更多操作'}).click();
  await window.getByRole('button',{name:'置顶',exact:true}).click();
  await window.getByRole('region',{name:'已置顶'}).getByRole('button',{name:'首轮编程验收',exact:true}).waitFor();
  await window.keyboard.press('Control+K');
  await window.getByRole('textbox',{name:'搜索关键词'}).fill('输出 42');
  const hit=window.getByRole('dialog',{name:'搜索会话'}).getByRole('button',{name:/首轮编程验收/});
  await hit.waitFor();
  assert.match(await hit.innerText(),/输出 42/);
  if(evidence)await window.screenshot({path:path.join(evidence,'atom-search.png')});
  await window.getByRole('textbox',{name:'搜索关键词'}).press('Enter');
  await window.getByRole('dialog',{name:'搜索会话'}).waitFor({state:'hidden'});
  await window.locator('.sidebar-thread').first().hover();
  await window.getByRole('button',{name:'首轮编程验收的更多操作'}).click();
  await window.getByRole('button',{name:'归档',exact:true}).click();
  await window.getByRole('region',{name:'已置顶'}).waitFor({state:'hidden'});
  await window.getByRole('button',{name:/^已归档/}).click();
  await window.getByRole('dialog',{name:'已归档会话'}).getByRole('button',{name:/首轮编程验收/}).click();
  await window.getByText('测试完成，输出 42。',{exact:true}).waitFor();
  await window.getByRole('button',{name:'长期记忆',exact:true}).click();
  await window.getByRole('button',{name:'新建记忆',exact:true}).click();
  await window.getByLabel('标题',{exact:true}).fill('项目验收约定');
  await window.getByLabel('内容',{exact:true}).fill('项目验收必须打印蓝色测试标签。');
  await window.getByLabel('优先召回').check();
  await window.getByRole('button',{name:'保存记忆'}).click();
  await window.getByRole('dialog',{name:'长期记忆'}).getByRole('button',{name:/项目验收约定/}).waitFor();
  if(evidence)await window.screenshot({path:path.join(evidence,'atom-memory.png')});
  await window.getByRole('button',{name:'关闭长期记忆'}).click();
  await window.keyboard.press('Control+N');
  await window.getByRole('heading',{name:'开始一个新任务'}).waitFor();
  assert.equal(await window.getByRole('combobox',{name:'任务权限'}).inputValue(),'full');
  await window.getByRole('textbox',{name:'任务指令'}).fill('请说出项目验收约定');
  await window.getByRole('button',{name:'发送任务'}).click();
  await window.getByText('已召回项目验收约定。',{exact:true}).waitFor();
  assert.match(mock.requests[5].body.messages[0].content,/蓝色测试标签/);
  await window.getByRole('region',{name:'已置顶'}).getByRole('button',{name:'首轮编程验收',exact:true}).click();
  await window.getByRole('button',{name:'应用设置'}).click();
  await window.getByLabel('主题',{exact:true}).selectOption('light');
  await window.getByRole('button',{name:'保存偏好'}).click();
  await window.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  if(evidence)await window.screenshot({path:path.join(evidence,'atom-light.png')});
  await desktop.close();
  const database=await fs.readFile(path.join(profilePath,'atom.sqlite'));
  assert.equal(database.includes(Buffer.from(key)),false);
  window=await boot();
  await window.getByText('测试完成，输出 42。',{exact:true}).waitFor();
  await window.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  const state=await window.evaluate(()=>window.atom.request({type:'snapshot'}));
  assert.equal(state.data.session.status,'done');
  assert.equal(state.data.profiles[0].hasKey,true);
  assert.equal(state.data.session.usage.input,500);
  assert.ok(!JSON.stringify(state).includes(key));
  assert.equal(mock.requests.length,6);
  await window.getByRole('region',{name:'任务计划'}).getByText('2 / 2 已完成',{exact:true}).waitFor();
  assert.equal(state.data.session.title,'首轮编程验收');
  assert.ok(state.data.session.pinnedAt);
  assert.equal(state.data.session.lastTurn.cache,20);
  assert.equal(state.data.composer.runtime.context,600000);
  await window.getByRole('button',{name:'查看请求上下文'}).click();
  await window.getByRole('dialog',{name:'请求上下文'}).getByRole('heading',{name:'输入组成'}).waitFor();
  await window.getByRole('button',{name:'关闭请求上下文'}).click();
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(860,690));
  await window.waitForFunction(()=>innerWidth<=900);
  await window.getByRole('button',{name:'上下文用量',exact:true}).click();
  const box=await window.locator('.quick-popover').boundingBox();
  const viewport=await window.evaluate(()=>({width:innerWidth,height:innerHeight}));
  assert.ok(box&&box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height);
  if(evidence)await window.screenshot({path:path.join(evidence,'atom-compact.png')});
  await window.getByRole('button',{name:'关闭模型浮层'}).click();
  await window.getByRole('button',{name:'长期记忆',exact:true}).click();
  await window.getByRole('dialog',{name:'长期记忆'}).getByRole('button',{name:/项目验收约定/}).waitFor();
  await window.keyboard.press('Escape');
  await window.getByRole('combobox',{name:'运行模式'}).selectOption('goal');
  await window.getByRole('textbox',{name:'任务指令'}).fill('验证现有脚本');
  await window.getByRole('textbox',{name:'任务指令'}).press('Enter');
  await window.getByText('Agent 等待回答',{exact:true}).waitFor();
  if(evidence)await window.screenshot({path:path.join(evidence,'atom-goal-question.png')});
  await desktop.close();
  window=await boot();
  await window.getByText('要验证哪个文件？',{exact:true}).waitFor();
  await window.getByRole('textbox',{name:'任务指令'}).fill('solution.js');
  await window.getByRole('button',{name:'回答并继续'}).click();
  await window.getByText('目标已达成 · 已检查 solution.js 的内容。',{exact:true}).waitFor();
  assert.match(mock.requests[8].body.messages.at(-1).content,/solution.js/);
  const goal=await window.evaluate(()=>window.atom.request({type:'snapshot'}));
  assert.equal(goal.data.session.run.goal,'验证现有脚本');
  assert.equal(goal.data.session.run.goalOutcome.status,'achieved');
  await window.getByRole('combobox',{name:'运行模式'}).selectOption('standard');
  await window.getByRole('button',{name:'模型选项'}).click();
  await window.locator('.quick-menu').getByRole('button',{name:/执行毅力/}).click();
  await window.getByRole('button',{name:'高',exact:true}).click();
  await window.locator('.quick-menu').getByRole('button',{name:/推理强度/}).click();
  await window.getByRole('button',{name:'低',exact:true}).click();
  await window.getByRole('button',{name:'关闭模型浮层'}).click();
  const adjusted=(await window.evaluate(()=>window.atom.request({type:'snapshot'}))).data;
  assert.equal(adjusted.settings.persistence,'high');
  assert.equal(adjusted.composer.runtime.effort,'low');
  await window.getByRole('textbox',{name:'任务指令'}).fill('核对脚本的计算');
  await window.getByRole('textbox',{name:'任务指令'}).press('Enter');
  await window.getByText('验收后继续',{exact:true}).click();
  await window.getByText('缺少文件证据',{exact:true}).waitFor();
  await window.getByText('验收通过',{exact:true}).waitFor();
  await window.locator('.status-state').getByText('已完成',{exact:true}).waitFor();
  assert.equal(mock.requests[11].body.reasoning_effort,'low');
  if(evidence)await window.screenshot({path:path.join(evidence,'atom-persistence.png')});
  console.log('Electron desktop: persistence, independent effort, review history, goal question, usage, request context, tools, navigation, privacy and restart passed');
}finally{
  await desktop?.close().catch(()=>{});
  await mock.close();
  await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}

