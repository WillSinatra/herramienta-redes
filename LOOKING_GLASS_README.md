# Looking Glass API (Modulo Independiente)

Este modulo agrega una API REST de diagnostico de red sin modificar archivos existentes del proyecto.

## 1) Como levantar el servicio backend aislado

Requisitos:
- Node.js 18 o superior
- Sistema operativo con utilidades de red disponibles (en Windows: ping y tracert)

Ejecucion:
1. Abrir terminal en la carpeta del proyecto.
2. Ejecutar:

   node looking_glass_api.js

3. Verificar salud del servicio:

   http://127.0.0.1:8787/health

Puerto opcional:
- Se puede cambiar con variable de entorno:

  set LG_PORT=9090
  node looking_glass_api.js

## 2) Endpoints disponibles

Base URL por defecto:
- http://127.0.0.1:8787

Rutas:
- GET o POST /api/looking-glass/ping
- GET o POST /api/looking-glass/traceroute
- GET o POST /api/looking-glass/bgp

Parametros aceptados (query o JSON body):
- target_ip: string (IP v4/v6)
- hostname: string (dominio/host valido)
- target: string (alias opcional)

Ejemplos por query string:
- /api/looking-glass/ping?target_ip=8.8.8.8
- /api/looking-glass/traceroute?hostname=example.com
- /api/looking-glass/bgp?target_ip=1.1.1.1

Ejemplo por JSON body (POST):

{
  "hostname": "example.com"
}

## 3) Estructura exacta de respuestas JSON

### 3.1 Respuesta de exito: Ping / Traceroute

{
  "success": true,
  "endpoint": "ping",
  "target": {
    "input": "8.8.8.8",
    "normalized": "8.8.8.8",
    "type": "ip"
  },
  "data": {
    "command": "ping",
    "args": ["-n", "4", "-w", "1000", "8.8.8.8"],
    "exitCode": 0,
    "durationMs": 3211,
    "timedOut": false,
    "stdout": "...salida completa...",
    "stderr": "",
    "lines": [
      "Haciendo ping a 8.8.8.8...",
      "Respuesta desde 8.8.8.8..."
    ]
  },
  "timestamp": "2026-06-11T12:00:00.000Z"
}

### 3.2 Respuesta de exito: BGP / Whois

{
  "success": true,
  "endpoint": "bgp",
  "target": {
    "input": "1.1.1.1",
    "normalized": "1.1.1.1",
    "type": "ip",
    "resolvedIp": "1.1.1.1"
  },
  "data": {
    "source": "cymru-whois",
    "asn": "AS13335",
    "ip": "1.1.1.1",
    "bgpPrefix": "1.1.1.0/24",
    "countryCode": "AU",
    "registry": "apnic",
    "allocated": "2011-08-11",
    "asName": "CLOUDFLARENET - Cloudflare, Inc.",
    "raw": "...respuesta whois..."
  },
  "timestamp": "2026-06-11T12:00:00.000Z"
}

Si no hay acceso a fuentes BGP en tiempo real, la API responde un objeto estructurado con source="mock" y datos simulados de referencia.

### 3.3 Respuesta de error (entrada invalida)

{
  "success": false,
  "error": "Formato invalido. Use IP valida o hostname legitimo."
}

## 4) Seguridad implementada (Command Injection)

- Validacion estricta de entrada:
  - Solo IP valida (IPv4/IPv6) o hostname legitimo.
  - Sin espacios ni caracteres fuera de [A-Za-z0-9.-] para hostnames.
- Ejecucion de comandos con spawn y shell=false (sin interpolacion de shell).
- Limites de tamano de body y salida para evitar abuso de recursos.
- Timeouts por comando para evitar procesos colgados.

## 5) Ejemplo de integracion futura en frontend (fetch)

### Ping

async function runPing(targetIp) {
  const url = `http://127.0.0.1:8787/api/looking-glass/ping?target_ip=${encodeURIComponent(targetIp)}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

### Traceroute

async function runTraceroute(hostname) {
  const res = await fetch('http://127.0.0.1:8787/api/looking-glass/traceroute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostname })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

### BGP / Whois

async function runBgp(targetIp) {
  const res = await fetch('http://127.0.0.1:8787/api/looking-glass/bgp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_ip: targetIp })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

## 6) Nota de acoplamiento

Este modulo es no intrusivo: funciona como servicio paralelo y no requiere modificar index.html, server.js ni scripts existentes. Los equipos frontend pueden consumir la API cuando decidan integrarla.