"""Prepare optional local sequence inference; downloads code dependencies and model, no videos."""
from pathlib import Path
import hashlib
import subprocess
import sys
import urllib.request
import venv

ROOT=Path(__file__).resolve().parents[1]
SHA256='9811155371db4ca5d20f31a36a232d41012e12e1333882888a564d741861148f'
URL='https://huggingface.co/walterzhu/MotionBERT/resolve/370a919/checkpoint/pose3d/FT_MB_lite_MB_ft_h36m_global_lite/best_epoch.bin'
def main():
    if not (3,10)<=sys.version_info[:2]<=(3,13):
        print('时序三维需要 Python 3.10–3.13。请用 python3.12 scripts/setup_motion.py 运行。',file=sys.stderr);return 1
    folder=ROOT/'.motion-env'
    python=folder/('Scripts/python.exe' if sys.platform=='win32' else 'bin/python')
    if not python.exists():venv.create(folder,with_pip=True)
    subprocess.run([str(python),'-m','pip','install','torch==2.8.0','numpy==2.2.6'],check=True)
    target=ROOT/'vendor/models/motionbert_lite.bin'
    if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest()!=SHA256:
        target.parent.mkdir(parents=True,exist_ok=True)
        temporary=target.with_suffix('.download')
        print('下载作者发布的 MotionBERT Lite 权重（约 64 MB）…',flush=True)
        try:
            with urllib.request.urlopen(URL,timeout=120) as response,temporary.open('wb') as output:
                while chunk:=response.read(1024*1024):output.write(chunk)
            if hashlib.sha256(temporary.read_bytes()).hexdigest()!=SHA256:raise RuntimeError('模型校验失败')
            temporary.replace(target)
        finally:temporary.unlink(missing_ok=True)
    print('时序三维已准备好。重新启动本地服务后可使用「增强三维」。')
    return 0
if __name__=='__main__':raise SystemExit(main())
