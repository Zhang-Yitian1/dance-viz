import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SubjectTracker} from '../src/subject.js';
import {makeFrame,jointReliable} from '../src/core.js';
function person(x,height=0.2){
  const points=Array.from({length:33},()=>({x,y:0.5,z:0,visibility:0.95}));
  [11,12].forEach((i,j)=>Object.assign(points[i],{x:x+(j?0.03:-0.03),y:0.5-height/2}));
  [23,24].forEach((i,j)=>Object.assign(points[i],{x:x+(j?0.02:-0.02),y:0.5+height/2}));
  return points;
}
test('candidate reordering does not switch the dancer to a reflection',()=>{
  const tracker=new SubjectTracker(),dancer=person(0.7),reflection=person(0.3,0.15);
  assert.equal(tracker.select({landmarks:[dancer,reflection]},0),0);
  assert.equal(tracker.select({landmarks:[reflection,person(0.71)]},0.05),1);
});
test('clicked starting position selects a smaller target over a larger other person',()=>{
  const tracker=new SubjectTracker([0.3,0.5]);
  assert.equal(tracker.select({landmarks:[person(0.7),person(0.3,0.15)]},0),1);
});
test('missing or distant candidates produce a gap and preserve the existing target',()=>{
  const tracker=new SubjectTracker();tracker.select({landmarks:[person(0.7)]},0);
  assert.equal(tracker.select({landmarks:[person(0.3)]},0.05),null);
  assert.equal(tracker.select({landmarks:[]},0.1),null);
  assert.equal(tracker.select({landmarks:[person(0.71)]},0.15),0);
});
test('ambiguous nearby candidates do not silently change subject',()=>{
  const tracker=new SubjectTracker();tracker.select({landmarks:[person(0.7)]},0);
  assert.equal(tracker.select({landmarks:[person(0.695),person(0.705)]},0.05),null);
});
test('chosen candidate uses matching image and world landmarks',()=>{
  const first=person(0.3),second=person(0.7);
  const result={landmarks:[first,second],worldLandmarks:[first,second]};
  assert.equal(makeFrame(0,result,1).screen[15][0],0.7);
  assert.equal(makeFrame(0,result,1).points[15][0],0.7);
  assert.equal(makeFrame(0,result,null).points,null);
});
test('low joint presence hides a limb even when visibility is high',()=>{
  const landmarks=person(0.5);landmarks[15].presence=0.1;
  const pose=makeFrame(0,{landmarks:[landmarks],worldLandmarks:[landmarks]});
  assert.equal(jointReliable(pose,15),false);
  assert.equal(jointReliable(pose,16),true);
  assert.ok(pose.issue);
});
