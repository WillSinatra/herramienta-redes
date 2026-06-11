'use strict';

const http = require('http');
const dns = require('dns').promises;
const net = require('net');
const { spawn } = require('child_process');
const { URL } = require('url');

const HOST = '127.0.0.1';
const PORT = Number(process.env.LG_PORT || 8787);
const MAX_BODY_BYTES = 8 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_OUTPUT_LINES = 800;
const TARGET_KEYS = ['target_ip', 'hostname', 'target'];

function applyCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, statusCode, payload) {
    applyCors(res);
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

function isValidHostname(hostname) {
    if (typeof hostname !== 'string') return false;
    if (hostname.length < 1 || hostname.length > 253) return false;
    if (!/^[A-Za-z0-9.-]+$/.test(hostname)) return false;

    const labels = hostname.split('.');
    if (labels.some(label => label.length < 1 || label.length > 63)) return false;
    if (labels.some(label => label.startsWith('-') || label.endsWith('-'))) return false;
    return true;
}

function normalizeAndValidateTarget(input) {
    const raw = typeof input === 'string' ? input.trim() : '';

    if (!raw) {
        return { ok: false, error: 'Debe indicar target_ip o hostname.' };
    }
    if (raw.length > 253) {
        return { ok: false, error: 'El objetivo excede la longitud permitida.' };
    }
    if (/\s/.test(raw)) {
        return { ok: false, error: 'El objetivo no puede contener espacios.' };
    }

    const ipVersion = net.isIP(raw);
    if (ipVersion === 4 || ipVersion === 6) {
        return { ok: true, value: raw, type: 'ip' };
    }

    if (!isValidHostname(raw)) {
        return { ok: false, error: 'Formato inválido. Use IP válida o hostname legítimo.' };
    }

    return { ok: true, value: raw.toLowerCase(), type: 'hostname' };
}

function getCommandPlan(kind, target) {
    if (kind === 'ping') {
        if (process.platform === 'win32') {
            return { command: 'ping', args: ['-n', '4', '-w', '1000', target], timeoutMs: 20000 };
        }
        return { command: 'ping', args: ['-c', '4', '-W', '1', target], timeoutMs: 20000 };
    }

    if (kind === 'traceroute') {
        if (process.platform === 'win32') {
            return { command: 'tracert', args: ['-d', '-h', '30', '-w', '900', target], timeoutMs: 60000 };
        }
        return { command: 'traceroute', args: ['-n', '-m', '30', '-w', '1', target], timeoutMs: 60000 };
    }

    throw new Error(`Tipo de comando no soportado: ${kind}`);
}

function toLines(stdout, stderr) {
    return `${stdout}\n${stderr}`
        .split(/\r?\n/)
        .map(line => line.trimEnd())
        .filter(Boolean)
        .slice(0, MAX_OUTPUT_LINES);
}

function runCommandSecure(command, args, timeoutMs) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const child = spawn(command, args, {
            shell: false,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let totalBytes = 0;
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            try { child.kill(); } catch (_) {}
        }, timeoutMs);

        const appendChunk = (dest, chunk) => {
            const text = chunk.toString('utf8');
            totalBytes += Buffer.byteLength(text, 'utf8');
            if (totalBytes > MAX_OUTPUT_BYTES) {
                timedOut = true;
                try { child.kill(); } catch (_) {}
                return dest;
            }
            return dest + text;
        };

        child.stdout.on('data', chunk => {
            stdout = appendChunk(stdout, chunk);
        });

        child.stderr.on('data', chunk => {
            stderr = appendChunk(stderr, chunk);
        });

        child.on('error', err => {
            clearTimeout(timer);
            reject(err);
        });

        child.on('close', exitCode => {
            clearTimeout(timer);
            const durationMs = Date.now() - startedAt;

            resolve({
                command,
                args,
                exitCode,
                durationMs,
                timedOut,
                stdout,
                stderr,
                lines: toLines(stdout, stderr),
            });
        });
    });
}

function parseCymruWhois(rawText) {
    const lines = rawText
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    if (lines.length < 2) return null;

    const columns = lines[1].split('|').map(part => part.trim());
    if (columns.length < 7) return null;

    return {
        source: 'cymru-whois',
        asn: columns[0] ? `AS${columns[0]}` : null,
        ip: columns[1] || null,
        bgpPrefix: columns[2] || null,
        countryCode: columns[3] || null,
        registry: columns[4] || null,
        allocated: columns[5] || null,
        asName: columns[6] || null,
        raw: rawText,
    };
}

function queryCymruWhois(ip, timeoutMs = 7000) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: 'whois.cymru.com', port: 43 });
        let data = '';
        let finished = false;

        const done = (err, result) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            try { socket.destroy(); } catch (_) {}
            if (err) reject(err);
            else resolve(result);
        };

        const timer = setTimeout(() => {
            done(new Error('Timeout consultando WHOIS público.'));
        }, timeoutMs);

        socket.on('connect', () => {
            socket.write(` -v ${ip}\n`);
        });

        socket.on('data', chunk => {
            data += chunk.toString('utf8');
        });

        socket.on('end', () => {
            done(null, data);
        });

        socket.on('error', err => {
            done(err);
        });
    });
}

async function fallbackDnsAsn(ip) {
    if (net.isIP(ip) !== 4) return null;
    const reversed = ip.split('.').reverse().join('.');
    const queryName = `${reversed}.origin.asn.cymru.com`;

    const txt = await dns.resolveTxt(queryName);
    if (!txt || !txt.length) return null;

    const flat = txt.map(parts => parts.join('')).join(' ');
    const fields = flat.split('|').map(part => part.trim());
    if (fields.length < 5) return null;

    return {
        source: 'dns-origin-asn',
        asn: fields[0] ? `AS${fields[0]}` : null,
        ip,
        bgpPrefix: fields[1] || null,
        countryCode: fields[2] || null,
        registry: fields[3] || null,
        allocated: fields[4] || null,
        asName: null,
        raw: flat,
    };
}

