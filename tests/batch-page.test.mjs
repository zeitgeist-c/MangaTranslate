import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
const sources = await Promise.all(['providers.js','page/queue.js','page-background.js'].map(x=>readFile(new URL('../src/'+x,import.meta.url),'utf8')));
const flush = async()=>{for(let i=0;i<8;i++) await new Promise(r=>setImmediate(r));};
function fixture(cache=new Map(),initialStored={}) {
  const stored={...initialStored}, calls=[];
  const context=vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,AbortController,setTimeout,clearTimeout,console,
    chrome:{runtime:{onMessage:{addListener(){}}},storage:{sync:{get:async()=>({})},local:{get:async key=>Array.isArray(key)?Object.fromEntries(key.map(k=>[k,stored[k]])):({[key]:stored[key]}),set:async x=>Object.assign(stored,x)}}},
    enqueueWithRateLimit:async fn=>fn(),incrementTranslationStats:async()=>{},fetch:async()=>{throw new Error('Real network forbidden');}});
  sources.forEach(s=>vm.runInContext(s,context));
  const actualProviderCall = context.mlProviderCall, actualCapabilities = context.mlCapabilities;
  context.mlCapabilities=async()=>({maxRegions:20,maxOutputTokens:16384,contextLength:1048576,verified:true});
  context.mlOffscreen=async(cmd,p)=>{
    if(cmd==='read')return cache.get(p.key);
    if(cmd==='write')cache.set(p.key,structuredClone(p.value));
    if(cmd==='writeMany')for(const e of p.entries)cache.set(e.key,structuredClone(e.value));
  };
  context.mlProviderCall=async(config,prompt,images)=>{calls.push({config,images});return JSON.stringify({regions:[...images].reverse().map(x=>({regionId:x.regionId,sourceText:'Hello',translatedText:'Merhaba',status:'translated'}))});};
  const config=context.MLProviders.settings({translationProvider:'openrouter'});
  const region=(n,image='a')=>({imageId:image.repeat(64),regionId:image.repeat(64)+':r'+n,crop:'data:image/png;base64,AAAA'});
  return {context,cache,calls,stored,region,actualProviderCall,actualCapabilities,message:regions=>({jobId:'job',owner:'1:job',config,regions,context:[]})};
}
test('extension-wide queue grows 4 to 6 to 8 only after four new successes at each level',async()=>{
  const {context}=fixture();const limits=[],queue=new context.MLQueue(n=>limits.push(n)), releases=[];let active=0,peak=0;
  const jobs=Array.from({length:20},(_,i)=>queue.enqueue(i%2?'tab1':'tab2',async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>releases.push(r));active--;}));
  await flush();assert.equal(active,4);releases.splice(0,4).forEach(r=>r());await flush();assert.equal(queue.limit,6);assert.equal(active,6);
  releases.splice(0,4).forEach(r=>r());await flush();assert.equal(queue.limit,8);assert.equal(active,8);
  while(releases.length){releases.splice(0).forEach(r=>r());await flush();}await Promise.all(jobs);assert.equal(peak,8);assert.deepEqual(limits.slice(0,2),[6,8]);
});
test('quota failure stops unsent groups, halves next explicit retry limit, and lets sent work finish',async()=>{
  const {context}=fixture(),q=new context.MLQueue();const releases=[];let started=0;
  const jobs=Array.from({length:8},()=>q.enqueue('job',async()=>{started++;await new Promise((resolve,reject)=>releases.push({resolve,reject}));}));
  const settled=Promise.allSettled(jobs);await flush();assert.equal(started,4);
  releases[0].reject(Object.assign(new Error('429'),{stopJob:true,code:'PROVIDER_RATE_LIMITED'}));await flush();assert.equal(q.limit,2);assert.equal(q.blocked,true);assert.equal(started,4);
  releases.slice(1).forEach(x=>x.resolve());await settled;
  q.begin('job',true);await q.enqueue('job',async()=>{});assert.equal(q.limit,2);
});
test('pause cancels only unsent owner work while other tabs and sent calls survive',async()=>{
  const {context}=fixture(),q=new context.MLQueue();q.limit=1;let finish,paid=0;
  const first=q.enqueue('tab1',async()=>{paid++;await new Promise(r=>finish=r);});await flush();
  const paused=q.enqueue('tab1',async()=>paid++);const rejection=assert.rejects(paused,e=>e.notSent===true);
  const other=q.enqueue('tab2',async()=>paid++);q.pause('tab1');finish();await Promise.all([first,other,rejection]);assert.equal(paid,2);
});
test('cross-image batches associate reversed replies by identity and regrouped resume uses region cache',async()=>{
  const f=fixture(),rs=[f.region(1),f.region(2,'b')];const first=await f.context.mlTranslate(f.message(rs));
  assert.deepEqual(Array.from(first.regions,r=>r.regionId),rs.map(r=>r.regionId));assert.equal(f.calls.length,1);assert.equal(f.calls[0].config.maxOutputTokens,16384);
  const second=await f.context.mlTranslate(f.message([rs[1]]));assert.equal(second.cached,true);assert.equal(f.calls.length,1);
  const restarted=fixture(f.cache);await restarted.context.mlTranslate(restarted.message(rs));assert.equal(restarted.calls.length,0);
});
test('overlapping live batches reuse existing regions, including regrouping after a pause',async()=>{
  const f=fixture();let release, signalFirst, signalSecond, started=0;const actual=f.context.mlProviderCall;
  const firstStarted=new Promise(r=>signalFirst=r), secondStarted=new Promise(r=>signalSecond=r);
  f.context.mlProviderCall=async(...args)=>{await new Promise(r=>{release=r; (++started===1 ? signalFirst : signalSecond)();});return actual(...args);};
  const first=f.context.mlTranslate(f.message([f.region(1)]));await firstStarted;
  const second=f.context.mlTranslate(f.message([f.region(1),f.region(2)]));await flush();assert.equal(f.calls.length,0);
  release();await first;await secondStarted;release();await second;assert.equal(f.calls.length,2);assert.equal(f.calls[1].images.length,1);
});
test('worker restart never resends an uncertain region without an explicit retry',async()=>{
  const f=fixture();f.context.mlProviderCall=async()=>{throw Object.assign(new Error('timeout'),{stopJob:true,code:'PROVIDER_TIMEOUT'});};
  await assert.rejects(f.context.mlTranslate(f.message([f.region(1)])),/timeout/);
  const next=fixture(f.cache);await assert.rejects(next.context.mlTranslate(next.message([next.region(1)])),e=>e.code==='UNCERTAIN_GROUP');assert.equal(next.calls.length,0);
  const retried=await next.context.mlTranslate({...next.message([next.region(1)]),retry:true});assert.equal(retried.regions.length,1);assert.equal(next.calls.length,1);
});
test('malformed or truncated group replies remain uncertain, preserve successes and stop dispatch',async()=>{
  const f=fixture();await f.context.mlTranslate(f.message([f.region(1)]));
  f.context.mlProviderCall=async()=>'{broken';await assert.rejects(f.context.mlTranslate(f.message([f.region(2)])));
  assert.equal(vm.runInContext('mlRouterQueue.blocked',f.context),true);
  assert.equal((await f.context.mlTranslate(f.message([f.region(1)]))).cached,true);
  assert.ok([...f.cache.values()].some(x=>x.status==='uncertain'));
});
test('batch validation rejects duplicate and mismatched image identities before a call',async()=>{
  const f=fixture(),r=f.region(1);await assert.rejects(f.context.mlTranslate(f.message([r,r])),/Geçersiz/);
  await assert.rejects(f.context.mlTranslate(f.message([{...r,imageId:'b'.repeat(64)}])),/Geçersiz/);assert.equal(f.calls.length,0);
});
test('8 MiB serialized provider body guard rejects oversized requests without network access',async()=>{
  const f=fixture();f.context.mlProviderCall=f.actualProviderCall;let network=0;f.context.fetch=async()=>{network++;throw new Error('network');};f.context.mlKey=async()=> 'synthetic';
  await assert.rejects(f.context.mlProviderCall({provider:'openrouter',model:'qwen/qwen3.8-flash'},'',Array.from({length:3},()=>({dataUrl:'data:image/png;base64,'+'A'.repeat(3000000)}))),e=>e.notSent && e.code==='BATCH_TOO_LARGE');assert.equal(network,0);
});
test('removed OpenRouter models require a new choice; direct Gemini remains supported',()=>{
  const f=fixture();for(const model of ['google/gemini-2.5-flash-lite','google/gemini-3.1-flash-lite','deepseek/deepseek-v4.1-flash'])assert.throws(()=>f.context.MLProviders.settings({translationProvider:'openrouter',openrouterModel:model}),/desteklenmiyor/);
  assert.equal(f.context.MLProviders.settings({geminiModel:'gemini-3.1-flash-lite'}).model,'gemini-3.1-flash-lite');
});
test('metadata uses the smallest documented endpoint capacity and cached public data; unknown metadata keeps 12/8192',async()=>{
  const f=fixture();let requests=0;f.context.fetch=async()=>{requests++;return {ok:true,json:async()=>({data:{endpoints:[{context_length:1048576,max_completion_tokens:32768,max_images:16},{context_length:262144,max_completion_tokens:16384,max_images:10}]}})};};
  const caps=await f.actualCapabilities({provider:'openrouter',model:'qwen/qwen3.8-flash'});assert.equal(caps.maxRegions,10);assert.equal(caps.maxOutputTokens,16384);assert.equal(caps.contextLength,262144);
  await f.actualCapabilities({provider:'openrouter',model:'qwen/qwen3.8-flash'});assert.equal(requests,1);
  f.context.fetch=async()=>{throw new Error('Unavailable public catalog');};const fallback=await f.actualCapabilities({provider:'openrouter',model:'other'});assert.equal(fallback.maxRegions,12);assert.equal(fallback.maxOutputTokens,8192);assert.equal(fallback.verified,false);
  f.context.fetch=async()=>({ok:true,json:async()=>({data:{endpoints:[{context_length:131072,max_completion_tokens:2048}]}})});
  const small=await f.actualCapabilities({provider:'openrouter',model:'small-output'});assert.equal(small.maxRegions,3);assert.equal(small.maxOutputTokens,2048);
});
test('in-flight budget refusal is distinct from an exhausted balance',async()=>{
  const f=fixture();f.context.mlKey=async()=> 'synthetic';f.context.fetch=async()=>new Response(JSON.stringify({error:{message:'In flight',metadata:{limit_source:'openrouter_in_flight_budget'}}}),{status:402,headers:{'Content-Type':'application/json'}});
  await assert.rejects(f.actualProviderCall({provider:'openrouter',model:'qwen/qwen3.8-flash'},'',[]),e=>e.code==='PROVIDER_IN_FLIGHT_BUDGET'&&e.stopJob);
});

