#!/usr/bin/env node
// CDP Proxy - 通过 HTTP API 操控用户日常 Chrome
// 要求：Chrome 已开启 --remote-debugging-port
// Node.js 22+（使用原生 WebSocket）

import http from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';

const PORT = parseInt(process.env.CDP_PROXY_PORT || '3456');
let ws = null;
let cmdId = 0;
const pending = new Map(); // id -> {resolve, timer}
const sessions = new Map(); // targetId -> sessionId

// --- WebSocket 兼容层 ---
let WS;
if (typeof globalThis.WebSocket !== 'undefined') {
  // Node 22+ 原生 WebSocket（浏览器兼容 API）
  WS = globalThis.WebSocket;
} else {
  // 回退到 ws 模块
  try {
    WS = (await import('ws')).default;
  } catch {
    console.error('[CDP Proxy] 错误：Node.js 版本 < 22 且未安装 ws 模块');
    console.error('  解决方案：升级到 Node.js 22+ 或执行 npm install -g ws');
    process.exit(1);
  }
}

// --- 自动发现 Chrome 调试端口 ---
async function discoverChromePort() {
  const possiblePaths = [];
  const platform = os.platform();

  if (platform === 'darwin') {
    const home = os.homedir();
    possiblePaths.push(
      path.join(home, 'Library/Application Support/Google/Chrome/DevToolsActivePort'),
      path.join(home, 'Library/Application Support/Google/Chrome Canary/DevToolsActivePort'),
      path.join(home, 'Library/Application Support/Chromium/DevToolsActivePort'),
    );
  } else if (platform === 'linux') {
    const home = os.homedir();
    possiblePaths.push(
      path.join(home, '.config/google-chrome/DevToolsActivePort'),
      path.join(home, '.config/chromium/DevToolsActivePort'),
    );
  } else if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    possiblePaths.push(
      path.join(localAppData, 'Google/Chrome/User Data/DevToolsActivePort'),
      path.join(localAppData, 'Chromium/User Data/DevToolsActivePort'),
    );
  }

  for (const p of possiblePaths) {
    try {
      const content = fs.readFileSync(p, 'utf-8').trim();
      const lines = content.split('\n');
      const port = parseInt(lines[0]);
      if (port > 0 && port < 65536) {
        const ok = await checkPort(port);
        if (ok) {
          const wsPath = lines[1] || null;
          console.log(`[CDP Proxy] 从 DevToolsActivePort 发现端口: ${port}${wsPath ? ' (带 wsPath)' : ''}`);
          return { port, wsPath };
        }
      }
    } catch { /* 文件不存在，继续 */ }
  }

  const commonPorts = [9222, 9229, 9333];
  for (const port of commonPorts) {
    const ok = await checkPort(port);
    if (ok) {
      console.log(`[CDP Proxy] 扫描发现 Chrome 调试端口: ${port}`);
      return { port, wsPath: null };
    }
  }

  return null;
}

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, '127.0.0.1');
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 2000);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

function getWebSocketUrl(port, wsPath) {
  if (wsPath) return `ws://127.0.0.1:${port}${wsPath}`;
  return `ws://127.0.0.1:${port}/devtools/browser`;
}

// --- WebSocket 连接管理 ---
let chromePort = null;
let chromeWsPath = null;

