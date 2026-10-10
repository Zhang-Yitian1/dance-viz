"""Offline MotionBERT Lite inference. Input and output are joint coordinates only."""
import json
from pathlib import Path
import sys
import numpy as np
import torch
from motion_input import validate,to_h36m,SUPPORTED,MAP
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from third_party.motionbert.model import DSTformer

LEFT=[4,5,6,11,12,13];RIGHT=[1,2,3,14,15,16]
def flip(x):
    y=x.clone();y[...,0]*=-1;y[...,LEFT+RIGHT,:]=y[...,RIGHT+LEFT,:];return y

def infer(data,device=None):
    validate(data)
    torch.set_num_threads(4)
    model=DSTformer(dim_feat=256,dim_rep=512,depth=5,num_heads=8,maxlen=243)
    checkpoint=torch.load(ROOT/'vendor/models/motionbert_lite.bin',map_location='cpu',weights_only=True)
    model.load_state_dict({k.removeprefix('module.'):v for k,v in checkpoint['model_pos'].items()},strict=True)
    device=device or ('mps' if torch.backends.mps.is_available() else 'cpu')
    model.eval().to(device)
    frames=data['frames'];n=len(frames)
    observed=[i for i,f in enumerate(frames) if f['screen'] is not None]
    if not observed:raise ValueError('没有可用的二维姿态')
    x=np.zeros((n,17,3),np.float32)
    for i in observed:x[i]=to_h36m(frames[i]['screen'],data['width'],data['height'])
    # Missing frames provide interpolated context only. Their output remains missing.
    for j in range(17):
        for k in (0,1):x[:,j,k]=np.interp(np.arange(n),observed,x[observed,j,k])
    # Split at long tracking gaps to avoid mixing disconnected subjects/motions.
    runs=[];start=observed[0];last=start
    for i in observed[1:]:
        if i-last>6:runs.append((start,last+1));start=i
        last=i
    runs.append((start,last+1))
    result=np.zeros((n,17,3),np.float32);total=np.zeros((n,1,1),np.float32)
    with torch.inference_mode():
        for a,b in runs:
            starts=list(range(a,max(a+1,b-242),121))
            if starts[-1]!=max(a,b-243):starts.append(max(a,b-243))
            for st in starts:
                end=min(st+243,b);batch=torch.from_numpy(x[st:end]).unsqueeze(0).to(device)
                p=((model(batch)+flip(model(flip(batch))))/2).squeeze(0).cpu().numpy()
                length=end-st;w=np.minimum(np.minimum(np.arange(length)+1,length-np.arange(length)),61)/61
                result[st:end]+=p*w[:,None,None];total[st:end]+=w[:,None,None]
    result/=np.maximum(total,1e-8)
    if not np.isfinite(result).all():raise ValueError('三维模型输出无效')
    result-=result[:,0:1,:]
    lengths=np.linalg.norm(result[observed,8]-result[observed,0],axis=1)
    torso=float(np.median(lengths))
    if torso<1e-5:raise ValueError('三维人体尺度无效')
    # One scale for the entire clip; assumed torso size, not a measured body height.
    result*=.48/torso;result[:,:,1:]*=-1
    output=[]
    for i,f in enumerate(frames):
        if f['screen'] is None or total[i,0,0]==0:output.append(None);continue
        points=[[0.,0.,0.] for _ in range(33)]
        for j,k in MAP.items():points[k]=result[i,j].tolist()
        head=((result[i,9]+result[i,10])/2).tolist();points[7]=head;points[8]=head
        output.append(points)
    return {'points':output,'supported':SUPPORTED,'source':'motionbert','device':device}

if __name__=='__main__':
    try:
        result=infer(json.load(sys.stdin));json.dump(result,sys.stdout,allow_nan=False)
    except Exception as error:
        print(str(error),file=sys.stderr);raise SystemExit(1)
