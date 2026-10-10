import {IMPORTANT} from './core.js';

export function applyTemporalResult(frames,result){
  const supported=result?.supported;
  if(result?.source!=='motionbert'||!Array.isArray(result.points)||result.points.length!==frames.length||!Array.isArray(supported)||!IMPORTANT.every(i=>supported.includes(i))||supported.some(i=>!Number.isInteger(i)||i<0||i>32))throw new Error('时序三维输出与视频不匹配');
  return frames.map((f,i)=>{
    const points=result.points[i];
    if(points===null)return {...f,points:null,supported,source:'motionbert',issue:f.issue||'时序三维姿态缺失'};
    if(!Array.isArray(points)||points.length!==33||points.some(p=>!Array.isArray(p)||p.length!==3||p.some(v=>!Number.isFinite(v))))throw new Error('时序三维坐标无效');
    if(!f.screen)return {...f,points:null,supported,source:'motionbert'};
    return {...f,points,supported,source:'motionbert',unstable:false};
  });
}

export async function enhanceSequence(data,signal,onStatus,request=fetch){
  let id;
  async function json(url,options){const response=await request(url,options);let data;try{data=await response.json();}catch{throw new Error('本地服务尚未支持时序三维，请更新并重启启动脚本。');}if(!response.ok)throw new Error(data.error||'本地增强服务不可用');return data;}
  try{
    const health=await json('./api/motion',{signal});
    if(!health.available)throw new Error('时序三维尚未安装。请用 Python 3.10–3.13 运行 scripts/setup_motion.py，再重启本地服务。');
    ({id}=await json('./api/motion',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal}));
    const start=Date.now();
    while(true){
      if(signal.aborted)throw new DOMException('已取消','AbortError');
      const job=await json(`./api/motion/job?id=${encodeURIComponent(id)}`,{signal});
      if(job.status==='done')return job.result;
      if(job.status==='error')throw new Error(job.error);
      if(job.status==='cancelled')throw new DOMException('已取消','AbortError');
      if(Date.now()-start>330000)throw new Error('增强三维超时，请先使用较短片段');
      onStatus?.(Math.floor((Date.now()-start)/1000));
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},500);function abort(){clearTimeout(timer);reject(new DOMException('已取消','AbortError'));}signal.addEventListener('abort',abort,{once:true});});
    }
  }finally{
    if(id)await request('./api/motion/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}).catch(()=>{});
  }
}
