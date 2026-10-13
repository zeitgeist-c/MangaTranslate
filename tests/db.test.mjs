import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dbBoxes} from '../src/page/lib/db.mjs';
import {groupTextLines} from '../src/page/layout.mjs';
test('DB quad scores and round-unclip bounds agree with independent OpenCV/Pyclipper reference',async()=>{
  const fixture=JSON.parse(await readFile(new URL('../evaluation/fixtures/db-reference.json',import.meta.url)));
  for(const c of fixture.cases){
    const values=new Float32Array(c.width*c.height).fill(.01);c.runs.forEach(([start,length])=>values.fill(.95,start,start+length));
    const actual=dbBoxes(values,c.width,c.height).sort((a,b)=>a.box[1]-b.box[1]||a.box[0]-b.box[0]);
    assert.equal(actual.length,c.expected.length,c.name);
    actual.forEach((r,i)=>{r.box.forEach((v,j)=>assert.ok(Math.abs(v-c.expected[i].box[j])<=2,c.name+' coordinate parity'));assert.ok(Math.abs(r.score-c.expected[i].score)<.03,c.name+' score parity');});
  }
});
test('DB uses masked rectangle score, not only high-probability component pixels',()=>{
  const values=new Float32Array(40*40);for(let y=5;y<30;y++)for(let x=5;x<30;x++)if(x<8||x>26||y<8||y>26)values[y*40+x]=.95;
  assert.equal(dbBoxes(values,40,40).length,0,'Sparse art ring cannot pass on foreground-only average');
});
test('DB expansion cannot merge distinct paragraphs solely because expanded rectangles touch',()=>{
  const result=groupTextLines({imageId:'x',regions:[{textBox:[0,0,160,50],inkBox:[10,10,150,30],score:.9},{textBox:[0,90,160,140],inkBox:[10,100,150,120],score:.9}]});
  assert.equal(result.length,2);
});