function mockBgpResult(target, ip, reason) {
    return {
        source: 'mock',
        warning: reason,
        asn: 'AS64512',
        ip,
        bgpPrefix: null,
        countryCode: null,
        registry: null,
        allocated: null,
        asName: 'UNAVAILABLE_IN_CURRENT_ENV',
        raw: null,
        simulated: {
            target,
            pathHint: ['AS64512', 'AS3356', 'AS15169'],
            status: 'Simulado por falta de acceso a fuentes BGP/WHOIS en tiempo real.',
        },
    };
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        let bytes = 0;

        req.on('data', chunk => {
            bytes += chunk.length;
            if (bytes > MAX_BODY_BYTES) {
                reject(new Error('Body demasiado grande.'));
                req.destroy();
                return;
            }
            raw += chunk.toString('utf8');
        });

        req.on('end', () => {
            if (!raw.trim()) {
                resolve({});
                return;
            }

            try {
                resolve(JSON.parse(raw));
            } catch (_) {
                reject(new Error('JSON inválido en el body.'));
            }
        });

        req.on('error', reject);
    });
}

function pickTargetFromObject(obj) {
    if (!obj || typeof obj !== 'object') return '';
    for (const key of TARGET_KEYS) {
        if (typeof obj[key] === 'string' && obj[key].trim()) {
            return obj[key];
        }
    }
    return '';
}

async function extractRequestedTarget(req, parsedUrl) {
    const queryTarget = pickTargetFromObject(Object.fromEntries(parsedUrl.searchParams.entries()));
    if (queryTarget) return queryTarget;

    if (req.method !== 'POST') return '';
    const body = await readJsonBody(req);
    return pickTargetFromObject(body);
}

async function resolveIp(target, targetType) {
    if (targetType === 'ip') return target;
    const lookup = await dns.lookup(target, { family: 0, all: false });
    return lookup.address;
}

async function handleDiagnostic(req, res, parsedUrl, kind) {
    const requestedTarget = await extractRequestedTarget(req, parsedUrl);
    const validated = normalizeAndValidateTarget(requestedTarget);

    if (!validated.ok) {
        sendJson(res, 400, { success: false, error: validated.error });
        return;
    }

    const plan = getCommandPlan(kind, validated.value);
    const result = await runCommandSecure(plan.command, plan.args, plan.timeoutMs);

    sendJson(res, 200, {
        success: true,
        endpoint: kind,
        target: {
            input: requestedTarget,
            normalized: validated.value,
            type: validated.type,
        },
        data: result,
        timestamp: new Date().toISOString(),
    });
}

async function handleBgp(req, res, parsedUrl) {
    const requestedTarget = await extractRequestedTarget(req, parsedUrl);
    const validated = normalizeAndValidateTarget(requestedTarget);

    if (!validated.ok) {
        sendJson(res, 400, { success: false, error: validated.error });
        return;
    }

    let ip;
    try {
        ip = await resolveIp(validated.value, validated.type);
    } catch (err) {
        sendJson(res, 502, {
            success: false,
            error: 'No se pudo resolver el hostname hacia una IP.',
            details: err.message,
        });
        return;
    }

    let bgpData = null;
    try {
        const whoisText = await queryCymruWhois(ip);
        bgpData = parseCymruWhois(whoisText);
    } catch (_) {
        bgpData = null;
    }

    if (!bgpData) {
        try {
            bgpData = await fallbackDnsAsn(ip);
        } catch (_) {
            bgpData = null;
        }
    }

    if (!bgpData) {
        bgpData = mockBgpResult(validated.value, ip, 'No fue posible obtener BGP/WHOIS en tiempo real.');
    }

    sendJson(res, 200, {
        success: true,
        endpoint: 'bgp',
        target: {
            input: requestedTarget,
            normalized: validated.value,
            type: validated.type,
            resolvedIp: ip,
        },
        data: bgpData,
        timestamp: new Date().toISOString(),
    });
}

const server = http.createServer(async (req, res) => {
    applyCors(res);

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    try {
        if (pathname === '/health') {
            sendJson(res, 200, {
                service: 'looking-glass-api',
                status: 'ok',
                uptimeSec: Math.round(process.uptime()),
                timestamp: new Date().toISOString(),
            });
            return;
        }

        if (pathname === '/api/looking-glass/ping') {
            await handleDiagnostic(req, res, parsedUrl, 'ping');
            return;
        }

        if (pathname === '/api/looking-glass/traceroute') {
            await handleDiagnostic(req, res, parsedUrl, 'traceroute');
            return;
        }

        if (pathname === '/api/looking-glass/bgp') {
            await handleBgp(req, res, parsedUrl);
            return;
        }

        sendJson(res, 404, {
            success: false,
            error: 'Ruta no encontrada.',
        });
    } catch (err) {
        sendJson(res, 500, {
            success: false,
            error: 'Error interno ejecutando diagnóstico.',
            details: err.message,
        });
    }
});

server.listen(PORT, HOST, () => {
    console.log(`[Looking Glass API] Escuchando en http://${HOST}:${PORT}`);
    console.log('[Looking Glass API] Endpoints:');
    console.log('  GET/POST /api/looking-glass/ping?target_ip=8.8.8.8');
    console.log('  GET/POST /api/looking-glass/traceroute?hostname=example.com');
    console.log('  GET/POST /api/looking-glass/bgp?target_ip=1.1.1.1');
});