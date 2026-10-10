export const FPS = 20;
export const IMPORTANT = [11,12,13,14,15,16,23,24,25,26,27,28];
export const EDGES = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[28,30],[30,32]];
export const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
export function formatTime(t){const n=Math.max(0,Number.isFinite(t)?t:0);return `${String(Math.floor(n/60)).padStart(2,'0')}:${(n%60).toFixed(2).padStart(5,'0')}`;}
export function frameIndex(t,frames){if(!frames.length)return -1;let lo=0,hi=frames.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(frames[mid].t<=t)lo=mid;else hi=mid-1;}return lo;}
export function validPoint(p){return p && [p.x,p.y,p.z].every(Number.isFinite);}
export function makeFrame(t,result){
  const landmarks=result.landmarks?.[0],world=result.worldLandmarks?.[0];
  if(!landmarks||!world||world.length!==33||landmarks.length!==33||world.some(p=>!validPoint(p)))return {t,screen:null,points:null,confidence:0,issue:'未检测到完整人体'};
  const visibility=landmarks.map(p=>Number.isFinite(p.visibility)?p.visibility:0);
  const confidence=Math.min(...IMPORTANT.map(i=>visibility[i]));
  const cropped=IMPORTANT.some(i=>landmarks[i].x<0||landmarks[i].x>1||landmarks[i].y<0||landmarks[i].y>1);
  return {t,screen:landmarks.map(p=>[p.x,p.y,p.visibility??0]),points:world.map(p=>[p.x,-p.y,-p.z]),confidence,issue:cropped?'身体部分出画':confidence<0.55?'部分关节被遮挡或识别不稳定':null};
}
export function smoothFrames(raw){
  // One light time-aware pass, reset at missing/uncertain frames. Preserve raw observations for audit.
  let previous=null;
  return raw.map(f=>{
    if(!f.points||f.issue){previous=null;return {...f};}
    if(previous){const dt=f.t-previous.t;const alpha=1-Math.exp(-Math.max(dt,0)/0.035);
      const jump=IMPORTANT.some(i=>Math.hypot(...f.points[i].map((v,k)=>v-previous.points[i][k]))>0.5);
      if(jump){previous=null;return {...f,issue:'关节位置突变，请对照原视频'};}
      const points=f.points.map((p,i)=>p.map((v,k)=>previous.points[i][k]+alpha*(v-previous.points[i][k])));
      const out={...f,points};previous=out;return out;
    }previous=f;return {...f};
  });
}
export function poseAt(t,frames){
  const i=frameIndex(t,frames);if(i<0)return null;const a=frames[i],b=frames[i+1];
  if(!a.points||!b?.points||a.issue||b.issue)return a;
  const k=clamp((t-a.t)/(b.t-a.t),0,1);
  return {...a,points:a.points.map((p,j)=>p.map((v,c)=>v+(b.points[j][c]-v)*k))};
}
export function traceAt(t,frames,joint,seconds){
  const end=frameIndex(t,frames),out=[];
  for(let i=end;i>=0&&frames[i].t>=t-seconds;i--){const f=frames[i];if(!f.points||f.issue)break;out.unshift(f.points[joint]);}return out;
}
export function clampLoop(a,b,duration){if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b>duration||b-a<0.1)return null;return [a,b];}
