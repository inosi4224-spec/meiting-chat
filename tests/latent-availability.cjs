const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('C:/Users/GA/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
fs.mkdirSync(path.join(root,'verification'),{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 let rows;
 try{
 const context=await browser.newContext({serviceWorkers:'block'});
 await context.route('**/*',r=>r.request().url()==='http://localhost:43123/'?r.fulfill({contentType:'text/html',body:html}):r.abort());
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:43123/');await page.waitForFunction(()=>typeof currentId!=='undefined'&&currentId);
 rows=await page.evaluate(async()=>{
 const rows=[],check=(v,m='assertion failed')=>{if(!v)throw Error(m)},test=async(name,fn)=>{try{await fn();rows.push({name,ok:true})}catch(e){rows.push({name,ok:false,error:e.message})}};
 let calls,writes,analyses,c,p,releaseProbe,probeMode,selection;
 const rawFetch=window.fetch;
 function reset(mode='online',save=true){
 calls=[];writes=[];analyses=[];probeMode=mode;selection=save;releaseProbe=null;recentMemoryWrites.length=0;
 p={id:'available-mock',protocol:'anthropic',endpoint:'https://mock.invalid/messages',apiKey:'fake',defaultModel:'test',memoryConnected:true};
 c={id:genId(),presetId:p.id,title:'隔离测试',messages:[],memoryContext:'原会话背景',systemPrompt:'原人格逐字不变',autoLongTermMemory:true,historySummary:'',summarizedUpTo:0,summarySettings:{mode:'batch',batchSize:100,maxChars:800}};
 conversations=[c];presets=[p];currentId=c.id;messages=c.messages;memoryOperations=[];
 localStorage.setItem('meiting-chat-split-enabled','false');
 callLatentTool=async(name,args)=>{writes.push({name,args});check(name==='latent_append','unexpected search');return 'recordId=0123456789abcdef indexStatus=indexed'};
 callAnthropicMaintenance=async(p,userText)=>{
 analyses.push(JSON.parse(userText.split('\n\n').at(-1)));
 const input={updateSummary:false,summary:'',saveMemory:selection,text:'曾说早安',current_state:'今天早安',reason:'日常问候',indexEvidence:[{type:'event',quote:'早安'}]};
 return {stop_reason:'tool_use',content:[{type:'tool_use',name:'maintain_conversation',input}]};
 };
 window.fetch=async(url,opts)=>{
 const body=JSON.parse(opts.body);calls.push({url,body});
 if(url!==LATENT_ENDPOINT){return new Response([{type:'message_start',message:{usage:{input_tokens:1}}},{type:'content_block_delta',delta:{type:'text_delta',text:'宝贝，早安。'}},{type:'message_delta',delta:{stop_reason:'end_turn'}},{type:'message_stop'}].map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''))}
 check(body.method==='tools/list'&&!body.params.name,'probe must not call a tool');
 if(probeMode==='offline')throw Error('offline');
 if(probeMode==='cors')throw new TypeError('Failed to fetch');
 if(probeMode==='timeout')return new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));
 if(probeMode==='pending')await new Promise(resolve=>releaseProbe=resolve);
 if(probeMode==='http')return new Response('',{status:503});
 if(probeMode==='malformed')return new Response('invalid-json');
 if(probeMode==='rpc')return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,error:{code:-32603,message:'failure'}}));
 return new Response(JSON.stringify({jsonrpc:'2.0',id:probeMode==='wrong-id'?'wrong':body.id,result:{tools:probeMode==='startup-error'?[{name:'memory_startup_error'}]:[{name:'latent_search'},{name:'latent_append'}]}}));
 };
 }
 async function chat(){textInputEl.value='早安 今天在家';await sendMessage();await maintenanceQueues.get(c.id)}
 await test('完整 sendMessage：无 tool_use、零 search，在线仍自动筛选并 append',async()=>{
 reset();await chat();check(calls.filter(x=>x.url===p.endpoint).length===1);check(calls.filter(x=>x.body.method==='tools/list').length===1);check(writes.length===1&&writes[0].name==='latent_append');check(analyses.length===1&&analyses[0].memoryRequested&&!analyses[0].summaryRequested);check(c.memoryMaintenance.turns[0].status==='saved');check(writes[0].args.text==='曾说早安'&&writes[0].args.current_state==='今天早安');check(c.messages.at(-1).text==='宝贝，早安。'&&!c.messages.at(-1).memoryLookup);check(!chatEl.querySelector('.memory-lookup'));check(c.memoryContext==='原会话背景'&&c.systemPrompt==='原人格逐字不变');
 });
 await test('原筛选拒绝保存仍不写入',async()=>{reset('online',false);await chat();check(!writes.length&&c.memoryMaintenance.turns[0].status==='no-memory')});
 for(const mode of ['offline','cors','timeout','http','malformed','rpc','wrong-id','startup-error'])await test(mode+' 不阻断聊天、不写入、不重试、保留 pending',async()=>{reset(mode);await chat();check(c.messages.at(-1).text==='宝贝，早安。'&&!c.messages.at(-1).failed&&!sendBtnEl.disabled);check(writes.length===0&&analyses.length===0&&c.memoryMaintenance.turns[0].status==='pending');check(calls.filter(x=>x.url===LATENT_ENDPOINT).length===1)});
 await test('关闭自动记忆不探测不写入',async()=>{reset();c.autoLongTermMemory=false;await chat();check(!calls.some(x=>x.url===LATENT_ENDPOINT)&&!writes.length)});
 await test('未连接记忆不探测不提供工具不写入',async()=>{reset();p.memoryConnected=false;await chat();check(!calls.some(x=>x.url===LATENT_ENDPOINT)&&!writes.length&&!calls[0].body.tools)});
 await test('已查过记忆复用结果，OpenAI 判定保持原样',async()=>{reset();for(const available of [true,false]){check(chatMaintenanceAvailability(c,p,{memoryLookup:{status:available?'found':'failed'}},{available})===available);check(chatMaintenanceAvailability(c,{...p,protocol:'openai'},{},{available})===available)}check(calls.length===0)});
 await test('探测等待期间回复已显示、UI 解锁，切换对话不串写',async()=>{
 reset('pending');textInputEl.value='早安 今天在家';await sendMessage();const origin=c;const task=maintenanceQueues.get(c.id);check(!sendBtnEl.disabled&&chatEl.textContent.includes('宝贝，早安。')&&releaseProbe);const other={...c,id:genId(),messages:[],memoryMaintenance:undefined};conversations.push(other);currentId=other.id;messages=other.messages;releaseProbe();await task;check(writes.length===1&&origin.memoryMaintenance.turns[0].status==='saved'&&other.messages.length===0&&!other.memoryMaintenance);
 });
 await test('session_start 仍只更新目标会话背景',async()=>{reset();const names=[];callLatentTool=async(name,args)=>{names.push(name);return '新窗口背景'};await fetchSessionMemoryFor(c.id);check(names.join(',')==='latent_session_start'&&c.memoryContext==='新窗口背景')});
 await test('手动搜索仍传 query 和 topN=8',async()=>{reset();let got;callLatentTool=async(name,args)=>{got={name,args};return '手动结果'};memorySearchInputEl.value='旧约定';await runMemorySearch();check(got.name==='latent_search'&&got.args.query==='旧约定'&&got.args.topN===8&&memoryResultsEl.textContent.includes('手动结果'))});
 window.fetch=rawFetch;return rows;
 });
 assert.deepEqual(errors,[]);
 }finally{await browser.close()}
 fs.writeFileSync(path.join(root,'verification/availability-results.json'),JSON.stringify(rows,null,2));
 rows.forEach(r=>console.log((r.ok?'PASS ':'FAIL ')+r.name+(r.error?' '+r.error:'')));console.log(rows.filter(r=>r.ok).length+'/'+rows.length);if(rows.some(r=>!r.ok))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
