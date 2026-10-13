// DB quad postprocess, following PaddleOCR DBPostProcess.boxes_from_bitmap:
// bitmap .3 -> external contours -> minimum-area rectangle -> masked mean .6
// -> area * 1.5 / perimeter unclip -> minimum-area expanded quad.
// PaddleOCR is Apache-2.0; see ../licenses/PaddleOCR-Apache-2.0.txt.
// For a convex rectangle, a round offset's minimum-area rectangle is exactly
// the original rectangle expanded by distance on each side; no polygon library
// or remotely loaded executable is required. Integer raster parity is tested.
export function hull(points) {
  const sorted = points.sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  const cross = (o,a,b) => (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const half = values => { const result=[]; for (const p of values) { while(result.length>1 && cross(result.at(-2),result.at(-1),p)<=0) result.pop(); result.push(p); } return result; };
  return [...half(sorted).slice(0,-1), ...half([...sorted].reverse()).slice(0,-1)];
}
export function minimumRect(points) {
  const polygon = hull(points); let best;
  for (let i=0;i<polygon.length;i++) {
    const a=polygon[i], b=polygon[(i+1)%polygon.length], angle=Math.atan2(b[1]-a[1],b[0]-a[0]), c=Math.cos(angle), s=Math.sin(angle);
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const [x,y] of polygon) { const u=x*c+y*s,v=-x*s+y*c; x0=Math.min(x0,u);x1=Math.max(x1,u);y0=Math.min(y0,v);y1=Math.max(y1,v); }
    const area=(x1-x0)*(y1-y0);
    if(!best || area<best.area-1e-7) best={x0,y0,x1,y1,c,s,area};
  }
  return best;
}
function rasterRows(corners,width,height) {
  const points=corners.map(p=>p.map(Math.trunc)), rows=new Map();
  const put=(x,y)=>{if(y<0||y>=height)return;const row=rows.get(y)||[Infinity,-Infinity];row[0]=Math.min(row[0],x);row[1]=Math.max(row[1],x);rows.set(y,row);};
  for(let i=0;i<points.length;i++) {
    let [x,y]=points[i];const [endX,endY]=points[(i+1)%points.length],dx=Math.abs(endX-x),dy=-Math.abs(endY-y),sx=x<endX?1:-1,sy=y<endY?1:-1;let error=dx+dy;
    for(;;){put(x,y);if(x===endX&&y===endY)break;const doubled=2*error;if(doubled>=dy){error+=dy;x+=sx;}if(doubled<=dx){error+=dx;y+=sy;}}
  }
  return rows;
}
export function dbBoxes(values,width,height,{pixelThreshold=.3,scoreThreshold=.6,unclipRatio=1.5,maxCandidates=1000}={}) {
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||values.length!==width*height) throw new Error('Invalid DB map');
  const seen=new Uint8Array(values.length), queue=new Int32Array(values.length), result=[]; let candidates=0;
  for(let start=0;start<values.length;start++) {
    if(seen[start] || !(values[start]>pixelThreshold)) continue;
    let head=0,tail=1; queue[0]=start;seen[start]=1;const boundary=[];
    while(head<tail) {
      const index=queue[head++], x=index%width,y=Math.floor(index/width);let edge=false;
      for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
        if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;
        if(nx<0||ny<0||nx>=width||ny>=height) {edge=true;continue;}
        const next=ny*width+nx;
        if(!(values[next]>pixelThreshold)){edge=true;continue;}
        if(!seen[next]){seen[next]=1;queue[tail++]=next;}
      }
      if(edge)boundary.push([x,y]);
    }
    if(++candidates>maxCandidates || boundary.length<3) continue;
    const r=minimumRect(boundary); if(!r||Math.min(r.x1-r.x0,r.y1-r.y0)<3)continue;
    const corners=[[r.x0,r.y0],[r.x1,r.y0],[r.x1,r.y1],[r.x0,r.y1]].map(([u,v])=>[u*r.c-v*r.s,u*r.s+v*r.c]);
    const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]);let total=0,count=0;
    for(const [y,[left,right]] of rasterRows(corners,width,height))
      for(let x=Math.max(0,left);x<=Math.min(width-1,right);x++){total+=values[y*width+x];count++;}
    const score=total/count;if(!count||score<scoreThreshold)continue;
    const distance=r.area*unclipRatio/(2*(r.x1-r.x0+r.y1-r.y0));
    if(Math.min(r.x1-r.x0,r.y1-r.y0)+2*distance<5)continue;
    const quad=[[r.x0-distance,r.y0-distance],[r.x1+distance,r.y0-distance],[r.x1+distance,r.y1+distance],[r.x0-distance,r.y1+distance]].map(([u,v])=>[Math.max(0,Math.min(width,u*r.c-v*r.s)),Math.max(0,Math.min(height,u*r.s+v*r.c))]);
    result.push({box:[Math.min(...quad.map(p=>p[0])),Math.min(...quad.map(p=>p[1])),Math.max(...quad.map(p=>p[0])),Math.max(...quad.map(p=>p[1]))],inkBox:[Math.max(0,Math.min(...xs)),Math.max(0,Math.min(...ys)),Math.min(width,Math.max(...xs)),Math.min(height,Math.max(...ys))],quad,score});
  }
  return result;
}