test('model metadata excludes JSON-incompatible and unavailable endpoints and ignores v1 cache',async()=>{
  const f=fixture();
  f.stored['ml-model-capabilities:qwen/qwen3.8-flash']={expires:Date.now()+100000,value:{maxRegions:20,maxOutputTokens:16384}};
  f.context.fetch=async()=>({ok:true,json:async()=>({data:{endpoints:[
    {status:0,context_length:1048576,max_completion_tokens:2000,supported_parameters:['max_tokens','reasoning']},
    {status:-5,context_length:1048576,max_completion_tokens:1000,supported_parameters:['max_tokens','reasoning','response_format','structured_outputs']},
    {status:0,context_length:1048576,max_completion_tokens:32768,supported_parameters:['max_tokens','reasoning','response_format','structured_outputs']}
  ]}})});
  const caps=await f.actualCapabilities({provider:'openrouter',model:'qwen/qwen3.8-flash'});
  assert.equal(caps.maxRegions,12);assert.equal(caps.maxOutputTokens,16384);
});

test('known incompatible model metadata refuses before translation, without paid probing',async()=>{
  const f=fixture();let fetched=0;
  f.context.fetch=async()=>{fetched++;return {ok:true,json:async()=>({data:{endpoints:[{status:0,supported_parameters:['max_tokens','reasoning']}]}})};};
  f.context.mlCapabilities=f.actualCapabilities;
  await assert.rejects(f.context.mlTranslate(f.message([f.region(1)])),e=>e.code==='MODEL_PARAMETERS_UNAVAILABLE'&&e.notSent);
  assert.equal(fetched,1);assert.equal(f.calls.length,0);
});
test('stream reader preserves split UTF-8 and ignores reasoning while requiring explicit completion',async()=>{
  const f=fixture(),bytes=new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning":"secret"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"İŞĞ"}}]}\r\n\r\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n');
  const stream=new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.slice(i,i+3));controller.close();}});
  const value=await f.context.mlReadStream(new Response(stream));assert.equal(value.choices[0].message.content,'İŞĞ');
  await assert.rejects(f.context.mlReadStream(new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')),/eksik/);
});
test('Qwen watchdog is 90 seconds and timeout is never silently retried',async()=>{
  const f=fixture();let watchdog,limit,network=0;f.context.setTimeout=(fn,ms)=>{watchdog=fn;limit=ms;return 1;};f.context.clearTimeout=()=>{};f.context.mlKey=async()=> 'synthetic';
  f.context.fetch=async(url,options)=>{network++;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));};
  const promise=f.actualProviderCall({provider:'openrouter',model:'qwen/qwen3.8-flash'},'',[]);await flush();assert.equal(limit,90000);watchdog();await assert.rejects(promise,e=>e.code==='PROVIDER_TIMEOUT'&&e.stopJob);assert.equal(network,1);
});
test('failed pending reservation prevents a provider call; successful results survive stats failure',async()=>{
  const f=fixture(),actual=f.context.mlOffscreen;f.context.mlOffscreen=async(cmd,p)=>{if(cmd==='writeMany')throw new Error('Disk full');return actual(cmd,p);};
  await assert.rejects(f.context.mlTranslate(f.message([f.region(1)])),e=>e.code==='LOCAL_STORAGE_FAILED'&&e.notSent);assert.equal(f.calls.length,0);
  const next=fixture();next.context.incrementTranslationStats=async()=>{throw new Error('Stats write failed');};
  await next.context.mlTranslate(next.message([next.region(1)]));assert.equal((await next.context.mlTranslate(next.message([next.region(1)]))).cached,true);assert.equal(next.calls.length,1);
});
test('known context overflow is rejected before any provider submission',async()=>{
  const f=fixture();f.context.mlCapabilities=async()=>({maxRegions:20,maxOutputTokens:8192,contextLength:9000});
  await assert.rejects(f.context.mlTranslate(f.message([f.region(1)])),e=>e.notSent&&e.code==='CONTEXT_LIMIT');assert.equal(f.calls.length,0);
});
test('a new explicit manual selection is not trapped by another chapter account block',async()=>{
  const f=fixture();await assert.rejects(f.context.mlEnqueue({provider:'openrouter'},async()=>{throw Object.assign(new Error('account'),{stopJob:true,code:'PROVIDER_AUTH_REQUIRED'});},'old-chapter'));
  assert.equal(await f.context.mlEnqueue({provider:'openrouter'},async()=> 'new manual action'),'new manual action');
});

