"""Generate public synthetic DB-quad golden fixtures using PaddleOCR's algorithm.
Reference: PaddlePaddle/PaddleOCR ppocr/postprocess/db_postprocess.py (Apache-2.0).
Only test dependencies in evaluation/.local/db-reference; not extension runtime.
"""
import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'.local/db-reference'))
import numpy as np
import cv2,pyclipper
from shapely.geometry import Polygon

cases=[]
for name,polygons,holes in [
 ('rectangle',[[[12,12],[45,12],[45,23],[12,23]]],[]),
 ('rotated',[[[15,18],[39,30],[33,42],[9,30]]],[]),
 ('separated',[[[5,10],[23,10],[23,20],[5,20]],[[38,40],[57,40],[57,52],[38,52]]],[]),
 ('ink-hole',[[[10,10],[50,10],[50,35],[10,35]]],[[[25,15],[33,15],[33,25],[25,25]]])]:
 values=np.full((64,64),.01,dtype=np.float32)
 for poly in polygons:cv2.fillPoly(values,[np.array(poly,dtype=np.int32)],.95)
 for poly in holes:cv2.fillPoly(values,[np.array(poly,dtype=np.int32)],.01)
 contours,_=cv2.findContours((values>.3).astype(np.uint8),cv2.RETR_LIST,cv2.CHAIN_APPROX_SIMPLE)
 result=[]
 for contour in contours[:1000]:
  rect=cv2.minAreaRect(contour)
  if min(rect[1])<3:continue
  box=cv2.boxPoints(rect); mask=np.zeros(values.shape,dtype=np.uint8);cv2.fillPoly(mask,[box.astype(np.int32)],1)
  score=float(cv2.mean(values,mask)[0])
  if score<.6:continue
  polygon=Polygon(box);distance=polygon.area*1.5/polygon.length
  offset=pyclipper.PyclipperOffset();offset.AddPath(box,pyclipper.JT_ROUND,pyclipper.ET_CLOSEDPOLYGON);expanded=offset.Execute(distance)
  if len(expanded)!=1:continue
  r=cv2.minAreaRect(np.array(expanded[0],dtype=np.float32))
  if min(r[1])<5:continue
  q=np.clip(np.round(cv2.boxPoints(r)),0,64)
  result.append({'box':[float(q[:,0].min()),float(q[:,1].min()),float(q[:,0].max()),float(q[:,1].max())],'score':score})
 result.sort(key=lambda r:(r['box'][1],r['box'][0]))
 # Preserve OpenCV input raster exactly using runs of positive pixels.
 runs=[]
 flat=values.reshape(-1);i=0
 while i<len(flat):
  if flat[i]<.3:i+=1;continue
  start=i
  while i<len(flat) and flat[i]>.3:i+=1
  runs.append([start,i-start])
 cases.append({'name':name,'width':64,'height':64,'runs':runs,'expected':result})
out=Path(__file__).resolve().parents[1]/'fixtures/db-reference.json';out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps({'source':'PaddleOCR DB quad fast-score (.3/.6/unclip1.5), OpenCV 4.12, pyclipper 1.3.0.post6','cases':cases},indent=2)+'\n',encoding='utf-8')
print(json.dumps({c['name']:c['expected'] for c in cases}))
