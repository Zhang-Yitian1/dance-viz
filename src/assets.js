const ROOT = new URL('../', import.meta.url);
const ASSETS = [
  'vendor/mediapipe/vision_bundle.mjs',
  'vendor/mediapipe/wasm/vision_wasm_internal.js',
  'vendor/mediapipe/wasm/vision_wasm_internal.wasm',
  'vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js',
  'vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm',
];

export async function checkModelAssets(request = fetch, root = ROOT, variant = 'full') {
  if(!['full','heavy'].includes(variant))throw new Error('未知姿态模型');
  let server;
  try {
    server = await request(root, { method: 'HEAD', cache: 'no-store' });
  } catch {
    throw new Error('本地网页服务未运行或连接中断。请运行 start.command（或 python3 scripts/serve.py），保持启动窗口打开，再点击分析。');
  }
  if (!server.ok) {
    throw new Error('当前网页服务未正确提供项目文件。请使用 start.command 或 python3 scripts/serve.py 启动项目。');
  }
  let responses;
  try {
    responses = await Promise.all([...ASSETS,`vendor/models/pose_landmarker_${variant}.task`].map(path => request(new URL(path, root), { method: 'HEAD', cache: 'no-store' })));
  } catch {
    throw new Error('读取模型时本地服务连接中断。请保持启动窗口打开，服务恢复后再点击分析。');
  }
  if (responses.some(response => !response.ok)) {
    throw new Error('本地模型或依赖文件缺失。请运行 start.command 自动补齐文件，或运行 python3 scripts/download_assets.py 后重试。');
  }
}