test('late failure from an old owner cannot cancel a new owner or another tab',async()=>{
  const {context}=fixture(),q=new context.MLQueue();q.limit=1;let fail;
  const old=q.enqueue('old',()=>new Promise((_,reject)=>fail=reject));const rejected=assert.rejects(old,/old failure/);await flush();
  q.begin('new');let newCalls=0;const fresh=q.enqueue('new',async()=>++newCalls);
  fail(Object.assign(new Error('old failure'),{stopJob:true}));await Promise.all([rejected,fresh]);
  assert.equal(newCalls,1);assert.equal(q.isBlocked('old'),true);assert.equal(q.isBlocked('new'),false);
});

test('model lanes cap concurrent sends across owners without starving a different model',async()=>{
  const {context}=fixture(),q=new context.MLQueue();q.limit=8;const releases=[];let active=0,peak=0,other=0;
  const jobs=Array.from({length:5},(_,i)=>q.enqueue('owner'+i,async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>releases.push(r));active--;},{lane:'slow',maxConcurrency:2}));
  const fast=q.enqueue('other',async()=>++other,{lane:'fast',maxConcurrency:8});await flush();
  assert.equal(peak,2);assert.equal(other,1);
  while(releases.length){releases.splice(0).forEach(r=>r());await flush();}await Promise.all([...jobs,fast]);assert.equal(peak,2);
});

