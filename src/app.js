import {FPS,EDGES,clamp,formatTime,makeFrame,smoothFrames,frameIndex,poseAt,traceAt,clampLoop} from './core.js';
const $=id=>document.getElementById(id), video=$('video');
const state={frames:[],raw:[],url:null,busy:false,controller:null,view:null,a:null,b:null,loop:false,issueCount:0};
const options={mirror:false,skeleton:true,guides:true,hands:true,feet:true,trailLength:0.8,opacity:0.25,overlay:true};
function notice(text,type=''){ $('notice').textContent=text;$('notice').className=`notice ${type}`; }
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
  video.pause();controls(false);state.frames=[];state.raw=[];state.a=null;state.b=null;state.loop=false;$('loop').checked=false;$('loop-times').textContent='尚未设置';state.view&&(state.view.root.visible=false);$('pose-state').textContent='等待分析';$('stage-empty').hidden=false;$('analyze').disabled=true;$('replace').disabled=true;$('analyze').textContent='分析动作 ↗';drawQuality();
  if(state.url)URL.revokeObjectURL(state.url);state.url=URL.createObjectURL(file);
  try{const ready=waitVideoEvent('loadedmetadata');video.src=state.url;video.load();await ready;
    if(!Number.isFinite(video.duration)||video.duration<=0)throw new Error('无法读取有效视频时长，请换一个文件。');
    if(video.duration>90.001)throw new Error(`视频长 ${video.duration.toFixed(1)} 秒，超过 90 秒。请先剪辑，再导入。`);
    $('clip-name').textContent=file.name;$('video-meta').textContent=`${video.videoWidth} × ${video.videoHeight} · ${video.duration.toFixed(1)} 秒`;
    $('timeline').max=video.duration;$('timeline').value=0;$('upload-card').hidden=true;$('analyze').disabled=false;$('replace').disabled=false;controls(true);
    $('source-badge').textContent='已载入 · 尚未分析';$('time').textContent=`${formatTime(0)} / ${formatTime(video.duration)}`;
    notice('视频已载入。点击「分析动作」，完成后可以同步慢放、循环和换角度。');drawQuality();
  }catch(e){video.removeAttribute('src');video.load();URL.revokeObjectURL(state.url);state.url=null;$('upload-card').hidden=false;$('clip-name').textContent='导入你的舞段';$('video-meta').textContent='保留动作与音乐';$('source-badge').textContent='单人 · 全身 · 固定机位 · ≤90 秒';notice(e.message,'error');}
}
async function model(){
  const {FilesetResolver,PoseLandmarker}=await import('../vendor/mediapipe/vision_bundle.mjs');
  const files=await FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
  const config={baseOptions:{modelAssetPath:'./vendor/models/pose_landmarker_full.task',delegate:'GPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:0.5,minPosePresenceConfidence:0.5,minTrackingConfidence:0.5};
  try{return await PoseLandmarker.createFromOptions(files,config);}catch{config.baseOptions.delegate='CPU';return await PoseLandmarker.createFromOptions(files,config);}
}
async function analyze(){
  if(state.busy||!state.url)return;
  if(!state.view){notice('三维显示尚未就绪。请先下载依赖，或确认浏览器支持 WebGL。','error');return;}
  video.pause();state.busy=true;state.controller=new AbortController();const signal=state.controller.signal;controls(false);$('analyze').disabled=true;$('replace').disabled=true;$('choose').disabled=true;
  $('analysis-panel').hidden=false;$('progress').value=0;$('analysis-text').textContent='加载本地姿态模型…';notice('分析期间请保持此页面打开。视频文件仅在本机读取。');state.frames=[];state.raw=[];state.view.root.visible=false;drawQuality();
  let landmarker;
  try{
    try{landmarker=await model();}catch{throw new Error('本地姿态模型未能加载。请运行 python3 scripts/download_assets.py，完成下载后重试');}if(signal.aborted)throw new DOMException('已取消','AbortError');
    const n=Math.ceil(video.duration*FPS),raw=[];
    for(let i=0;i<n;i++){
      if(signal.aborted)throw new DOMException('已取消','AbortError');const t=i/FPS;await seek(t,signal);
      if(video.readyState<2)await waitVideoEvent('loadeddata',signal);
      const result=landmarker.detectForVideo(video,Math.round(t*1000));raw.push(makeFrame(t,result));
      $('progress').value=(i+1)/n*100;$('analysis-text').textContent=`分析动作 ${i+1} / ${n} 帧 · ${Math.round((i+1)/n*100)}%`;
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    if(!raw.some(f=>f.points))throw new Error('没有检测到人体。请使用单人全身、人物清晰且光线充足的视频。');
    state.raw=raw;state.frames=smoothFrames(raw);state.issueCount=state.frames.filter(f=>f.issue).length;
    $('stage-empty').hidden=true;$('source-badge').textContent='已分析 · 三维姿态估计';$('pose-state').textContent='可旋转观察';$('analyze').textContent='重新分析 ↗';
    state.a=0;state.b=video.duration;updateLoop();drawQuality();
    notice(`分析完成，共 ${n} 帧。检测到 ${state.issueCount} 帧异常，已在时间轴标记。三维轨迹相对骨盆，整体位移请参考原视频。`,state.issueCount?'warning':'');
  }catch(e){state.frames=[];state.raw=[];$('stage-empty').hidden=false;$('pose-state').textContent='等待分析';notice(e.name==='AbortError'?'分析已取消，可重试或更换视频。':`分析失败：${e.message}`,e.name==='AbortError'?'':'error');
  }finally{landmarker?.close();state.busy=false;state.controller=null;$('analysis-panel').hidden=true;controls(Boolean(state.url));$('analyze').disabled=!state.url;$('replace').disabled=!state.url;$('choose').disabled=false;await seek(0).catch(()=>{});}
}
function drawQuality(){const canvas=$('quality-strip');canvas.width=Math.max(1,canvas.clientWidth*devicePixelRatio);canvas.height=8;const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,8);ctx.fillStyle='#dda15e';const duration=video.duration;if(!Number.isFinite(duration))return;for(const f of state.frames){if(f.issue)ctx.fillRect(f.t/duration*canvas.width,0,Math.max(1,canvas.width/FPS/duration),8);}}
function drawOverlay(t){
  const canvas=$('overlay'),width=canvas.clientWidth,height=canvas.clientHeight;canvas.width=Math.round(width*devicePixelRatio);canvas.height=Math.round(height*devicePixelRatio);const ctx=canvas.getContext('2d');ctx.scale(devicePixelRatio,devicePixelRatio);ctx.clearRect(0,0,width,height);
  if(!options.overlay||!state.frames.length||state.busy||!video.videoWidth)return;
  const i=frameIndex(t,state.frames),f=state.frames[i];if(!f?.screen)return;
  const scale=Math.min(width/video.videoWidth,height/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale,x=(width-w)/2,y=(height-h)/2;
  const point=p=>[(options.mirror?1-p[0]:p[0])*w+x,p[1]*h+y];ctx.lineWidth=1.5;ctx.strokeStyle=f.issue?'#e3a44d':'#8ae4be';ctx.lineCap='round';
  for(const [a,b]of EDGES){if(f.screen[a][2]<0.55||f.screen[b][2]<0.55)continue;ctx.beginPath();ctx.moveTo(...point(f.screen[a]));ctx.lineTo(...point(f.screen[b]));ctx.stroke();}
  for(const [joint,enabled,color]of [[15,options.hands,'#f3ad8b'],[16,options.hands,'#f3ad8b'],[27,options.feet,'#8dbbe9'],[28,options.feet,'#8dbbe9']]){
    if(!enabled)continue;ctx.strokeStyle=color;ctx.beginPath();let started=false;
    const indices=[];for(let j=i;j>=0&&state.frames[j].t>=t-options.trailLength;j--){if(!state.frames[j].screen||state.frames[j].issue)break;indices.unshift(j);}
    for(const j of indices){const p=state.frames[j].screen[joint];if(p[2]<0.55){started=false;continue;}if(!started){ctx.moveTo(...point(p));started=true;}else ctx.lineTo(...point(p));}ctx.stroke();
  }
}
function tick(){
  if(state.url&&!state.busy){
    let t=video.currentTime;const loop=state.loop?clampLoop(state.a,state.b,video.duration):null;
    if(loop&&!video.paused&&(t>=loop[1]||t<loop[0])){video.currentTime=loop[0];t=loop[0];}
    $('timeline').value=t;$('time').textContent=`${formatTime(t)} / ${formatTime(video.duration)}`;$('play').textContent=video.paused?'▶':'Ⅱ';$('play').setAttribute('aria-label',video.paused?'播放':'暂停');
    const pose=poseAt(t,state.frames);state.view?.update(pose,t,state.frames,options);drawOverlay(t);
    if(state.frames.length){$('pose-state').textContent=pose?.issue?'此刻估计不可靠':'可旋转观察';if(pose?.issue)notice(`${pose.issue}。请对照左侧原视频；这里的估计视角可能有误。`,'warning');else if($('notice').dataset.lastIssue==='true')notice(`分析完成 · ${state.issueCount} 帧异常已标记。三维轨迹相对骨盆，整体位移请参考原视频。`,state.issueCount?'warning':'');$('notice').dataset.lastIssue=String(Boolean(pose?.issue));}
  }state.view?.draw();requestAnimationFrame(tick);
}
$('choose').onclick=()=>{if(!state.busy)$('file').click();};$('replace').onclick=$('choose').onclick;
$('file').onchange=e=>{const file=e.target.files[0];e.target.value='';if(file)loadVideo(file);};
for(const event of ['dragenter','dragover'])$('video-area').addEventListener(event,e=>{e.preventDefault();if(!state.busy)$('upload-card').classList.add('dragging');});
for(const event of ['dragleave','drop'])$('video-area').addEventListener(event,e=>{e.preventDefault();$('upload-card').classList.remove('dragging');});$('video-area').addEventListener('drop',e=>{if(e.dataTransfer.files[0])loadVideo(e.dataTransfer.files[0]);});
$('analyze').onclick=analyze;$('cancel').onclick=()=>state.controller?.abort();
$('play').onclick=async()=>{if(state.busy)return;if(video.paused){if(video.ended)video.currentTime=state.loop?state.a:0;try{await video.play();}catch{notice('浏览器未能开始播放，请重试。','error');}}else video.pause();};
video.addEventListener('ended',()=>{if(state.loop&&clampLoop(state.a,state.b,video.duration)){video.currentTime=state.a;video.play().catch(()=>{});}});
$('timeline').oninput=e=>{if(!state.busy)video.currentTime=+e.target.value;};
document.querySelectorAll('[data-speed]').forEach(button=>button.onclick=()=>{video.playbackRate=+button.dataset.speed;document.querySelectorAll('[data-speed]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));});
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{state.view?.view(button.dataset.view);document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));});
$('set-a').onclick=()=>{state.a=video.currentTime;updateLoop();};$('set-b').onclick=()=>{state.b=video.currentTime;updateLoop();};$('loop').onchange=e=>{updateLoop();state.loop=e.target.checked&&Boolean(clampLoop(state.a,state.b,video.duration));};
for(const [id,key]of [['hand-trails','hands'],['foot-trails','feet'],['body-guides','guides'],['skeleton','skeleton'],['show-overlay','overlay'],['mirror','mirror']])$(id).onchange=e=>{options[key]=e.target.checked;if(key==='mirror')video.style.transform=options.mirror?'scaleX(-1)':'';};
$('trail-length').oninput=e=>{options.trailLength=+e.target.value;$('trail-value').textContent=`${options.trailLength.toFixed(1)} 秒`;};$('opacity').oninput=e=>{options.opacity=+e.target.value;$('opacity-value').textContent=`${Math.round(options.opacity*100)}%`;};
document.addEventListener('keydown',e=>{if(e.code==='Space'&&!['INPUT','BUTTON','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!$('play').disabled){e.preventDefault();$('play').click();}});
window.addEventListener('resize',drawQuality);window.addEventListener('beforeunload',()=>{if(state.url)URL.revokeObjectURL(state.url);});
try{const {MotionView}=await import('./renderer.js');state.view=new MotionView($('stage'),()=>document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed','false')));}catch(e){notice('三维显示未能加载。首次运行请先执行 python3 scripts/download_assets.py，再刷新页面；浏览器须支持 WebGL。','error');console.error(e);}
tick();
