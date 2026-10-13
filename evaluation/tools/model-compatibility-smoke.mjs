import { chromium } from 'playwright-core';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(process.env.ML_EXTENSION_ROOT||'..'),profile=await mkdtemp(join(tmpdir(),'mangalens-model-compat-'));
const browser=await chromium.launchPersistentContext(profile,{executablePath:process.env.BRAVE_EXECUTABLE,headless:true,
  args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`,'--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND'],
  ignoreDefaultArgs:['--disable-extensions'],viewport:{width:360,height:800}});
try {
  const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
  await worker.evaluate(async()=>{
    await chrome.storage.local.set({openrouterApiKey:'sk-or-synthetic-model-audit-000000000000'});
    await chrome.storage.sync.set({translationProvider:'openrouter',contributorConsent:true});
    globalThis.__modelCalls=[];
    globalThis.fetch=async(url,options)=>{
      if(String(url)!=='https://openrouter.ai/api/v1/chat/completions')throw new Error('External network forbidden');
      const body=JSON.parse(options.body),requiresOff=body.model.startsWith('qwen/')||body.model.startsWith('deepseek/');
      if(body.provider.require_parameters!==true||body.provider.allow_fallbacks!==false)throw new Error('Routing policy missing');
      if(requiresOff&&body.reasoning?.enabled!==false)return new Response(JSON.stringify({error:{message:'thinking/JSON incompatible'}}),{status:400});
      if(!requiresOff&&body.reasoning!==undefined)throw new Error('Working model reasoning changed');
      const ids=body.messages[0].content.filter(x=>x.type==='text'&&x.text.startsWith('regionId=')).map(x=>x.text.slice(9));
      const content=JSON.stringify({regions:ids.reverse().map(regionId=>({regionId,sourceText:'Hello',translatedText:'Merhaba',status:'translated'}))});
      __modelCalls.push({model:body.model,stream:body.stream,images:ids.length,reasoningDisabled:requiresOff});
      if(!body.stream)return new Response(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});
      return new Response('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
    };
  });
  const popup=await browser.newPage();await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup/popup.html`);
  await popup.waitForFunction(()=>document.querySelector('#model').options.length===6);
  const models=await worker.evaluate(()=>MLProviders.catalog.openrouter.map(([id])=>id));
  for(const model of models){
    await popup.locator('#model').selectOption(model);
    await popup.waitForFunction(async model=>(await chrome.storage.sync.get('openrouterModel')).openrouterModel===model,model);
    await popup.waitForFunction(()=>!document.querySelector('#btn-full-chapter').disabled);
    const result=await worker.evaluate(async model=>{
      const config=MLProviders.settings({translationProvider:'openrouter',openrouterModel:model,contributorConsent:true});
      const images=[{regionId:'a:r1',dataUrl:'data:image/png;base64,AAAA'},{regionId:'b:r2',dataUrl:'data:image/png;base64,AAAA'}];
      const outputs=[];
      for(const streaming of [false,true]){
        const raw=await mlProviderCall({...config,...(streaming?{maxOutputTokens:16384}:{})},MLProviders.prompt(config,images),images);
        outputs.push(MLProviders.parse(raw,images.map(r=>r.regionId)).map(r=>r.regionId));
      }
      return outputs;
    },model);
    assert.deepEqual(result,[['a:r1','b:r2'],['a:r1','b:r2']]);
  }
  const calls=await worker.evaluate(()=>__modelCalls);assert.equal(calls.length,12);
  const result={version:await worker.evaluate(()=>chrome.runtime.getManifest().version),models,calls,uiSelectionPersists:true,shuffledRepliesPreserveIdentity:true,realProviderCalls:0};
  await mkdir('reports',{recursive:true});await writeFile('reports/model-compatibility-3.8.1.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await rm(profile,{recursive:true,force:true});}
