"""Start the local viewer from its project directory, checking dependencies first."""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import argparse
import subprocess
import sys
import json
from urllib.parse import urlsplit, parse_qs
from motion_service import MotionService

MOTION = MotionService()

ROOT = Path(__file__).resolve().parents[1]

class ViewerHandler(SimpleHTTPRequestHandler):
    def json_response(self, data, code=200):
        body=json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store')
        self.end_headers();self.wfile.write(body)

    def do_GET(self):
        request=urlsplit(self.path)
        if request.path=='/api/motion':
            return self.json_response({'available':MOTION.available()})
        if request.path=='/api/motion/job':
            job=MOTION.status(parse_qs(request.query).get('id',[''])[0])
            return self.json_response(job or {'error':'增强任务已过期，请重试'},200 if job else 404)
        return super().do_GET()

    def do_POST(self):
        # Only the page served on this loopback port can start/cancel inference.
        host=self.headers.get('Host','')
        port=self.server.server_port
        if host not in (f'127.0.0.1:{port}',f'localhost:{port}') or self.headers.get('Origin')!=f'http://{host}':
            return self.json_response({'error':'仅支持本机页面发起增强'},403)
        if self.headers.get('Content-Type','').split(';')[0]!='application/json':
            return self.json_response({'error':'需要 JSON 姿态数据'},415)
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=8*1024*1024:raise ValueError('姿态数据大小无效')
            data=json.loads(self.rfile.read(length))
            if self.path=='/api/motion':return self.json_response({'id':MOTION.start(data)},202)
            if self.path=='/api/motion/cancel':
                MOTION.cancel(data.get('id'));return self.json_response({'status':'cancelled'})
            return self.json_response({'error':'接口不存在'},404)
        except (ValueError,TypeError,AttributeError) as error:
            return self.json_response({'error':str(error)},400)

    def end_headers(self):
        if self.path.split('?', 1)[0].endswith(('/', '.html', '.js', '.mjs', '.css')):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    result = subprocess.run([sys.executable, str(ROOT / 'scripts' / 'download_assets.py')])
    if result.returncode:
        print('模型与依赖准备失败。请检查网络后重新运行启动脚本。', file=sys.stderr)
        return result.returncode
    handler = partial(ViewerHandler, directory=str(ROOT))
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), handler)
    except OSError as error:
        print(f'无法启动本地服务：{error}。端口被占用时，可使用 --port 8766。', file=sys.stderr)
        return 1
    print(f'舞迹已启动：请打开 http://127.0.0.1:{args.port}/', flush=True)
    print('使用期间请保持此窗口打开；按 Ctrl+C 停止服务。', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n本地服务已停止。重新运行启动脚本即可继续使用。')
    finally:
        MOTION.close()
        server.server_close()
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
