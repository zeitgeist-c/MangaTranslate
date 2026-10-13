// Actual extension UI, synthetic credentials only. No provider requests.
import { chromium } from 'playwright-core';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root=resolve('..'), output=join(root,'store','assets'), profile=await mkdtemp(join(tmpdir(),'mangalens-store-demo-'));
await mkdir(output,{recursive:true});
const browser=await chromium.launchPersistentContext(profile,{executablePath:process.env.BRAVE_EXECUTABLE,headless:true,
 args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`,'--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND'],
 ignoreDefaultArgs:['--disable-extensions'],viewport:{width:1280,height:800}});
try {
 const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
 await worker.evaluate(async()=>{
  globalThis.fetch=async()=>{throw new Error('Store assets: network forbidden');};
  await chrome.storage.local.set({openrouterApiKeys:[{id:'demo',label:'Örnek hesap',key:'sk-or-demo-not-a-real-key-000000000000'}],activeOpenrouterApiKeyId:'demo',openrouterApiKey:'sk-or-demo-not-a-real-key-000000000000'});
  await chrome.storage.sync.set({translationProvider:'openrouter',openrouterModel:'qwen/qwen3.8-flash',enabled:true});
 });
 const base=`chrome-extension://${new URL(worker.url()).host}/`,page=await browser.newPage();
 await page.goto(base+'options/settings.html#keys/openrouter');
 await page.waitForSelector('.key-card');
 await page.screenshot({path:join(output,'settings.png')});
 await page.getByRole('button',{name:'Çeviri Tercihleri',exact:true}).click();
 await page.screenshot({path:join(output,'preferences.png')});
 const promo=await browser.newPage();await promo.setViewportSize({width:440,height:280});
 await promo.setContent('<html lang="tr"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:36px;background:#111722;color:#eef4ff;font-family:Arial}small{color:#8fa6c9}h1{margin:18px 0;font-size:36px}p{line-height:1.5;font-size:18px}.mark{color:#79a8ff;font-weight:700;letter-spacing:3px}</style><div class="mark">ML · TÜRKÇE ÇEVİRİ</div><h1>MangaLens TR</h1><p>Manga · Manhwa · Manhua<br>Seç, çevir, okumaya devam et.</p><small>Kendi Gemini / OpenRouter API anahtarınla</small></html>');
 await promo.screenshot({path:join(output,'small-promo.png')});
 await copyFile(join(root,'assets','icon128.png'),join(output,'icon128.png'));
 await writeFile(join(output,'README.md'),'# Mağaza görselleri\n\nsettings.png ve preferences.png: 1280×800, gerçek 3.8.1 arayüzü, temsili anahtar kaydı. Gerçek anahtar, manga içeriği veya canlı API kullanılmadı. small-promo.png: 440×280. icon128.png: mevcut uygulama ikonu. Çeviri kartı ekran görüntüsü henüz bu sete dahil değil.\n');
 console.log(JSON.stringify({screenshots:2,size:[1280,800],promo:[440,280],realProviderCalls:0}));
} finally {await browser.close();await rm(profile,{recursive:true,force:true});}
