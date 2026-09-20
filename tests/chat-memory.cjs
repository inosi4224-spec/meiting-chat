const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict'),crypto=require('crypto');
const {chromium}=require('C:/Users/GA/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const baseline=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/chat-memory-baseline.json'),'utf8'));
const base=require('child_process').execFileSync('git',['show','8b6c9d4c3a6cc8386a17483746b7661cfb725183:index.html'],{cwd:root,encoding:'utf8'}).replace(/\r?\n/g,'\r\n');
fs.mkdirSync(path.join(root,'verification'),{recursive:true});
const results=[];
function pass(name){results.push({name,ok:true})}
for(const text of Object.values(baseline.sections))assert(html.includes(text),'PROMPT CHANGED: STOP');pass('人格 prompt 精确字节一致');
assert.equal(crypto.createHash('sha256').update(JSON.stringify(baseline.sections)).digest('hex'),baseline.sha256);
const sections=[['function applyStreamEvent(', '/* ---------- Summary and per-turn memory maintenance'],['/* ---------- Summary and per-turn memory maintenance','</script>'],['async function callAnthropicMaintenance(', '/* ---------- Streaming send'],['async function sendToOpenAiProtocol(', 'async function sendMessage('],['async function buildApiMessages(', '/* System prompt:'],['function buildThinkingPreview(', '/* ---------- Rendering'],['/* ---------- Latent memory integration','function openMemoryModal()']];
for(const [a,b] of sections){const get=s=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));assert.equal(get(html).replace('async () => maintainCompletedTurn(conv, preset, userMsg, assistantMsg, await latentAvailable, relevantMemory, snapshot)', '() => maintainCompletedTurn(conv, preset, userMsg, assistantMsg, latentAvailable, relevantMemory, snapshot)'),get(base),a);pass('受保护代码一致（仅豁免已授权的可用性等待） '+a)}
for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(m[1]);pass('JS syntax');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);pass('duplicate DOM IDs');
(async()=>{
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
await context.route('**/*',r=>r.request().url()==='http://localhost:43123/'?r.fulfill({contentType:'text/html',body:html}):r.abort());
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:43123/');await page.waitForFunction(()=>typeof currentId!=='undefined'&&currentId);
results.push(...await page.evaluate(async()=>{
const rows=[],check=(v,m='assertion failed')=>{if(!v)throw Error(m)},test=async(name,f)=>{try{await f();rows.push({name,ok:true})}catch(e){rows.push({name,ok:false,error:e.message})}};
const realFetch=fetch,realLatent=callLatentTool,realSave=saveMessages;
const conv=getCurrentConversation(),preset={...getCurrentPreset(),protocol:'anthropic',memoryConnected:true};
conv.messages=messages=[{role:'user',text:'宝贝，你还记得扒门是什么意思吗？'}];
const oldMemory=JSON.stringify(getMemoryContext());saveMessages=async()=>{};
const msg=()=>({id:genId(),role:'assistant',text:'',thinking:'',streaming:true});
const tool=(id='t1',query='美婷 CC 扒门 含义 约定')=>({type:'tool_use',id,name:'latent_search',input:{query}});
const events=(blocks)=>{
 const out=[{type:'message_start',message:{usage:{input_tokens:10}}}];
 blocks.forEach((b,index)=>{
  const start={...b};if(b.type==='text')start.text='';if(b.type==='thinking'){start.thinking='';start.signature=''}if(b.type==='tool_use')start.input={};
  out.push({type:'content_block_start',index,content_block:start});
  const ds=b.type==='text'?[{type:'text_delta',text:b.text}]:b.type==='thinking'?[{type:'thinking_delta',thinking:b.thinking},{type:'signature_delta',signature:b.signature}]:b.type==='tool_use'?[{type:'input_json_delta',partial_json:JSON.stringify(b.input).slice(0,5)},{type:'input_json_delta',partial_json:JSON.stringify(b.input).slice(5)}]:[];
  ds.forEach(delta=>out.push({type:'content_block_delta',index,delta}));out.push({type:'content_block_stop',index});
 });
 out.push({type:'message_delta',delta:{stop_reason:blocks.some(b=>b.type==='tool_use')?'tool_use':'end_turn'},usage:{output_tokens:5}},{type:'message_stop'});
 const bytes=new TextEncoder().encode(out.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join(''));
 return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=13)c.enqueue(bytes.slice(i,i+13));c.close()}}));
};
let requests=[],searches=[];
function setup(blockSets,result='扒门是我们的旧约定。'){
 requests=[];searches=[];
 window.fetch=async(url,opts)=>{requests.push(JSON.parse(opts.body));const b=blockSets[requests.length-1];check(b,'unexpected extra request');return events(b)};
 callLatentTool=async(name,args)=>{searches.push({name,args});if(result instanceof Error)throw result;return result};
}
const final=[{type:'thinking',thinking:'原思考',signature:'final-signature'},{type:'text',text:'宝贝，我记得。'}];
await test('memoryConnected=false 不提供工具，一次请求',async()=>{setup([final]);await sendToAnthropicProtocol({...preset,memoryConnected:false},msg());check(!requests[0].tools&&requests.length===1&&searches.length===0)});
await test('连接时只提供 latent_search，普通日常无搜索且一次请求',async()=>{setup([final]);const m=msg();await sendToAnthropicProtocol(preset,m);check(requests[0].tools.length===1&&requests[0].tools[0].name==='latent_search');check(requests.length===1&&searches.length===0&&!m.memoryLookup);check(m.text==='宝贝，我记得。'&&m.thinking==='原思考')});
let lookedUp;
await test('原生工具 query、结果、Thinking 签名及隐藏正文正确',async()=>{
 setup([[{type:'thinking',thinking:'先回忆',signature:'signature-exact'},{type:'redacted_thinking',data:'opaque-exact'},{type:'text',text:'临时工具前言'},tool()],final]);
 lookedUp=msg();const statuses=[];const recall=await sendToAnthropicProtocol(preset,lookedUp,'',()=>statuses.push(lookedUp.memoryLookup.status));
 check(searches.length===1&&searches[0].args.query==='美婷 CC 扒门 含义 约定'&&searches[0].args.topN===5);
 check(statuses.join(',')==='searching,found');check(requests.length===2&&requests[1].tool_choice.type==='none');
 const history=requests[1].messages,content=history.at(-2).content;
 check(history.at(-2).role==='assistant'&&history.at(-1).role==='user');check(content[0].signature==='signature-exact'&&content[0].thinking==='先回忆'&&content[1].data==='opaque-exact');
 check(history.at(-1).content[0].tool_use_id==='t1'&&history.at(-1).content[0].content==='扒门是我们的旧约定。');
 check(lookedUp.text==='宝贝，我记得。'&&lookedUp.thinking==='先回忆原思考'&&lookedUp.usage.input_tokens===20);
 check(recall.available&&lookedUp.memoryLookup.status==='found');check(requests[0].system===requests[1].system&&JSON.stringify(getMemoryContext())===oldMemory);
 check(!messages.some(m=>m.role==='tool'||Array.isArray(m.content)));
});
await test('重复和并行工具调用最多一次搜索，错误结果回传',async()=>{setup([[tool(),tool('parallel')],[tool('again')],final]);await sendToAnthropicProtocol(preset,msg());check(searches.length===1&&requests.length===3);check(requests[1].messages.at(-1).content[1].is_error);check(requests[2].messages.at(-1).content[0].is_error)});
for(const failure of ['服务未启动','CORS','timeout','RPC error','返回异常'])await test(failure+' 返回 is_error 后正常回复',async()=>{setup([[tool()],final],Error(failure));const m=msg();await sendToAnthropicProtocol(preset,m);check(m.text==='宝贝，我记得。'&&m.memoryLookup.status==='failed'&&requests[1].messages.at(-1).content[0].is_error&&searches.length===1)});
await test('未命中不否认事实',async()=>{setup([[tool()],final],'');const m=msg();await sendToAnthropicProtocol(preset,m);check(m.memoryLookup.status==='empty'&&requests[1].messages.at(-1).content[0].content.includes('不代表'))});
await test('无效 query 不执行搜索并继续回答',async()=>{setup([[tool('bad','')],final]);const m=msg();await sendToAnthropicProtocol(preset,m);check(!searches.length&&m.memoryLookup.status==='failed'&&m.text)});
await test('持续违规不会无限请求',async()=>{setup([[tool()],[tool('two')],[tool('three')]]);let failed=false;try{await sendToAnthropicProtocol(preset,msg())}catch(_){failed=true}check(failed&&requests.length===3&&searches.length===1)});
await test('面板默认折叠、展开更多，分段仅一个记忆按钮',async()=>{lookedUp.streaming=false;lookedUp.timestamp=Date.now();lookedUp.memoryLookup.resultPreview='召回片段'.repeat(300);const list=renderMessageRows(lookedUp,0);const holder=document.createElement('div');holder.append(...list);check(holder.querySelectorAll('.memory-lookup').length===1);const d=holder.querySelector('.memory-lookup');check(!d.open);d.open=true;check(d.open);const b=d.querySelector('button');b.click();check(b.textContent==='收起');b.click();check(b.textContent==='展开更多');check(!renderMessageRows(msg(),1)[0].querySelector('.memory-lookup'));chatEl.replaceChildren(...list)});
await test('metadata 不发送模型、不进入维护 transcript',async()=>{const api=await buildApiMessages([lookedUp]);check(!JSON.stringify(api).includes('memoryLookup')&&!JSON.stringify(api).includes('召回片段'));check(!JSON.stringify(transcriptForMaintenance([lookedUp])).includes('召回片段'))});
await test('IndexedDB 刷新和对话隔离',async()=>{conv.messages=messages=[{role:'user',text:'验收'},lookedUp];await realSave();const saved=(await idbGetAllConversations()).find(c=>c.id===conv.id);check(saved.messages[1].memoryLookup.status==='found');check(!saved.messages[0].memoryLookup);window.__lookupId=lookedUp.id});
window.fetch=realFetch;callLatentTool=realLatent;saveMessages=realSave;
return rows;
}));
await page.screenshot({path:path.join(root,'verification/memory-panel.png'),fullPage:true});
await page.reload();await page.waitForFunction(()=>typeof currentId!=='undefined'&&currentId);
assert.equal(await page.locator('.memory-lookup').count(),1);assert.equal(await page.locator('.memory-lookup').evaluate(d=>d.open),false);pass('真实 reload 后 metadata 和折叠状态正确');
await page.locator('.memory-lookup summary').click();assert.equal(await page.locator('.memory-lookup').evaluate(d=>d.open),true);await page.locator('.memory-lookup summary').click();assert.equal(await page.locator('.memory-lookup').evaluate(d=>d.open),false);pass('真实点击展开和折叠');
await page.screenshot({path:path.join(root,'verification/memory-panel-collapsed.png')});
assert.deepEqual(errors,[]);pass('HTML 页面启动无异常');
}finally{await browser.close()}
fs.writeFileSync(path.join(root,'verification/chat-memory-results.json'),JSON.stringify({results},null,2));
for(const r of results)console.log((r.ok?'PASS ':'FAIL ')+r.name+(r.error?' '+r.error:''));
console.log(`${results.filter(r=>r.ok).length}/${results.length}`);if(results.some(r=>!r.ok))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
