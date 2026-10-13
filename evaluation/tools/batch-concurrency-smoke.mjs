import {chromium} from 'playwright-core';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(join(tmpdir(),'mangalens-batch-'));
const browser=await chromium.launchPersistentContext(profile,{executablePath:process.env.BRAVE_EXECUTABLE,headless:true,args:[`--disable-extensions-except=${resolve('..')}`,`--load-extension=${resolve('..')}`],ignoreDefaultArgs:['--disable-extensions']});
try {
  const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
  const output=await worker.evaluate(async()=>{
    await chrome.storage.local.set({openrouterApiKey:'synthetic-never-real'});
    const actual=fetch;let active=0,peak=0,calls=0;const records=[];
    globalThis.fetch=async(url,options)=>{
      if(String(url).includes('/endpoints'))return new Response(JSON.stringify({data:{endpoints:[{context_length:1048576,max_completion_tokens:32768}]}}),{headers:{'Content-Type':'application/json'}});
      if(!String(url).includes('/chat/completions')){if(/openrouter|googleapis/.test(String(url)))throw new Error('Unexpected external provider call');return actual(url,options);}
      const body=JSON.parse(options.body),ids=body.messages[0].content.filter(p=>p.type==='text'&&p.text.startsWith('regionId=')).map(p=>p.text.slice(9));
      const index=calls++,delay=index===0?32000:15000;active++;peak=Math.max(peak,active);records.push({regions:ids.length,delay,maxTokens:body.max_tokens,stream:body.stream});
      const encoder=new TextEncoder();
      return new Response(new ReadableStream({start(controller){
        controller.enqueue(encoder.encode(': connected\n\n'));
        setTimeout(()=>{
          const content=JSON.stringify({regions:[...ids].reverse().map(regionId=>({regionId,sourceText:'Synthetic',translatedText:'DENEME',status:'translated'}))});
          controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content},finish_reason:null}]})+'\n\n'));
          controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'));active--;controller.close();
        },delay);
      }}),{headers:{'Content-Type':'text/event-stream'}});
    };
    const config=MLProviders.settings({translationProvider:'openrouter'}),regions=Array.from({length:184},(_,i)=>({imageId:(i<92?'a':'b').repeat(64),regionId:(i<92?'a':'b').repeat(64)+':synthetic:'+i,crop:'data:image/png;base64,AAAA'}));
    const started=performance.now(),operations=[];
    for(let i=0;i<regions.length;i+=20)operations.push(mlTranslate({jobId:'synthetic184',owner:(i%40?'1':'2')+':synthetic184',config,regions:regions.slice(i,i+20),context:[]}));
    const results=await Promise.all(operations),wallMs=performance.now()-started;
    return {version:chrome.runtime.getManifest().version,regions:results.reduce((n,r)=>n+r.regions.length,0),calls,peak,wallMs,records,queueLimit:mlRouterQueue.limit,groupTimings:results.map(r=>r.timing),realProviderCalls:0,synthetic:true,late32SecondSuccess:true};
  });
  assert.equal(output.regions,184);assert.equal(output.calls,10);assert.ok(output.peak>=4&&output.peak<=8);assert.equal(output.queueLimit,8);assert.ok(output.wallMs<=120000);assert.ok(output.records.every(r=>r.stream&&r.regions<=20&&r.maxTokens===16384));
  await mkdir('reports',{recursive:true});await writeFile('reports/batch-concurrency-smoke.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output));
}finally{await browser.close();}
