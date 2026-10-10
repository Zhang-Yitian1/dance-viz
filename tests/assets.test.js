import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkModelAssets} from '../src/assets.js';

const root = new URL('http://127.0.0.1:8765/');
test('stopped server prompts restart instead of model re-download', async () => {
  await assert.rejects(checkModelAssets(async () => { throw new TypeError('Failed to fetch'); }, root), /服务未运行或连接中断/);
});
test('missing asset prompts dependency setup', async () => {
  await assert.rejects(checkModelAssets(async url => ({ok: url.href === root.href}), root), /文件缺失/);
});
test('server disconnect during asset checks identifies connection failure', async () => {
  await assert.rejects(checkModelAssets(async url => {
    if (url.href === root.href) return {ok: true};
    throw new TypeError('Failed to fetch');
  }, root), /服务连接中断/);
});
test('available local assets pass without downloading their contents', async () => {
  const methods = [];
  await checkModelAssets(async (url, options) => { methods.push(options.method); return {ok: true}; }, root);
  assert.ok(methods.length > 1);
  assert.ok(methods.every(method => method === 'HEAD'));
});
