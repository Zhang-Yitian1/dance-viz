"""Fetch pinned official npm packages and Google pose model; no uploaded video leaves the machine."""
from pathlib import Path
import argparse
import hashlib
import io
import json
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = {
    'three': ('0.180.0', {'build/three.module.js':'three/three.module.js','build/three.core.js':'three/three.core.js','examples/jsm/controls/OrbitControls.js':'three/addons/controls/OrbitControls.js','LICENSE':'three/LICENSE'}),
    '@mediapipe/tasks-vision': ('0.10.14', {'vision_bundle.mjs':'mediapipe/vision_bundle.mjs','wasm/vision_wasm_internal.js':'mediapipe/wasm/vision_wasm_internal.js','wasm/vision_wasm_internal.wasm':'mediapipe/wasm/vision_wasm_internal.wasm','wasm/vision_wasm_nosimd_internal.js':'mediapipe/wasm/vision_wasm_nosimd_internal.js','wasm/vision_wasm_nosimd_internal.wasm':'mediapipe/wasm/vision_wasm_nosimd_internal.wasm'}),
}
def get(url):
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()
def save(relative, data):
    target=ROOT/'vendor'/relative
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_bytes(data)
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--force',action='store_true',help='Re-download existing files')
    args=parser.parse_args()
    for package,(version,files) in PACKAGES.items():
        if not args.force and all((ROOT/'vendor'/name).exists() for name in files.values()):
            print(f'{package}@{version}: already downloaded');continue
        print(f'Downloading {package}@{version} from official npm registry…',flush=True)
        metadata=json.loads(get(f'https://registry.npmjs.org/{package}/{version}'))
        archive=get(metadata['dist']['tarball'])
        if hashlib.sha1(archive).hexdigest()!=metadata['dist']['shasum']:
            raise RuntimeError(f'Checksum mismatch for {package}')
        with tarfile.open(fileobj=io.BytesIO(archive),mode='r:gz') as tar:
            for source,destination in files.items():
                stream=tar.extractfile(f'package/{source}')
                if stream is None:raise RuntimeError(f'Missing package file {source}')
                save(destination,stream.read())
    model='models/pose_landmarker_full.task'
    if args.force or not (ROOT/'vendor'/model).exists():
        print('Downloading full pose model from Google…',flush=True)
        save(model,get('https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'))
    print('Ready. Run: python3 -m http.server 8765 --bind 127.0.0.1')
if __name__=='__main__':main()
