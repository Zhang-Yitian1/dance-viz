import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {EDGES,traceAt,jointReliable,alignToImage,frameIndex} from './core.js';

export class MotionView{
  constructor(container,onRotate){
    this.container=container;this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#e9eee7');
    this.camera=new THREE.OrthographicCamera(-1.3,1.3,1.3,-1.3,0.01,100);this.camera.position.set(0,1,4.5);
    this.renderer=new THREE.WebGLRenderer({antialias:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));container.append(this.renderer.domElement);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.set(0,1,0);this.controls.enableDamping=true;this.controls.minZoom=0.5;this.controls.maxZoom=4;this.controls.addEventListener('start',onRotate);
    this.scene.add(new THREE.HemisphereLight(0xffffff,0x87977f,2));const key=new THREE.DirectionalLight(0xffffff,2);key.position.set(2,4,3);this.scene.add(key);
    const grid=new THREE.GridHelper(8,32,0xb8c7b1,0xd5dfce);grid.material.transparent=true;grid.material.opacity=0.55;this.scene.add(grid);
    this.root=new THREE.Group();this.root.position.y=1;this.root.visible=false;this.scene.add(this.root);
    this.skin=new THREE.MeshStandardMaterial({color:0x6f9b83,transparent:true,opacity:0.25,depthWrite:false,roughness:0.65});
    const cylinder=new THREE.CylinderGeometry(1,1,1,14);this.bones=EDGES.map(([a,b])=>{const mesh=new THREE.Mesh(cylinder,this.skin);mesh.userData={a,b};this.root.add(mesh);return mesh;});
    this.skeleton=this.makeLine(EDGES.length*2,0x39725c);this.root.add(this.skeleton);
    const sphere=new THREE.SphereGeometry(1,16,12);this.joints=[11,12,13,14,15,16,23,24,25,26,27,28].map(i=>{const mesh=new THREE.Mesh(sphere,new THREE.MeshStandardMaterial({color:0x52806b}));mesh.scale.setScalar(0.021);mesh.userData.i=i;this.root.add(mesh);return mesh;});
    this.torso=new THREE.Mesh(sphere,this.skin);this.root.add(this.torso);this.pelvis=new THREE.Mesh(sphere,this.skin);this.root.add(this.pelvis);this.head=new THREE.Mesh(sphere,this.skin);this.head.scale.set(0.075,0.10,0.075);this.root.add(this.head);
    this.guides=[this.makeLine(2,0xcb815e),this.makeLine(2,0x527da3)];this.guides.forEach(x=>this.root.add(x));
    this.traces=[15,16,27,28].map((joint,i)=>{const line=this.makeLine(200,i<2?0xc77552:0x497c9d);line.userData.joint=joint;line.material.transparent=true;line.material.opacity=0.8;this.root.add(line);return line;});
    this.up=new THREE.Vector3(0,1,0);this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();
  }
  makeLine(n,color){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(n*3),3));geometry.setDrawRange(0,0);return new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color}));}
  setLine(line,points){const array=line.geometry.attributes.position.array;points.forEach((p,i)=>array.set(p,i*3));line.geometry.attributes.position.needsUpdate=true;line.geometry.setDrawRange(0,points.length);line.geometry.computeBoundingSphere();}
  resize(){const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h);this.camera.left=-1.3*w/h;this.camera.right=1.3*w/h;this.camera.updateProjectionMatrix();}
  view(name){const points={front:[0,1,4.5],left:[-4.5,1,0],back:[0,1,-4.5],right:[4.5,1,0],top:[0.001,5.5,0.001]};this.camera.position.set(...points[name]);this.controls.target.set(0,1,0);this.controls.update();}
  update(pose,t,frames,options){
    this.root.visible=Boolean(pose?.points)&&!pose.unstable;if(!this.root.visible)return;
    this.root.scale.x=options.mirror?-1:1;this.skin.opacity=options.opacity;const p=pose.points;
    const reliable=i=>jointReliable(pose,i);
    this.bones.forEach(m=>{const {a,b}=m.userData;m.visible=reliable(a)&&reliable(b);const A=new THREE.Vector3(...p[a]),B=new THREE.Vector3(...p[b]),direction=B.clone().sub(A),length=direction.length();m.position.copy(A).add(B).multiplyScalar(0.5);m.quaternion.setFromUnitVectors(this.up,direction.normalize());const radius=a>=23?0.043:0.028;m.scale.set(radius,Math.max(length,0.001),radius);});
    const hip=new THREE.Vector3(...p[23]).add(new THREE.Vector3(...p[24])).multiplyScalar(0.5),shoulder=new THREE.Vector3(...p[11]).add(new THREE.Vector3(...p[12])).multiplyScalar(0.5),spine=shoulder.clone().sub(hip);
    const orient=(mesh,a,b,y)=>{const side=b.clone().sub(a);side.addScaledVector(y,-side.dot(y));if(side.lengthSq()>.000001){side.normalize();const normal=side.clone().cross(y).normalize();mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side,y,normal));}else mesh.quaternion.setFromUnitVectors(this.up,y);};
    const length=spine.length();spine.normalize();
    this.torso.position.copy(hip).lerp(shoulder,.65);this.torso.scale.set(new THREE.Vector3(...p[11]).distanceTo(new THREE.Vector3(...p[12]))*.45,length*.40,.075);orient(this.torso,new THREE.Vector3(...p[11]),new THREE.Vector3(...p[12]),spine);
    this.pelvis.position.copy(hip).lerp(shoulder,.10);this.pelvis.scale.set(new THREE.Vector3(...p[23]).distanceTo(new THREE.Vector3(...p[24]))*.55,length*.22,.085);orient(this.pelvis,new THREE.Vector3(...p[23]),new THREE.Vector3(...p[24]),spine);
    this.torso.visible=this.pelvis.visible=[11,12,23,24].every(reliable);this.head.visible=reliable(7)&&reliable(8);this.head.position.fromArray(p[7]).add(new THREE.Vector3(...p[8])).multiplyScalar(.5);
    this.skeleton.visible=options.skeleton;this.setLine(this.skeleton,EDGES.filter(([a,b])=>reliable(a)&&reliable(b)).flatMap(([a,b])=>[p[a],p[b]]));this.joints.forEach(m=>{m.visible=options.skeleton&&reliable(m.userData.i);m.position.fromArray(p[m.userData.i]);m.material.color.set(pose.issue?0xb77b35:0x52806b);});
    [[11,12],[23,24]].forEach(([a,b],i)=>{this.guides[i].visible=options.guides&&reliable(a)&&reliable(b);this.setLine(this.guides[i],[p[a],p[b]]);});
    this.traces.forEach((line,i)=>{line.visible=(i<2?options.hands:options.feet)&&jointReliable(pose,line.userData.joint);let points;if(options.alignment&&pose.source!=='motionbert'){points=[];for(let j=frameIndex(t,frames);j>=0&&frames[j].t>=t-options.trailLength;j--){const f=frames[j];if(!jointReliable(f,line.userData.joint)||f.unstable)break;const aligned=alignToImage(f,options.aspect);if(!aligned.projectionAligned)break;points.unshift(aligned.points[line.userData.joint]);}}else points=traceAt(t,frames,line.userData.joint,options.trailLength);const segments=[];for(let j=1;j<points.length;j++)segments.push(points[j-1],points[j]);this.setLine(line,segments);});
  }
  draw(){this.controls.update();this.renderer.render(this.scene,this.camera);}
}