let connectingPromise = null;
async function connect() {
  if (ws && (ws.readyState === WS.OPEN || ws.readyState === 1)) return;
  if (connectingPromise) return connectingPromise;

  if (!chromePort) {
    const discovered = await discoverChromePort();
    if (!discovered) {
      throw new Error(
        'Chrome 未开启远程调试端口。请用以下方式启动 Chrome：\n' +
        '  macOS: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222\n' +
        '  Linux: google-chrome --remote-debugging-port=9222\n' +
        '  或在 chrome://flags 中搜索 "remote debugging" 并启用'
      );
    }
    chromePort = discovered.port;
    chromeWsPath = discovered.wsPath;
  }

  const wsUrl = getWebSocketUrl(chromePort, chromeWsPath);
  if (!wsUrl) throw new Error('无法获取 Chrome WebSocket URL');

  return connectingPromise = new Promise((resolve, reject) => {
    ws = new WS(wsUrl);

    const onOpen = () => {
      cleanup();
      connectingPromise = null;
      console.log(`[CDP Proxy] 已连接 Chrome (端口 ${chromePort})`);
      resolve();
    };
    const onError = (e) => {
      cleanup();
      connectingPromise = null;
      const msg = e.message || e.error?.message || '连接失败';
      console.error('[CDP Proxy] 连接错误:', msg);
      reject(new Error(msg));
    };
    const onClose = () => {
      console.log('[CDP Proxy] 连接断开');
      ws = null;
      chromePort = null;
      chromeWsPath = null;
      sessions.clear();
    };
    const onMessage = (evt) => {
      const data = typeof evt === 'string' ? evt : (evt.data || evt);
      const msg = JSON.parse(typeof data === 'string' ? data : data.toString());

      if (msg.method === 'Target.attachedToTarget') {
        const { sessionId, targetInfo } = msg.params;
        sessions.set(targetInfo.targetId, sessionId);
      }
      if (msg.id && pending.has(msg.id)) {
        const { resolve, timer } = pending.get(msg.id);
        clearTimeout(timer);
        pending.delete(msg.id);
        resolve(msg);
      }
    };

    function cleanup() {
      ws.removeEventListener?.('open', onOpen);
      ws.removeEventListener?.('error', onError);
    }

    if (ws.on) {
      ws.on('open', onOpen);
      ws.on('error', onError);
      ws.on('close', onClose);
      ws.on('message', onMessage);
    } else {
      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onError);
      ws.addEventListener('close', onClose);
      ws.addEventListener('message', onMessage);
    }
  });
}

function sendCDP(method, params = {}, sessionId = null) {
  return new Promise((resolve, reject) => {
    if (!ws || (ws.readyState !== WS.OPEN && ws.readyState !== 1)) {
      return reject(new Error('WebSocket 未连接'));
    }
    const id = ++cmdId;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('CDP 命令超时: ' + method));
    }, 30000);
    pending.set(id, { resolve, timer });
    ws.send(JSON.stringify(msg));
  });
}

async function ensureSession(targetId) {
  if (sessions.has(targetId)) return sessions.get(targetId);
  const resp = await sendCDP('Target.attachToTarget', { targetId, flatten: true });
  if (resp.result?.sessionId) {
    sessions.set(targetId, resp.result.sessionId);
    return resp.result.sessionId;
  }
  throw new Error('attach 失败: ' + JSON.stringify(resp.error));
}

