import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { providers } from '../src/main/ai.js';

const images = [Buffer.from('frame-1'), Buffer.from('frame-2'), Buffer.from('now')];
const b64 = images.map((b) => b.toString('base64'));
const messages = [{ role: 'user', content: 'avant' }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'Aide-moi' }];

// Answers 400 to every request: we only need what the SDK sent.
async function captureRequest(call) {
  let body;
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (d) => (data += d));
    req.on('end', () => { body = JSON.parse(data); res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":{"message":"stop"}}'); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { await call(`http://127.0.0.1:${server.address().port}`).catch(() => {}); } finally { server.close(); }
  return body;
}

test('anthropic sends one image block per screenshot before the text of the last message', async () => {
  const body = await captureRequest((baseUrl) =>
    providers.anthropic({ ai: { apiKey: 'k', baseUrl, model: 'm' }, system: 's', messages, images }));
  assert.equal(body.messages[0].content, 'avant');
  const last = body.messages.at(-1).content;
  assert.deepEqual(last.map((c) => c.source?.data ?? c.text), [...b64, 'Aide-moi']);
});

test('openai sends one image_url per screenshot on the last message', async () => {
  const body = await captureRequest((baseUrl) =>
    providers.openai({ ai: { apiKey: 'k', baseUrl: `${baseUrl}/v1`, model: 'm' }, system: 's', messages, images }));
  const last = body.messages.at(-1).content;
  assert.deepEqual(last.map((c) => c.image_url?.url ?? c.text), ['Aide-moi', ...b64.map((d) => `data:image/png;base64,${d}`)]);
});

// A fake `claude` / `codex` first on PATH that logs what it received.
function fakeCli(name, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meetinter-test-'));
  fs.writeFileSync(path.join(dir, 'fake.mjs'), script);
  if (process.platform === 'win32') fs.writeFileSync(path.join(dir, `${name}.cmd`), '@node "%~dp0fake.mjs" %*\r\n');
  else fs.writeFileSync(path.join(dir, name), `#!/bin/sh\nexec node "${path.join(dir, 'fake.mjs')}" "$@"\n`, { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
  return { log: path.join(dir, 'log.json'), restore: () => { process.env.PATH = oldPath; fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('claude-cli sends one image block per screenshot before the text', async () => {
  const cli = fakeCli('claude', `import fs from 'node:fs';
let input = '';
process.stdin.on('data', (d) => (input += d)).on('end', () => {
  fs.writeFileSync(new URL('log.json', import.meta.url), input);
  console.log(JSON.stringify({ type: 'result', result: 'ok' }));
});`);
  try {
    assert.equal(await providers['claude-cli']({ ai: { model: 'claude-x' }, system: 's', messages, images }), 'ok');
    const content = JSON.parse(fs.readFileSync(cli.log, 'utf8')).message.content;
    assert.deepEqual(content.slice(0, -1).map((c) => c.source.data), b64);
    assert.match(content.at(-1).text, /Aide-moi/);
  } finally { cli.restore(); }
});

test('codex-cli passes every screenshot with -i, last before stdin', async () => {
  const cli = fakeCli('codex', `import fs from 'node:fs';
const argv = process.argv.slice(2);
const files = argv.flatMap((a, i) => (a === '-i' ? [argv[i + 1]] : []));
fs.writeFileSync(new URL('log.json', import.meta.url), JSON.stringify({ argv, images: files.map((f) => fs.readFileSync(f, 'base64')) }));
fs.writeFileSync(argv[argv.indexOf('--output-last-message') + 1], 'ok');
process.stdin.resume();`);
  try {
    assert.equal(await providers['codex-cli']({ ai: { model: 'gpt-x' }, system: 's', messages, images }), 'ok');
    const { argv, images: sent } = JSON.parse(fs.readFileSync(cli.log, 'utf8'));
    assert.deepEqual(sent, b64);
    assert.equal(argv.at(-2), '-i');
  } finally { cli.restore(); }
});
