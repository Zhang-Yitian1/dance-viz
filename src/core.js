export const FPS = 30;
export const IMPORTANT = [11,12,13,14,15,16,23,24,25,26,27,28];
export const EDGES = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[28,30],[30,32]];
export const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
export function formatTime(t){const n=Math.max(0,Number.isFinite(t)?t:0);return `${String(Math.floor(n/60)).padStart(2,'0')}:${(n%60).toFixed(2).padStart(5,'0')}`;}
export function frameIndex(t,frames){if(!frames.length)return -1;let lo=0,hi=frames.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(frames[mid].t<=t)lo=mid;else hi=mid-1;}return lo;}
export function validPoint(p){return p && [p.x,p.y,p.z].every(Number.isFinite);}
export function makeFrame(t,result,index=0){
  const landmarks=result.landmarks?.[index],world=result.worldLandmarks?.[index];
  if(!landmarks||!world||world.length!==33||landmarks.length!==33||world.some(p=>!validPoint(p)))return {t,screen:null,points:null,confidence:0,issue:'未检测到完整人体'};
  const visibility=landmarks.map(p=>Math.min(Number.isFinite(p.visibility)?p.visibility:0,Number.isFinite(p.presence)?p.presence:1));
  const confidence=Math.min(...IMPORTANT.map(i=>visibility[i]));
  const cropped=IMPORTANT.some(i=>landmarks[i].x<0||landmarks[i].x>1||landmarks[i].y<0||landmarks[i].y>1);
  return {t,screen:landmarks.map((p,i)=>[p.x,p.y,visibility[i]]),points:world.map(p=>[p.x,-p.y,-p.z]),confidence,issue:cropped?'身体部分出画':confidence<0.55?'部分关节被遮挡或识别不稳定':null};
}
export function jointReliable(pose,index){const p=pose?.screen?.[index];return Boolean((!pose?.supported||pose.supported.includes(index))&&pose?.points?.[index]&&p?.[2]>=0.55&&p[0]>=0&&p[0]<=1&&p[1]>=0&&p[1]<=1);}
export function smoothFrames(raw){
  // Offline, centered smoothing preserves timestamps without causal filter lag.
  const marked=raw.map((f,i)=>{
    const previous=raw[i-1];if(!f.points||f.issue||!previous?.points||previous.issue)return {...f};
    if(IMPORTANT.some(j=>Math.hypot(...f.points[j].map((v,k)=>v-previous.points[j][k]))>0.5))return {...f,unstable:true,issue:'关节位置突变，请对照原视频'};
    return {...f};
  });
  return marked.map((f,i)=>{
    const a=marked[i-1],b=marked[i+1];
    if(f.issue||!a?.points||!b?.points||a.issue||b.issue||Math.abs((f.t-a.t)-(b.t-f.t))>0.001)return f;
    return {...f,points:f.points.map((p,j)=>p.map((v,k)=>(a.points[j][k]+2*v+b.points[j][k])/4))};
  });
}
export function poseAt(t,frames){
  const i=frameIndex(t,frames);if(i<0)return null;const a=frames[i],b=frames[i+1];
  if(!a.points||!b?.points||a.unstable||b.unstable)return a;
  const k=clamp((t-a.t)/(b.t-a.t),0,1);
  if(k===0)return a;
  return {...a,issue:a.issue??b.issue,points:a.points.map((p,j)=>jointReliable(a,j)&&jointReliable(b,j)?p.map((v,c)=>v+(b.points[j][c]-v)*k):p),screen:a.screen.map((p,j)=>[p[0]+(b.screen[j][0]-p[0])*k,p[1]+(b.screen[j][1]-p[1])*k,Math.min(p[2],b.screen[j][2])])};
}
export function alignToImage(pose,aspect){
  // Weak-perspective image constraint, NOT a recovery of true depth or camera intrinsics.
  if(pose?.source==='motionbert')return pose;
  if(!pose?.points||!pose.screen||!Number.isFinite(aspect)||aspect<=0||![11,12,23,24].every(i=>jointReliable(pose,i)))return pose;
  const center=[0,1].map(k=>(pose.screen[23][k]+pose.screen[24][k])/2);
  const hip=[0,1,2].map(k=>(pose.points[23][k]+pose.points[24][k])/2);
  const image=pose.screen.map(p=>[(p[0]-center[0])*aspect,-(p[1]-center[1])]);
  let numerator=0,denominator=0;
  for(const i of [11,12,23,24]){for(const k of [0,1]){numerator+=(pose.points[i][k]-hip[k])*image[i][k];denominator+=image[i][k]**2;}}
  const scale=numerator/denominator;
  if(!Number.isFinite(scale)||scale<=0||denominator<0.00001)return pose;
  return {...pose,projectionAligned:true,points:pose.points.map((p,i)=>[image[i][0]*scale,image[i][1]*scale,p[2]-hip[2]])};
}
export function traceAt(t,frames,joint,seconds){
  const end=frameIndex(t,frames),out=[];
  for(let i=end;i>=0&&frames[i].t>=t-seconds;i--){const f=frames[i];if(!jointReliable(f,joint)||f.unstable)break;out.unshift(f.points[joint]);}return out;
}
export function clampLoop(a,b,duration){if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b>duration||b-a<0.1)return null;return [a,b];}