async function waitForLoad(sessionId, timeoutMs = 15000) {
  await sendCDP('Page.enable', {}, sessionId);

  return new Promise((resolve) => {
    let resolved = false;
    const done = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      clearInterval(checkInterval);
      resolve(result);
    };

    const timer = setTimeout(() => done('timeout'), timeoutMs);
    const checkInterval = setInterval(async () => {
      try {
        const resp = await sendCDP('Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true,
        }, sessionId);
        if (resp.result?.result?.value === 'complete') {
          done('complete');
        }
      } catch { /* 忽略 */ }
    }, 500);
  });
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;
  const q = Object.fromEntries(parsed.searchParams);

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    if (pathname === '/health') {
      const connected = ws && (ws.readyState === WS.OPEN || ws.readyState === 1);
      res.end(JSON.stringify({ status: 'ok', connected, sessions: sessions.size, chromePort }));
      return;
    }

    await connect();

    if (pathname === '/targets') {
      const resp = await sendCDP('Target.getTargets');
      const pages = resp.result.targetInfos.filter(t => t.type === 'page');
      res.end(JSON.stringify(pages, null, 2));
    }

    else if (pathname === '/new') {
      const targetUrl = q.url || 'about:blank';
      const resp = await sendCDP('Target.createTarget', { url: targetUrl, background: true });
      const targetId = resp.result.targetId;

      if (targetUrl !== 'about:blank') {
        try {
          const sid = await ensureSession(targetId);
          await waitForLoad(sid);
        } catch { /* 非致命，继续 */ }
      }

      res.end(JSON.stringify({ targetId }));
    }

    else if (pathname === '/close') {
      const resp = await sendCDP('Target.closeTarget', { targetId: q.target });
      sessions.delete(q.target);
      res.end(JSON.stringify(resp.result));
    }

    else if (pathname === '/navigate') {
      const sid = await ensureSession(q.target);
      const resp = await sendCDP('Page.navigate', { url: q.url }, sid);
      await waitForLoad(sid);
      res.end(JSON.stringify(resp.result));
    }

    else if (pathname === '/back') {
      const sid = await ensureSession(q.target);
      await sendCDP('Runtime.evaluate', { expression: 'history.back()' }, sid);
      await waitForLoad(sid);
      res.end(JSON.stringify({ ok: true }));
    }

    else if (pathname === '/eval') {
      const sid = await ensureSession(q.target);
      const body = await readBody(req);
      const expr = body || q.expr || 'document.title';
      const resp = await sendCDP('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
      }, sid);
      if (resp.result?.result?.value !== undefined) {
        res.end(JSON.stringify({ value: resp.result.result.value }));
      } else if (resp.result?.exceptionDetails) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: resp.result.exceptionDetails.text }));
      } else {
        res.end(JSON.stringify(resp.result));
      }
    }

    else if (pathname === '/click') {
      const sid = await ensureSession(q.target);
      const selector = await readBody(req);
      if (!selector) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'POST body 需要 CSS 选择器' }));
        return;
      }
      const selectorJson = JSON.stringify(selector);
      const js = `(() => {
        const el = document.querySelector(${selectorJson});
        if (!el) return { error: '未找到元素: ' + ${selectorJson} };
        el.scrollIntoView({ block: 'center' });
        el.click();
        return { clicked: true, tag: el.tagName, text: (el.textContent || '').slice(0, 100) };
      })()`;
      const resp = await sendCDP('Runtime.evaluate', {
        expression: js,
        returnByValue: true,
        awaitPromise: true,
      }, sid);
      if (resp.result?.result?.value) {
        const val = resp.result.result.value;
        if (val.error) {
          res.statusCode = 400;
          res.end(JSON.stringify(val));
        } else {
          res.end(JSON.stringify(val));
        }
      } else {
        res.end(JSON.stringify(resp.result));
      }
    }

    else if (pathname === '/clickAt') {
      const sid = await ensureSession(q.target);
      const selector = await readBody(req);
      if (!selector) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'POST body 需要 CSS 选择器' }));
        return;
      }
      const selectorJson = JSON.stringify(selector);
      const js = `(() => {
        const el = document.querySelector(${selectorJson});
        if (!el) return { error: '未找到元素: ' + ${selectorJson} };
        el.scrollIntoView({ block: 'center' });
        const rect = el.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, tag: el.tagName, text: (el.textContent || '').slice(0, 100) };
      })()`;
      const coordResp = await sendCDP('Runtime.evaluate', {
        expression: js,
        returnByValue: true,
        awaitPromise: true,
      }, sid);
      const coord = coordResp.result?.result?.value;
      if (!coord || coord.error) {
        res.statusCode = 400;
        res.end(JSON.stringify(coord || coordResp.result));
        return;
      }
      await sendCDP('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: coord.x, y: coord.y, button: 'left', clickCount: 1
      }, sid);
      await sendCDP('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: coord.x, y: coord.y, button: 'left', clickCount: 1
      }, sid);
      res.end(JSON.stringify({ clicked: true, x: coord.x, y: coord.y, tag: coord.tag, text: coord.text }));
    }

    else if (pathname === '/setFiles') {
      const sid = await ensureSession(q.target);
      const body = JSON.parse(await readBody(req));
      if (!body.selector || !body.files) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: '需要 selector 和 files 字段' }));
        return;
      }
      await sendCDP('DOM.enable', {}, sid);
      const doc = await sendCDP('DOM.getDocument', {}, sid);
      const node = await sendCDP('DOM.querySelector', {
        nodeId: doc.result.root.nodeId,
        selector: body.selector
      }, sid);
      if (!node.result?.nodeId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: '未找到元素: ' + body.selector }));
        return;
      }
      await sendCDP('DOM.setFileInputFiles', {
        nodeId: node.result.nodeId,
        files: body.files
      }, sid);
      res.end(JSON.stringify({ success: true, files: body.files.length }));
    }

    else if (pathname === '/scroll') {
      const sid = await ensureSession(q.target);
      const y = parseInt(q.y || '3000');
      const direction = q.direction || 'down';
      let js;
      if (direction === 'top') {
        js = 'window.scrollTo(0, 0); "scrolled to top"';
      } else if (direction === 'bottom') {
        js = 'window.scrollTo(0, document.body.scrollHeight); "scrolled to bottom"';
      } else if (direction === 'up') {
        js = `window.scrollBy(0, -${Math.abs(y)}); "scrolled up ${Math.abs(y)}px"`;
      } else {
        js = `window.scrollBy(0, ${Math.abs(y)}); "scrolled down ${Math.abs(y)}px"`;
      }
      const resp = await sendCDP('Runtime.evaluate', {
        expression: js,
        returnByValue: true,
      }, sid);
      await new Promise(r => setTimeout(r, 800));
      res.end(JSON.stringify({ value: resp.result?.result?.value }));
    }

    else if (pathname === '/screenshot') {
      const sid = await ensureSession(q.target);
      const format = q.format || 'png';
      const resp = await sendCDP('Page.captureScreenshot', {
        format,
        quality: format === 'jpeg' ? 80 : undefined,
      }, sid);
      if (q.file) {
        fs.writeFileSync(q.file, Buffer.from(resp.result.data, 'base64'));
        res.end(JSON.stringify({ saved: q.file }));
      } else {
        res.setHeader('Content-Type', 'image/' + format);
        res.end(Buffer.from(resp.result.data, 'base64'));
      }
    }

    else if (pathname === '/info') {
      const sid = await ensureSession(q.target);
      const resp = await sendCDP('Runtime.evaluate', {
        expression: 'JSON.stringify({title: document.title, url: location.href, ready: document.readyState})',
        returnByValue: true,
      }, sid);
      res.end(resp.result?.result?.value || '{}');
    }

    else {
      res.statusCode = 404;
      res.end(JSON.stringify({
        error: '未知端点',
        endpoints: {
          '/health': 'GET - 健康检查',
          '/targets': 'GET - 列出所有页面 tab',
          '/new?url=': 'GET - 创建新后台 tab',
          '/close?target=': 'GET - 关闭 tab',
          '/navigate?target=&url=': 'GET - 导航',
          '/back?target=': 'GET - 后退',
          '/info?target=': 'GET - 页面信息',
          '/eval?target=': 'POST body=JS表达式',
          '/click?target=': 'POST body=CSS选择器',
          '/scroll?target=&y=&direction=': 'GET - 滚动',
          '/screenshot?target=&file=': 'GET - 截图',
        },
      }));
    }
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: e.message }));
  }
});

function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => { s.close(); resolve(true); });
    s.listen(port, '127.0.0.1');
  });
}

async function main() {
  const available = await checkPortAvailable(PORT);
  if (!available) {
    try {
      const ok = await new Promise((resolve) => {
        http.get(`http://127.0.0.1:${PORT}/health`, { timeout: 2000 }, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => resolve(d.includes('"ok"')));
        }).on('error', () => resolve(false));
      });
      if (ok) {
        console.log(`[CDP Proxy] 已有实例运行在端口 ${PORT}，退出`);
        process.exit(0);
      }
    } catch { /* 端口占用但非 proxy */ }
    console.error(`[CDP Proxy] 端口 ${PORT} 已被占用`);
    process.exit(1);
  }

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[CDP Proxy] 运行在 http://localhost:${PORT}`);
    connect().catch(e => console.error('[CDP Proxy] 初始连接失败:', e.message, '（将在首次请求时重试）'));
  });
}

process.on('uncaughtException', (e) => {
  console.error('[CDP Proxy] 未捕获异常:', e.message);
});
process.on('unhandledRejection', (e) => {
  console.error('[CDP Proxy] 未处理拒绝:', e?.message || e);
});

main();
