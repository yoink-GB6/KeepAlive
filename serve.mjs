// 本地预览用的静态服务器：node serve.mjs [端口]
// 默认监听所有网卡，同一 Wi-Fi 下的手机可以用下面打印的地址打开。
import http from 'node:http';
import { exec } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const firstPort = Number(process.argv[2]) || 8765;
// '::' 同时监听 IPv4 和 IPv6。只听 IPv4 的话，别的程序占着同端口的 IPv6 时不会报错，
// 但浏览器访问 localhost 会连到那个程序上去。
const host = process.env.HOST || '::';
const openBrowser = process.argv.includes('--open');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.mp4': 'video/mp4',
};

const server = http.createServer(async (req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { p = '/'; }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
  }
});

// 端口被占用就换下一个
let port = firstPort;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && port < firstPort + 20) {
    console.log(`端口 ${port} 已被占用，换 ${port + 1}`);
    server.listen(++port, host);
  } else {
    console.error(`启动失败: ${err.message}`);
    process.exit(1);
  }
});
server.on('listening', () => {
  const url = `http://localhost:${port}/`;
  console.log(`本机打开:  ${url}`);
  if (host === '::' || host === '0.0.0.0') {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list || []) {
        if (n.family === 'IPv4' && !n.internal) console.log(`手机打开:  http://${n.address}:${port}/`);
      }
    }
  }
  console.log('按 Ctrl+C 停止');
  if (openBrowser && process.platform === 'win32') exec(`start "" "${url}"`);
});
server.listen(port, host);
