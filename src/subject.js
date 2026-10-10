// Follow one dancer through candidate ordering changes (including mirror reflections).
const TORSO = [11,12,23,24];
function describe(points,index){
  if(!points || TORSO.some(i=>!Number.isFinite(points[i]?.x)||!Number.isFinite(points[i]?.y)))return null;
  const anchor=TORSO.map(i=>[points[i].x,points[i].y]);
  const center=[0,1].map(k=>anchor.reduce((sum,p)=>sum+p[k],0)/anchor.length);
  const shoulder=anchor.slice(0,2),hip=anchor.slice(2);
  const height=Math.hypot(...[0,1].map(k=>(shoulder[0][k]+shoulder[1][k]-hip[0][k]-hip[1][k])/2));
  const quality=TORSO.reduce((sum,i)=>sum+(points[i].visibility??0),0)/4;
  return {index,anchor,center,height,quality};
}
export class SubjectTracker{
  constructor(focus=null){this.focus=focus;this.previous=null;this.lastTime=0;}
  select(result,t){
    const candidates=(result.landmarks??[]).map(describe).filter(p=>p&&p.quality>=0.55);
    if(!candidates.length)return null;
    let chosen;
    if(this.previous){
      const previous=this.previous;
      const ranked=candidates.map(p=>({...p,distance:p.anchor.reduce((sum,a,i)=>sum+Math.hypot(a[0]-previous.anchor[i][0],a[1]-previous.anchor[i][1]),0)/4})).sort((a,b)=>a.distance-b.distance);
      const limit=Math.min(0.25,Math.max(0.04,previous.height*0.8)+(t-this.lastTime)*0.12);
      if(ranked[0].distance>limit)return null;
      // Close matches to two people are ambiguous: report a gap rather than switching.
      if(ranked[1]&&ranked[1].distance-ranked[0].distance<0.015)return null;
      chosen=ranked[0];
    }else if(this.focus){
      chosen=candidates.sort((a,b)=>Math.hypot(...a.center.map((v,k)=>v-this.focus[k]))-Math.hypot(...b.center.map((v,k)=>v-this.focus[k])))[0];
      if(Math.hypot(...chosen.center.map((v,k)=>v-this.focus[k]))>Math.max(0.08,chosen.height))return null;
    }else{
      chosen=candidates.sort((a,b)=>b.height*b.quality-a.height*a.quality)[0];
    }
    this.previous=chosen;this.lastTime=t;return chosen.index;
  }
}
