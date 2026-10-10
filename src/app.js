import {FPS,EDGES,clamp,formatTime,makeFrame,smoothFrames,frameIndex,poseAt,traceAt,clampLoop,alignToImage} from './core.js';
import {checkModelAssets} from './assets.js';
import {SubjectTracker} from './subject.js';
import {applyTemporalResult,enhanceSequence} from './temporal.js';
const $=id=>document.getElementById(id), video=$('video');
const state={frames:[],raw:[],url:null,busy:false,controller:null,view:null,a:null,b:null,loop:false,issueCount:0,focus:null,picking:false,model:null,base:[],temporal:[],depth:'base',noticeUntil:0};
const options={mirror:false,skeleton:true,guides:true,hands:true,feet:true,trailLength:0.8,opacity:0.25,overlay:true,alignment:true};
function notice(text,type='',hold=type==='error'?30000:5000){state.noticeUntil=Date.now()+hold;$('notice').textContent=text;$('notice').className=`notice ${type}`;}
function controls(enabled){for(const id of ['play','timeline','set-a','set-b','loop'])$(id).disabled=!enabled;}
function updateLoop(){const valid=clampLoop(state.a,state.b,video.duration);$('loop-times').textContent=valid?`${formatTime(state.a)} — ${formatTime(state.b)}`:'起点和终点须相隔至少 0.1 秒';if(!valid){$('loop').checked=false;state.loop=false;}}
function waitVideoEvent(event,signal,timeout=10000){return new Promise((resolve,reject)=>{
  const cleanup=()=>{clearTimeout(timer);video.removeEventListener(event,ok);video.removeEventListener('error',fail);signal?.removeEventListener('abort',abort);};
  const ok=()=>{cleanup();resolve();},fail=()=>{cleanup();reject(new Error('浏览器无法解码这个视频，请转换为 H.264 MP4 后重试。'));},abort=()=>{cleanup();reject(new DOMException('已取消','AbortError'));};
  const timer=setTimeout(()=>{cleanup();reject(new Error('读取视频超时，请换一个文件重试。'));},timeout);
  video.addEventListener(event,ok,{once:true});video.addEventListener('error',fail,{once:true});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
});}
async function seek(t,signal){if(Math.abs(video.currentTime-t)<0.0001&&video.readyState>=2)return;if(signal?.aborted)throw new DOMException('已取消','AbortError');const done=waitVideoEvent('seeked',signal);video.currentTime=t;await done;}
async function loadVideo(file){
  if(state.busy)return;
  if(!file.type.startsWith('video/')&&!/\.(mp4|mov|webm)$/i.test(file.name)){notice('请选择 MP4、MOV 或 WebM 视频。','error');return;}
  video.pause();controls(false);state.frames=[];state.raw=[];resetDepth();state.focus=null;state.picking=false;state.model=null;$('focus').disabled=true;$('focus').textContent='定位舞者';$('clear-focus').disabled=true;$('video-area').classList.remove('picking');state.a=null;state.b=null;state.loop=false;$('loop').checked=false;$('loop-times').textContent='尚未设置';state.view&&(state.view.root.visible=false);$('pose-state').textContent='等待分析';$('stage-empty').hidden=false;$('analyze').disabled=true;$('replace').disabled=true;$('analyze').textContent='分析动作 ↗';drawQuality();
  if(state.url)URL.revokeObjectURL(state.url);state.url=URL.createObjectURL(file);
  try{const ready=waitVideoEvent('loadedmetadata');video.src=state.url;video.load();await ready;
    if(!Number.isFinite(video.duration)||video.duration<=0)throw new Error('无法读取有效视频时长，请换一个文件。');
    if(video.duration>90.001)throw new Error(`视频长 ${video.duration.toFixed(1)} 秒，超过 90 秒。请先剪辑，再导入。`);
    $('clip-name').textContent=file.name;$('video-meta').textContent=`${video.videoWidth} × ${video.videoHeight} · ${video.duration.toFixed(1)} 秒`;
    $('timeline').max=video.duration;$('timeline').value=0;$('upload-card').hidden=true;$('analyze').disabled=false;$('replace').disabled=false;$('focus').disabled=false;controls(true);
    $('source-badge').textContent='已载入 · 尚未分析';$('time').textContent=`${formatTime(0)} / ${formatTime(video.duration)}`;
    notice('视频已载入。点击「分析动作」，完成后可以同步慢放、循环和换角度。');drawQuality();
  }catch(e){video.removeAttribute('src');video.load();URL.revokeObjectURL(state.url);state.url=null;$('upload-card').hidden=false;$('clip-name').textContent='导入你的舞段';$('video-meta').textContent='保留动作与音乐';$('source-badge').textContent='单人 · 全身 · 固定机位 · ≤90 秒';notice(e.message,'error');}
}
let visionModule = null;
async function model(variant,numPoses){
  await checkModelAssets(fetch,undefined,variant);
  // Failed module imports are cached by browsers. A fresh URL permits retry after service recovery.
  if (!visionModule) visionModule = await import(`../vendor/mediapipe/vision_bundle.mjs?attempt=${Date.now()}`);
  const {FilesetResolver,PoseLandmarker}=visionModule;
  const files=await FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
  const config={baseOptions:{modelAssetPath:`./vendor/models/pose_landmarker_${variant}.task`,delegate:'GPU'},runningMode:'VIDEO',numPoses,minPoseDetectionConfidence:0.5,minPosePresenceConfidence:0.5,minTrackingConfidence:0.5};
  try{return await PoseLandmarker.createFromOptions(files,config);}catch{config.baseOptions.delegate='CPU';return await PoseLandmarker.createFromOptions(files,config);}
}
async function analyze(){
  if(state.busy||!state.url)return;
  if(!state.view){notice('三维显示尚未就绪。请先下载依赖，或确认浏览器支持 WebGL。','error');return;}
  video.pause();state.picking=false;$('video-area').classList.remove('picking');state.busy=true;state.controller=new AbortController();const signal=state.controller.signal,variant=$('model').value,tracker=new SubjectTracker(state.focus);controls(false);$('analyze').disabled=true;$('replace').disabled=true;$('choose').disabled=true;$('model').disabled=true;$('focus').disabled=true;$('clear-focus').disabled=true;
  $('analysis-panel').hidden=false;$('progress').value=0;$('analysis-text').textContent='加载本地姿态模型…';notice('分析期间请保持此页面打开。视频文件仅在本机读取。');state.frames=[];state.raw=[];resetDepth();state.view.root.visible=false;drawQuality();
  let landmarker;
  try{
    landmarker=await model(variant,state.focus?3:1);if(signal.aborted)throw new DOMException('已取消','AbortError');
    const n=Math.ceil(video.duration*FPS),raw=[];
    for(let i=0;i<n;i++){
      if(signal.aborted)throw new DOMException('已取消','AbortError');const t=i/FPS;await seek(t,signal);
      if(video.readyState<2)await waitVideoEvent('loadeddata',signal);
      const result=landmarker.detectForVideo(video,Math.round(t*1000)),index=tracker.select(result,t);
      const frame=makeFrame(t,result,index);if(index===null&&result.landmarks?.length)frame.issue='舞者跟踪中断，请重新定位舞者';raw.push(frame);
      $('progress').value=(i+1)/n*100;$('analysis-text').textContent=`分析动作 ${i+1} / ${n} 帧 · ${Math.round((i+1)/n*100)}%`;
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    if(!raw.some(f=>f.points))throw new Error('没有检测到人体。请使用单人全身、人物清晰且光线充足的视频。');
    state.raw=raw;state.frames=smoothFrames(raw);state.base=state.frames;state.issueCount=state.frames.filter(f=>f.issue).length;
    state.model=variant;$('stage-empty').hidden=true;$('source-badge').textContent=`已分析 · ${variant==='heavy'?'Heavy':'Full'} · 三维姿态估计`;$('pose-state').textContent='可旋转观察';$('analyze').textContent='重新分析 ↗';
    state.a=0;state.b=video.duration;updateLoop();drawQuality();
    notice(`分析完成，共 ${n} 帧。${state.issueCount} 帧存在异常；低置信度的关节与连线已隐藏。三维轨迹相对骨盆，整体位移请参考原视频。`,state.issueCount?'warning':'');
  }catch(e){state.frames=[];state.raw=[];$('stage-empty').hidden=false;$('pose-state').textContent='等待分析';notice(e.name==='AbortError'?'分析已取消，可重试或更换视频。':`分析失败：${e.message}`,e.name==='AbortError'?'':'error');
  }finally{landmarker?.close();state.busy=false;state.controller=null;$('analysis-panel').hidden=true;controls(Boolean(state.url));$('analyze').disabled=!state.url;$('replace').disabled=!state.url;$('choose').disabled=false;$('model').disabled=false;$('focus').disabled=!state.url;$('focus').textContent=state.focus?'重新定位':'定位舞者';$('clear-focus').disabled=!state.focus;$('enhance').disabled=!state.frames.length;$('depth-model').disabled=!state.frames.length;await seek(0).catch(()=>{});}
}
function resetDepth(){state.base=[];state.temporal=[];state.depth='base';$('depth-model').value='base';$('depth-model').disabled=true;$('depth-model').options[1].disabled=true;$('enhance').disabled=true;$('image-alignment').disabled=false;}
function selectDepth(){state.depth=$('depth-model').value;state.frames=state.depth==='temporal'?state.temporal:state.base;$('image-alignment').disabled=state.depth==='temporal';state.issueCount=state.frames.filter(f=>f.issue).length;drawQuality();$('source-badge').textContent=`已分析 · ${state.depth==='temporal'?'时序三维（试验）':state.model==='heavy'?'Heavy · 基础估计':'Full · 基础估计'}`;notice(state.depth==='temporal'?'时序三维已启用，可切换基础估计对照。脚掌和手指细节不在该模型范围内；遮挡与深度仍可能估计错误。':'已切换基础三维估计。');}
async function enhance(){
  if(state.busy||!state.raw.length)return;
  video.pause();state.picking=false;$('video-area').classList.remove('picking');$('focus').textContent=state.focus?'重新定位':'定位舞者';state.busy=true;state.controller=new AbortController();const signal=state.controller.signal;controls(false);
  for(const id of ['enhance','analyze','replace','choose','model','depth-model','focus','clear-focus'])$(id).disabled=true;
  $('analysis-panel').hidden=false;$('progress').removeAttribute('value');$('analysis-text').textContent='结合连续动作推断三维…';
  try{
    const data={width:video.videoWidth,height:video.videoHeight,frames:state.raw.map(f=>({t:f.t,screen:f.screen}))};
    const result=await enhanceSequence(data,signal,seconds=>$('analysis-text').textContent=`结合连续动作推断三维 · ${seconds} 秒`);
    state.temporal=applyTemporalResult(state.raw,result);$('depth-model').options[1].disabled=false;$('depth-model').value='temporal';selectDepth();
  }catch(e){notice(e.name==='AbortError'?'三维增强已取消，原分析可以继续使用。':`三维增强失败：${e.message}`,e.name==='AbortError'?'':'error');}
  finally{
    state.busy=false;state.controller=null;$('analysis-panel').hidden=true;$('progress').value=0;controls(Boolean(state.url));
    for(const id of ['enhance','analyze','replace','choose','model','depth-model','focus'])$(id).disabled=false;
    $('clear-focus').disabled=!state.focus;
  }
}
$('enhance').onclick=enhance;$('depth-model').onchange=selectDepth;
function drawQuality(){const canvas=$('quality-strip');canvas.width=Math.max(1,canvas.clientWidth*devicePixelRatio);canvas.height=8;const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,8);ctx.fillStyle='#dda15e';const duration=video.duration;if(!Number.isFinite(duration))return;for(const f of state.frames){if(f.issue)ctx.fillRect(f.t/duration*canvas.width,0,Math.max(1,canvas.width/FPS/duration),8);}}
function drawOverlay(t){
  const canvas=$('overlay'),width=canvas.clientWidth,height=canvas.clientHeight;canvas.width=Math.round(width*devicePixelRatio);canvas.height=Math.round(height*devicePixelRatio);const ctx=canvas.getContext('2d');ctx.scale(devicePixelRatio,devicePixelRatio);ctx.clearRect(0,0,width,height);
  if(!video.videoWidth)return;
  const scale=Math.min(width/video.videoWidth,height/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale,x=(width-w)/2,y=(height-h)/2;
  const point=p=>[(options.mirror?1-p[0]:p[0])*w+x,p[1]*h+y];
  if(state.focus&&t<0.1){const [px,py]=point(state.focus);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(px,py,9,0,Math.PI*2);ctx.moveTo(px-13,py);ctx.lineTo(px+13,py);ctx.moveTo(px,py-13);ctx.lineTo(px,py+13);ctx.stroke();}
  if(!options.overlay||!state.frames.length||state.busy)return;
  const i=frameIndex(t,state.frames),f=poseAt(t,state.frames);if(!f?.screen)return;
  ctx.lineWidth=1.5;ctx.strokeStyle=f.issue?'#e3a44d':'#8ae4be';ctx.lineCap='round';
  for(const [a,b]of EDGES){if(f.screen[a][2]<0.55||f.screen[b][2]<0.55)continue;ctx.beginPath();ctx.moveTo(...point(f.screen[a]));ctx.lineTo(...point(f.screen[b]));ctx.stroke();}
  for(const joint of [11,12,13,14,15,16,23,24,25,26,27,28]){if(f.screen[joint][2]<0.55)continue;ctx.fillStyle=[15,16].includes(joint)?'#ff9b65':[27,28].includes(joint)?'#78bfff':'#8ae4be';ctx.strokeStyle='#203b32';ctx.lineWidth=1;ctx.beginPath();ctx.arc(...point(f.screen[joint]),[15,16,27,28].includes(joint)?3.5:2.2,0,Math.PI*2);ctx.fill();ctx.stroke();}
  for(const [joint,enabled,color]of [[15,options.hands,'#f3ad8b'],[16,options.hands,'#f3ad8b'],[27,options.feet,'#8dbbe9'],[28,options.feet,'#8dbbe9']]){
    if(!enabled)continue;ctx.strokeStyle=color;ctx.beginPath();let started=false;
    const indices=[];for(let j=i;j>=0&&state.frames[j].t>=t-options.trailLength;j--){const f=state.frames[j],p=f.screen?.[joint];if(!p||p[2]<.55||p[0]<0||p[0]>1||p[1]<0||p[1]>1||f.unstable)break;indices.unshift(j);}
    for(const j of indices){const p=state.frames[j].screen[joint];if(p[2]<0.55){started=false;continue;}if(!started){ctx.moveTo(...point(p));started=true;}else ctx.lineTo(...point(p));}ctx.stroke();
  }
}
function tick(){
  if(state.url&&!state.busy){
    let t=video.currentTime;const loop=state.loop?clampLoop(state.a,state.b,video.duration):null;
    if(loop&&!video.paused&&(t>=loop[1]||t<loop[0])){video.currentTime=loop[0];t=loop[0];}
    $('timeline').value=t;$('time').textContent=`${formatTime(t)} / ${formatTime(video.duration)}`;$('play').textContent=video.paused?'▶':'Ⅱ';$('play').setAttribute('aria-label',video.paused?'播放':'暂停');
    const observed=poseAt(t,state.frames),pose=options.alignment?alignToImage(observed,video.videoWidth/video.videoHeight):observed;
    state.view?.update(pose,t,state.frames,{...options,aspect:video.videoWidth/video.videoHeight});drawOverlay(t);
    if(state.frames.length&&!state.picking){$('pose-state').textContent=pose?.issue?'此刻估计不可靠':'可旋转观察';if(Date.now()>=state.noticeUntil){if(pose?.issue)notice(`${pose.issue}。请对照左侧原视频；这里的估计视角可能有误。`,'warning',0);else if($('notice').dataset.lastIssue==='true')notice(`分析完成 · ${state.issueCount} 帧异常已标记。三维轨迹相对骨盆，整体位移请参考原视频。`,state.issueCount?'warning':'',0);$('notice').dataset.lastIssue=String(Boolean(pose?.issue));}}
  }state.view?.draw();requestAnimationFrame(tick);
}
$('choose').onclick=()=>{if(!state.busy)$('file').click();};$('replace').onclick=$('choose').onclick;
$('file').onchange=e=>{const file=e.target.files[0];e.target.value='';if(file)loadVideo(file);};
for(const event of ['dragenter','dragover'])$('video-area').addEventListener(event,e=>{e.preventDefault();if(!state.busy)$('upload-card').classList.add('dragging');});
for(const event of ['dragleave','drop'])$('video-area').addEventListener(event,e=>{e.preventDefault();$('upload-card').classList.remove('dragging');});$('video-area').addEventListener('drop',e=>{if(e.dataTransfer.files[0])loadVideo(e.dataTransfer.files[0]);});
$('analyze').onclick=analyze;$('cancel').onclick=()=>state.controller?.abort();
function clearAnalysis(){state.frames=[];state.raw=[];resetDepth();state.model=null;state.view&&(state.view.root.visible=false);$('stage-empty').hidden=false;$('pose-state').textContent='等待分析';$('source-badge').textContent='已载入 · 请重新分析';$('analyze').textContent='分析动作 ↗';drawQuality();}
$('focus').onclick=async()=>{if(state.busy||!state.url)return;video.pause();await seek(0);state.picking=!state.picking;$('video-area').classList.toggle('picking',state.picking);$('focus').textContent=state.picking?'取消定位':state.focus?'重新定位':'定位舞者';notice(state.picking?'请点击原视频中舞者的胸腹位置，避开镜子里的倒影；然后重新分析。':'已取消定位。');};
$('video-area').addEventListener('pointerdown',event=>{if(!state.picking||state.busy)return;const rect=$('overlay').getBoundingClientRect(),scale=Math.min(rect.width/video.videoWidth,rect.height/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale;let x=(event.clientX-rect.left-(rect.width-w)/2)/w,y=(event.clientY-rect.top-(rect.height-h)/2)/h;if(x<0||x>1||y<0||y>1)return;if(options.mirror)x=1-x;state.focus=[x,y];state.picking=false;$('video-area').classList.remove('picking');$('focus').textContent='重新定位';$('clear-focus').disabled=false;clearAnalysis();notice('已指定起始舞者位置。点击「分析动作」后，会按身体位置连续跟踪；失去目标时标记缺失。');});
$('clear-focus').onclick=()=>{state.focus=null;state.picking=false;$('video-area').classList.remove('picking');$('focus').textContent='定位舞者';$('clear-focus').disabled=true;clearAnalysis();notice('已恢复自动选择舞者，请重新分析。');};
$('model').onchange=()=>notice(`已选择 ${$('model').value==='heavy'?'Heavy（较慢）':'Full'}。点击「${state.frames.length?'重新分析':'分析动作'}」应用；更大的模型不保证每种动作都更准。`);
$('play').onclick=async()=>{if(state.busy)return;if(video.paused){if(video.ended)video.currentTime=state.loop?state.a:0;try{await video.play();}catch{notice('浏览器未能开始播放，请重试。','error');}}else video.pause();};
video.addEventListener('ended',()=>{if(state.loop&&clampLoop(state.a,state.b,video.duration)){video.currentTime=state.a;video.play().catch(()=>{});}});
$('timeline').oninput=e=>{if(!state.busy)video.currentTime=+e.target.value;};
document.querySelectorAll('[data-speed]').forEach(button=>button.onclick=()=>{video.playbackRate=+button.dataset.speed;document.querySelectorAll('[data-speed]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));});
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{state.view?.view(button.dataset.view);document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));});
$('set-a').onclick=()=>{state.a=video.currentTime;updateLoop();};$('set-b').onclick=()=>{state.b=video.currentTime;updateLoop();};$('loop').onchange=e=>{updateLoop();state.loop=e.target.checked&&Boolean(clampLoop(state.a,state.b,video.duration));};
for(const [id,key]of [['hand-trails','hands'],['foot-trails','feet'],['body-guides','guides'],['skeleton','skeleton'],['show-overlay','overlay'],['mirror','mirror'],['image-alignment','alignment']])$(id).onchange=e=>{options[key]=e.target.checked;if(key==='mirror')video.style.transform=options.mirror?'scaleX(-1)':'';};
$('sound').onchange=e=>{video.muted=!e.target.checked;};
$('trail-length').oninput=e=>{options.trailLength=+e.target.value;$('trail-value').textContent=`${options.trailLength.toFixed(1)} 秒`;};$('opacity').oninput=e=>{options.opacity=+e.target.value;$('opacity-value').textContent=`${Math.round(options.opacity*100)}%`;};
document.addEventListener('keydown',e=>{if(e.code==='Space'&&!['INPUT','BUTTON','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!$('play').disabled){e.preventDefault();$('play').click();}});
window.addEventListener('resize',drawQuality);window.addEventListener('beforeunload',()=>{if(state.url)URL.revokeObjectURL(state.url);});
try{const {MotionView}=await import('./renderer.js');state.view=new MotionView($('stage'),()=>document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed','false')));}catch(e){notice('三维显示未能加载。首次运行请先执行 python3 scripts/download_assets.py，再刷新页面；浏览器须支持 WebGL。','error');console.error(e);}
tick();