test('known IDs with one malformed translation retain neighboring successes and never auto-retry',async()=>{
  const f=fixture();f.context.mlProviderCall=async(config,prompt,images)=>{f.calls.push(images);return JSON.stringify({regions:images.map((r,i)=>({regionId:r.regionId,sourceText:'Hello',translatedText:i?null:'Merhaba',status:'translated'}))});};
  const rs=[f.region(1),f.region(2)],result=await f.context.mlTranslate(f.message(rs));
  assert.equal(result.regions[0].translatedText,'Merhaba');assert.equal(result.regions[1].validationError,'invalid_translation_result');
  assert.equal((await f.context.mlTranslate(f.message(rs))).cached,true);assert.equal(f.calls.length,1);
});

test('Muse models keep a bounded 60 second deadline',async()=>{
  for(const [model,ms] of [['meta/muse-spark-1.3',60000],['meta/muse-spark-1.3-contributor',60000]]){
    const f=fixture();let watchdog,limit,network=0;f.context.setTimeout=(fn,ms)=>{watchdog=fn;limit=ms;return 1;};f.context.clearTimeout=()=>{};f.context.mlKey=async()=> 'synthetic';
    f.context.fetch=async(url,options)=>{network++;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));};
    const promise=f.actualProviderCall({provider:'openrouter',model},'',[]);await flush();assert.equal(limit,ms);watchdog();
    await assert.rejects(promise,e=>e.code==='PROVIDER_TIMEOUT'&&e.message.includes(model));assert.equal(network,1);
  }
});

