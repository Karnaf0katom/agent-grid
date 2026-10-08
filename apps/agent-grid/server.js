#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karnaf Katom.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createDemoAdapter } from './adapters/demo.js';
import { AdapterError, createTmuxAdapter, validatePrompt } from './adapters/tmux.js';
import { normalizeSessions } from '../../packages/agent-grid/src/index.js';

const PUBLIC = new URL('./public/', import.meta.url);
const SDK = new URL('../../packages/agent-grid/src/', import.meta.url);
const staticFiles = new Map([
  ['/', [new URL('index.html', PUBLIC), 'text/html; charset=utf-8']],
  ['/main.js', [new URL('main.js', PUBLIC), 'text/javascript; charset=utf-8']],
  ['/app.css', [new URL('app.css', PUBLIC), 'text/css; charset=utf-8']],
  ...['index.js', 'adapters.js', 'layout.js', 'views.js', 'element.js', 'styles.js'].map(name => [`/sdk/${name}`, [new URL(name, SDK), 'text/javascript; charset=utf-8']]),
]);

function readJson(request) {
  return new Promise((resolveBody, reject) => {
    let bytes = 0;
    const chunks = [];
    let rejected = false;
    request.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 20000) {
        if (!rejected) { rejected = true; reject(new AdapterError('Request body is too large.', 413)); }
        return;
      }
      if (!rejected) chunks.push(chunk);
    });
    request.on('end', () => {
      if (rejected) return;
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new AdapterError('Send a valid JSON object.')); }
    });
    request.on('error', () => reject(new AdapterError('The request was interrupted.')));
  });
}

export function createGridServer({ mode = 'demo', readOnly = mode !== 'demo', adapter, socketName, sessionPrefix = '' } = {}) {
  if (!['demo', 'tmux'].includes(mode)) throw new AdapterError('Choose demo or tmux mode.');
  const host = adapter || (mode === 'tmux' ? createTmuxAdapter({ allowInput: !readOnly, socketName, sessionPrefix }) : createDemoAdapter({ readOnly }));
  const json = (response, status, body) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const port = server.address()?.port;
      const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
      if (!origins.has(`http://${request.headers.host}`)) throw new AdapterError('Untrusted Host header.', 403);
      if (request.headers.origin && !origins.has(request.headers.origin)) throw new AdapterError('Cross-origin access is disabled.', 403);
      const url = new URL(request.url, `http://127.0.0.1:${port}`);
      if (url.pathname.startsWith('/api/') && request.headers['sec-fetch-site'] === 'cross-site') throw new AdapterError('Cross-site access is disabled.', 403);
      if (request.method === 'GET' && url.pathname === '/api/config') {
        return json(response, 200, { mode, readOnly, output: 'snapshot', version: '0.2.1' });
      }
      if (request.method === 'GET' && url.pathname === '/api/sessions') {
        const sessions = normalizeSessions(await host.listSessions());
        if (readOnly) for (const session of sessions) session.capabilities = { send: false, interrupt: false, open: session.capabilities.open };
        return json(response, 200, { sessions });
      }
      const match = /^\/api\/sessions\/([^/]+)\/(output|input|actions)$/.exec(url.pathname);
      if (match) {
        let id;
        try { id = decodeURIComponent(match[1]); } catch { throw new AdapterError('Invalid session id.'); }
        const route = match[2];
        if (route === 'output' && request.method === 'GET') return json(response, 200, await host.readOutput(id));
        if (route !== 'output' && request.method === 'POST') {
          if (readOnly) throw new AdapterError('This host is read-only. Start tmux mode with --allow-input to permit manual input.', 403);
          if (request.headers['x-agent-grid'] !== '1' || request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new AdapterError('Use a same-origin JSON request with X-Agent-Grid: 1.', 403);
          const body = await readJson(request);
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AdapterError('Send a JSON object.');
          const session = (await host.listSessions()).find(item => item.id === id);
          if (!session) throw new AdapterError('Session no longer exists.', 404);
          if (route === 'input') {
            if (session.capabilities?.send !== true) throw new AdapterError('The host does not permit input for this session.', 403);
            return json(response, 200, await host.sendPrompt(id, validatePrompt(body.text)));
          }
          if (body.action !== 'interrupt') throw new AdapterError('This host only supports the interrupt action.');
          if (session.capabilities?.interrupt !== true) throw new AdapterError('The host does not permit interrupt for this session.', 403);
          return json(response, 200, await host.performAction(id, body.action));
        }
        throw new AdapterError('Method not allowed.', 405);
      }
      if (['GET', 'HEAD'].includes(request.method) && staticFiles.has(url.pathname)) {
        const [file, type] = staticFiles.get(url.pathname);
        const content = await readFile(file);
        response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
        response.end(request.method === 'HEAD' ? undefined : content);
        return;
      }
      throw new AdapterError('Not found.', 404);
    } catch (error) {
      if (!response.headersSent) json(response, error.status || 500, { error: error.status ? error.message : 'The host could not complete this request.' });
      else response.end();
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  return server;
}

export function parseOptions(args) {
  const options = { mode: 'demo', readOnly: false, port: 4173 };
  let allowInput = false, forceReadOnly = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--tmux') options.mode = 'tmux';
    else if (arg === '--read-only') forceReadOnly = true;
    else if (arg === '--allow-input') allowInput = true;
    else if (['--port', '--socket-name', '--session-prefix'].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new AdapterError(`Missing value for ${arg}.`);
      if (arg === '--port') {
        if (!/^\d+$/.test(value) || Number(value) > 65535) throw new AdapterError('Port must be an integer from 0 to 65535.');
        options.port = Number(value);
      } else if (arg === '--socket-name') options.socketName = value;
      else options.sessionPrefix = value;
    } else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new AdapterError(`Unknown option: ${arg}`);
  }
  if (allowInput && forceReadOnly) throw new AdapterError('Choose either --read-only or --allow-input.');
  options.readOnly = forceReadOnly || (options.mode === 'tmux' && !allowInput);
  return options;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) {
      console.log('Agent Grid\n\nnode apps/agent-grid/server.js [--tmux] [--allow-input | --read-only]\n  --port N                 Port (default 4173; loopback only)\n  --socket-name NAME       Select a tmux -L socket\n  --session-prefix PREFIX  Show only matching tmux sessions\n\nThe default is a simulated demo. tmux mode is read-only unless --allow-input is explicit.');
    } else {
      const server = createGridServer(options);
      server.on('error', error => { console.error(`Agent Grid: ${error.message}`); process.exitCode = 1; });
      server.listen(options.port, '127.0.0.1', () => {
        console.log(`Agent Grid ${options.mode}${options.readOnly ? ' (read-only)' : ''}: http://127.0.0.1:${server.address().port}`);
      });
      const stop = () => { server.close(); server.closeAllConnections(); };
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
    }
  } catch (error) { console.error(`Agent Grid: ${error.message}`); process.exitCode = 1; }
}
