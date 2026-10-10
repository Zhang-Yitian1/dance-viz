import {test} from 'node:test';
import assert from 'node:assert/strict';
import {alignToImage,poseAt,smoothFrames,jointReliable} from '../src/core.js';
const fixture=()=>({t:0,issue:null,points:Array.from({length:33},()=>[0,0,0]),screen:Array.from({length:33},()=>[0.5,0.5,0.95])});
function torso(){
  const f=fixture();
  for(const [i,p,s]of [[11,[-0.2,0.5,0.1],[0.4,0.35,0.95]],[12,[0.2,0.5,0.1],[0.6,0.35,0.95]],[23,[-0.08,0,0],[0.46,0.6,0.95]],[24,[0.08,0,0],[0.54,0.6,0.95]]]){f.points[i]=p;f.screen[i]=s;}return f;
}
test('image constraint corrects XY against the video while preserving estimated relative depth',()=>{
  const f=torso();f.points[15]=[0.4,0.2,0.3];f.screen[15]=[0.25,0.3,0.95];
  const aligned=alignToImage(f,0.5625),scale=aligned.points[11][1]/0.25;
  assert.equal(aligned.projectionAligned,true);
  assert.ok(Math.abs(aligned.points[15][0]-(-0.25*0.5625*scale))<1e-10);
  assert.ok(Math.abs(aligned.points[15][1]-0.3*scale)<1e-10);
  assert.equal(aligned.points[15][2],0.3);assert.equal(f.points[15][0],0.4);
});
test('invalid or hidden torso does not manufacture a camera scale',()=>{
  const f=torso();f.screen[23][2]=0.1;
  assert.equal(alignToImage(f,0.5625),f);assert.equal(alignToImage(torso(),NaN).projectionAligned,undefined);
});
test('centered smoothing has no phase lag for constant-velocity movement',()=>{
  const frames=[0,0.033,0.066].map((t,i)=>({...fixture(),t,points:Array.from({length:33},()=>[i*0.1,0,0])}));
  assert.equal(smoothFrames(frames)[1].points[15][0],0.1);
});
test('2D and 3D use the same subframe timestamp even when another joint is occluded',()=>{
  const a=fixture(),b={...fixture(),t:0.05};b.points[15]=[0.2,0,0];b.screen[15]=[0.7,0.5,0.95];
  b.screen[28][2]=0.1;b.issue='部分关节被遮挡或识别不稳定';
  const pose=poseAt(0.025,[a,b]);assert.equal(pose.points[15][0],0.1);assert.equal(pose.screen[15][0],0.6);assert.equal(jointReliable(pose,28),false);
});
