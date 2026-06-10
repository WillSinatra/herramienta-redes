'use strict';

const http = require('http');
const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT    = 8080;
const HOST_RE = /^[a-zA-Z0-9.\-]{1,253}$/;
const ALLOWED = new Set(['nslookup', 'ping', 'tracert']);

// Build safe cmd.exe command strings (host is already whitelist-validated)
function buildCmd(cmd, host) {
    const prefix = 'chcp 65001 >nul 2>&1 & ';
    switch (cmd) {
        case 'nslookup': return `${prefix}nslookup ${host}`;
        case 'ping':     return `${prefix}ping -n 4 ${host}`;
        case 'tracert':  return `${prefix}tracert -d -h 20 -w 900 ${host}`;
    }
}

function getMaxMs(cmd) {
    switch (cmd) {
        case 'nslookup': return 10000;
        case 'ping': return 20000;
        case 'tracert': return 55000;
        default: return 30000;
    }
}

const server = http.createServer((req, res) => {
    const parsed   = url.parse(req.url, true);
    const pathname = parsed.pathname;
    const query    = parsed.query;

    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // ── Serve index.html ──────────────────────────────────────
    if (pathname === '/' || pathname === '/index.html') {
        const file = path.join(__dirname, 'index.html');
        fs.readFile(file, (err, data) => {
            if (err) { res.writeHead(404); res.end('index.html not found'); return; }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
        });
        return;
    }

    // ── SSE streaming endpoint ────────────────────────────────
    if (pathname === '/api/stream') {
        const host = (query.host || '').trim();
        const cmd  = (query.cmd  || '').trim();

        if (!host || !HOST_RE.test(host)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Host inválido' }));
            return;
        }
        if (!ALLOWED.has(cmd)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Comando no permitido' }));
            return;
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Connection':   'keep-alive',
        });
        res.flushHeaders();

        const emit = (type, data) => {
            try { res.write(`data: ${JSON.stringify({ type, data })}\n\n`); } catch (_) {}
        };

        const cmdLine = buildCmd(cmd, host);
        const proc = spawn('cmd.exe', ['/c', cmdLine], { windowsHide: true });
        let closed = false;
        const maxTimer = setTimeout(() => {
            if (closed) return;
            emit('line', `[Timeout] ${cmd} superó el tiempo límite y fue detenido.`);
            try { proc.kill(); } catch (_) {}
        }, getMaxMs(cmd));

        const onData = (chunk) => {
            const text = chunk.toString('utf8');
            text.split(/\r?\n/).forEach(line => {
                const clean = line.replace(/\r$/, '');
                if (clean) emit('line', clean);
            });
        };

        proc.stdout.on('data', onData);
        proc.stderr.on('data', onData);

        proc.on('close', code => {
            if (closed) return;
            closed = true;
            clearTimeout(maxTimer);
            emit('done', { exitCode: code });
            try { res.end(); } catch (_) {}
        });

        proc.on('error', err => {
            if (closed) return;
            closed = true;
            clearTimeout(maxTimer);
            emit('error', err.message);
            try { res.end(); } catch (_) {}
        });

        req.on('close', () => {
            clearTimeout(maxTimer);
            try { proc.kill(); } catch (_) {}
        });

        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
    const addr = `http://localhost:${PORT}/`;
    console.log('\n  ╔══════════════════════════════════════╗');
    console.log(`  ║  Herramienta de Redes activa         ║`);
    console.log(`  ║  → ${addr.padEnd(33)}║`);
    console.log('  ║  Ctrl+C para detener                 ║');
    console.log('  ╚══════════════════════════════════════╝\n');
    const { exec } = require('child_process');
    exec(`start ${addr}`);
});