test('provider-origin 429 is model-scoped, survives restart, and blocks only unsent matching work',async()=>{
  const f=fixture();f.context.mlKey=async()=> 'synthetic';f.context.fetch=async()=>new Response(JSON.stringify({error:{message:'provider quota',metadata:{provider_name:'Anthropic'}}}),{status:429,headers:{'Retry-After':'60','Content-Type':'application/json'}});
  await assert.rejects(f.actualProviderCall({provider:'openrouter',model:'anthropic/claude-haiku-5.5'},'',[]),e=>e.code==='PROVIDER_RATE_LIMITED'&&e.cooldownScope==='model'&&e.retryAt>Date.now());
  let sent=0;await assert.rejects(f.context.mlEnqueue({provider:'openrouter',model:'anthropic/claude-haiku-5.5'},async()=>++sent),e=>e.notSent&&e.code==='PROVIDER_COOLDOWN');
  assert.equal(await f.context.mlEnqueue({provider:'openrouter',model:'meta/muse-spark-1.3'},async()=>++sent),1);
  const restarted=fixture(undefined,f.stored);
  await restarted.context.mlEnqueue({provider:'openrouter',model:'meta/muse-spark-1.3'},async()=>{});
  assert.equal(restarted.context.mlCooldownError('anthropic/claude-haiku-5.5').notSent,true);assert.equal(sent,1);
});

test('unknown 429 remains account-wide and clearly identifies the source instead of blaming the next model',async()=>{
  const f=fixture();f.context.mlKey=async()=> 'synthetic';f.context.fetch=async()=>new Response(JSON.stringify({error:{message:'account quota'}}),{status:429,headers:{'Retry-After':'30','Content-Type':'application/json'}});
  await assert.rejects(f.actualProviderCall({provider:'openrouter',model:'anthropic/claude-haiku-5.5'},'',[]),e=>e.cooldownScope==='account');
  let sent=0;await assert.rejects(f.context.mlEnqueue({provider:'openrouter',model:'meta/muse-spark-1.3'},async()=>++sent),e=>e.notSent&&e.message.includes('claude-haiku-5.5')&&e.message.includes('henüz gönderilmedi'));
  assert.equal(sent,0);
});

test('SSE 429 also honors Retry-After and records a model-scoped cooldown',async()=>{
  const f=fixture();f.context.mlKey=async()=> 'synthetic';
  f.context.fetch=async()=>new Response('data: '+JSON.stringify({error:{code:429,message:'provider quota',metadata:{provider_name:'Alibaba'}}})+'\n\n',
    {headers:{'Retry-After':'45','Content-Type':'text/event-stream'}});
  await assert.rejects(f.actualProviderCall({provider:'openrouter',model:'qwen/qwen3.8-flash',maxOutputTokens:16384},'',[]),e=>e.code==='PROVIDER_RATE_LIMITED'&&e.retryAt>Date.now()+40000);
  assert.equal(f.context.mlCooldownError('qwen/qwen3.8-flash').cooldownScope,'model');
  assert.equal(f.context.mlCooldownError('meta/muse-spark-1.3'),null);
});

