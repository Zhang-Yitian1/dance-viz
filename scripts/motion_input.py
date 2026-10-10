"""Validate browser observations and convert MediaPipe image points to H36M-17."""
import math

MAP = {1:24,2:26,3:28,4:23,5:25,6:27,9:0,11:11,12:13,13:15,14:12,15:14,16:16}
SUPPORTED = [7,8,11,12,13,14,15,16,23,24,25,26,27,28]

def validate(data):
    if not isinstance(data, dict):
        raise ValueError('姿态数据格式不正确')
    for key in ('width','height'):
        value=data.get(key)
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not 1<=value<=16384:
            raise ValueError('视频尺寸无效')
    frames=data.get('frames')
    if not isinstance(frames,list) or not 1<=len(frames)<=2701:
        raise ValueError('仅支持 90 秒内的 30 帧/秒姿态序列')
    previous=-1
    for frame in frames:
        if not isinstance(frame,dict):raise ValueError('帧格式不正确')
        t=frame.get('t')
        if isinstance(t,bool) or not isinstance(t,(int,float)) or not math.isfinite(t) or not 0<=t<=90 or t<=previous:
            raise ValueError('时间轴无效')
        if previous>=0 and abs(t-previous-1/30)>1e-4:raise ValueError('时序三维需要连续的 30 帧/秒采样')
        previous=t
        screen=frame.get('screen')
        if screen is None:continue
        if not isinstance(screen,list) or len(screen)!=33:raise ValueError('需要 33 个二维检测点')
        for p in screen:
            if not isinstance(p,list) or len(p)!=3 or any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) for v in p):raise ValueError('二维检测点无效')
            if not -4<=p[0]<=5 or not -4<=p[1]<=5 or not 0<=p[2]<=1:raise ValueError('二维检测点越界')
    return data

def to_h36m(screen,width,height):
    def midpoint(a,b):return [(a[k]+b[k])/2 for k in (0,1)]+[min(a[2],b[2])]
    x=[[0.,0.,0.] for _ in range(17)]
    for j,i in MAP.items():x[j]=list(screen[i])
    x[0]=midpoint(screen[23],screen[24]);x[8]=midpoint(screen[11],screen[12]);x[7]=midpoint(x[0],x[8])
    ears=midpoint(screen[7],screen[8])
    # Head-top is approximate: MediaPipe does not detect the H36M head-top point.
    x[10]=[ears[k]+.5*(ears[k]-x[8][k]) for k in (0,1)]+[ears[2]]
    scale=min(width,height)/2
    return [[(p[0]*width-width/2)/scale,(p[1]*height-height/2)/scale,p[2]] for p in x]
