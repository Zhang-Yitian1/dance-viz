"""One local inference job at a time. Coordinates are held in memory, never saved."""
import json
import os
from pathlib import Path
import subprocess
import threading
import time
import uuid
from motion_input import validate
ROOT=Path(__file__).resolve().parents[1]
PYTHON=ROOT/'.motion-env'/('Scripts/python.exe' if os.name=='nt' else 'bin/python')

class MotionService:
    def __init__(self):
        self.lock=threading.Lock();self.job=None
    def available(self):return PYTHON.exists() and (ROOT/'vendor/models/motionbert_lite.bin').exists()
    def start(self,data):
        validate(data)
        if not self.available():raise ValueError('请先运行 scripts/setup_motion.py，准备本地时序三维模型')
        with self.lock:
            if self.job and self.job['status']=='running':raise ValueError('本机正在增强另一段动作，请稍后重试')
            job={'id':uuid.uuid4().hex,'status':'running','started':time.monotonic(),'process':None}
            self.job=job
        threading.Thread(target=self._run,args=(job,data),daemon=True).start()
        return job['id']
    def _run(self,job,data):
        try:
            process=subprocess.Popen([str(PYTHON),str(ROOT/'scripts/motion_worker.py')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env={**os.environ,'PYTORCH_ENABLE_MPS_FALLBACK':'1'})
            with self.lock:
                job['process']=process
                if job['status']=='cancelled':process.terminate()
            try:out,error=process.communicate(json.dumps(data),timeout=300)
            except subprocess.TimeoutExpired:
                process.kill();process.communicate();raise ValueError('增强三维超时，请先用较短片段')
            if process.returncode:raise ValueError(error.strip()[-500:] or '本地三维模型运行失败')
            result=json.loads(out)
            with self.lock:
                if job['status']=='running':job.update(status='done',result=result)
        except Exception as error:
            with self.lock:
                if job['status']=='running':job.update(status='error',error=str(error))
        finally:
            with self.lock:job['process']=None
    def status(self,identifier):
        with self.lock:
            if not self.job or self.job['id']!=identifier or time.monotonic()-self.job['started']>900:
                if self.job and self.job['status']!='running':self.job=None
                return None
            return {k:v for k,v in self.job.items() if k in ('id','status','result','error')}
    def cancel(self,identifier):
        with self.lock:
            if self.job and self.job['id']==identifier and self.job['status']=='running':
                self.job['status']='cancelled'
                if self.job['process']:self.job['process'].terminate()
    def close(self):
        with self.lock:
            if self.job and self.job['process']:self.job['process'].terminate()
            self.job=None