test('model-specific crop limits preserve Muse throughput and constrain slower model batches',async()=>{
  const f=fixture();f.context.fetch=async()=>({ok:true,json:async()=>({data:{endpoints:[{status:0,context_length:1048576,max_completion_tokens:32768}]}})});
  for(const [model,regions,pending] of [['qwen/qwen3.8-flash',12,4],['anthropic/claude-haiku-5.5',12,4],['meta/muse-spark-1.3',20,8]]){
    const caps=await f.actualCapabilities({provider:'openrouter',model});assert.equal(caps.maxRegions,regions);assert.equal(caps.maxPending,pending);
  }
});
test('a provider timeout temporarily shrinks later groups until one succeeds',async()=>{
  const f=fixture();f.context.mlKey=async()=>'synthetic';
  const timers=[];f.context.setTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length;};f.context.clearTimeout=()=>{};
  f.context.fetch=async(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));
  const images=Array.from({length:8},(_,i)=>({regionId:'r'+i,dataUrl:'data:image/png;base64,AAAA'}));
  const promise=f.actualProviderCall({provider:'openrouter',model:'meta/muse-spark-1.3'},'',images);
  await flush();timers.at(-1).fn();
  await assert.rejects(promise,e=>e.code==='PROVIDER_TIMEOUT'&&e.message.includes('küçültüldü'));
  f.context.fetch=async()=>({ok:true,json:async()=>({data:{endpoints:[{status:0,context_length:1048576,max_completion_tokens:32768}]}})});
  assert.equal((await f.actualCapabilities({provider:'openrouter',model:'meta/muse-spark-1.3'})).maxRegions,4);
  const message={jobId:'job',owner:'1:job',config:f.context.MLProviders.settings({translationProvider:'openrouter',openrouterModel:'meta/muse-spark-1.3'}),regions:[f.region(1)],context:[]};
  await f.context.mlTranslate(message);
  assert.equal((await f.actualCapabilities({provider:'openrouter',model:'meta/muse-spark-1.3'})).maxRegions,20);
});
test('streaming groups use an idle watchdog with a doubled absolute deadline',async()=>{
  const hang=()=>{const f=fixture();f.context.mlKey=async()=>'synthetic';
    const timers=[];f.context.setTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length;};f.context.clearTimeout=()=>{};
    f.context.fetch=async(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));
    return {f,timers};};
  { const {f,timers}=hang();
    const promise=f.actualProviderCall({provider:'openrouter',model:'qwen/qwen3.8-flash',maxOutputTokens:16384},'',[{regionId:'r',dataUrl:'data:image/png;base64,AAAA'}]);
    await flush();assert.deepEqual(timers.map(t=>t.ms).sort((a,b)=>a-b),[90000,180000]);
    timers.find(t=>t.ms===180000).fn();
    await assert.rejects(promise,e=>e.code==='PROVIDER_TIMEOUT'&&e.message.includes('saniyede yanıt vermedi')); }
  { const {f,timers}=hang();
    const promise=f.actualProviderCall({provider:'openrouter',model:'qwen/qwen3.8-flash',maxOutputTokens:16384},'',[{regionId:'r',dataUrl:'data:image/png;base64,AAAA'}]);
    await flush();timers.find(t=>t.ms===90000).fn();
    await assert.rejects(promise,e=>e.code==='PROVIDER_TIMEOUT'&&e.message.includes('ilerlemedi')); }
});
test('stream reader reports activity per received chunk',async()=>{
  const f=fixture(),nl=String.fromCharCode(10);
  const frame=obj=>'data: '+JSON.stringify(obj)+nl+nl;
  const bytes=new TextEncoder().encode(frame({choices:[{delta:{content:'İŞĞ'}}]})+frame({choices:[{delta:{},finish_reason:'stop'}]})+'data: [DONE]'+nl+nl);
  const stream=new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.slice(i,i+3));controller.close();}});
  let pings=0;const value=await f.context.mlReadStream(new Response(stream),()=>pings++);
  assert.equal(value.choices[0].message.content,'İŞĞ');assert.ok(pings>0);
});
