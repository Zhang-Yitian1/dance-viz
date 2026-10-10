"""Start the local viewer from its project directory, checking dependencies first."""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import argparse
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

class ViewerHandler(SimpleHTTPRequestHandler):
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
        server.server_close()
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
