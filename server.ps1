# ==============================================================
#  Herramienta de Redes - Servidor HTTP local
#  Puerto: 8080  |  Ejecutar con: iniciar.bat
# ==============================================================

param(
    [int]$Port = 8080
)

$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) {
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

# Forzar UTF-8 para la salida de comandos externos
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# ── Iniciar listener ──────────────────────────────────────────
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")

try {
    $listener.Start()
} catch {
    Write-Host ""
    Write-Host " ERROR: No se pudo iniciar el servidor en el puerto $Port" -ForegroundColor Red
    Write-Host " Causa: $_" -ForegroundColor DarkRed
    Write-Host " Solución: Ejecuta este script como Administrador o cambia el puerto." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Presiona Enter para salir"
    exit 1
}

Write-Host ""
Write-Host " ╔══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host " ║   Herramienta de Redes - Activa      ║" -ForegroundColor Cyan
Write-Host " ║   http://localhost:$Port               ║" -ForegroundColor Cyan
Write-Host " ║   Presiona Ctrl+C para detener       ║" -ForegroundColor Cyan
Write-Host " ╚══════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

Start-Sleep -Milliseconds 400
Start-Process "http://localhost:$Port/"

# ── Helpers ───────────────────────────────────────────────────

function Parse-QueryString([string]$qs) {
    $result = @{}
    if ($qs.StartsWith("?")) { $qs = $qs.Substring(1) }
    foreach ($pair in $qs.Split("&")) {
        $parts = $pair.Split("=", 2)
        if ($parts.Length -eq 2) {
            $key   = [System.Uri]::UnescapeDataString($parts[0])
            $value = [System.Uri]::UnescapeDataString($parts[1].Replace("+", " "))
            $result[$key] = $value
        }
    }
    return $result
}

function Send-Response {
    param($Response, [string]$Content, [string]$ContentType = "text/plain; charset=utf-8", [int]$Status = 200)
    $Response.StatusCode = $Status
    $Response.ContentType = $ContentType
    $Response.Headers.Add("Cache-Control", "no-cache")
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Content)
    $Response.ContentLength64 = $bytes.Length
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Response.OutputStream.Close()
}

function Run-NetworkCommand {
    param([string]$Cmd, [string]$HostParam)

    switch ($Cmd) {
        "nslookup" {
            $timeout = 10
            $job = Start-Job -ScriptBlock {
                param($h)
                [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
                nslookup $h 2>&1
            } -ArgumentList $HostParam
        }
        "ping" {
            $timeout = 20
            $job = Start-Job -ScriptBlock {
                param($h)
                [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
                ping -n 4 $h 2>&1
            } -ArgumentList $HostParam
        }
        "tracert" {
            $timeout = 55
            $job = Start-Job -ScriptBlock {
                param($h)
                [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
                tracert -d -h 20 -w 900 $h 2>&1
            } -ArgumentList $HostParam
        }
        default {
            return @{ error = "Comando no válido." }
        }
    }

    $completed = Wait-Job $job -Timeout $timeout
    if ($completed) {
        $lines  = Receive-Job $job
        $output = ($lines | ForEach-Object { "$_" }) -join "`n"
    } else {
        Stop-Job $job
        $output = "[Timeout] El comando superó el límite de $timeout segundos."
    }
    Remove-Job $job -Force

    return @{ output = $output; command = $Cmd; host = $HostParam }
}

# ── Bucle principal ───────────────────────────────────────────
while ($listener.IsListening) {
    try {
        $ctx      = $listener.GetContext()
        $req      = $ctx.Request
        $res      = $ctx.Response
        $path     = $req.Url.LocalPath
        $query    = Parse-QueryString $req.Url.Query

        Write-Host " $(Get-Date -Format 'HH:mm:ss')  $($req.HttpMethod) $path" -ForegroundColor DarkGray

        # ── GET / → index.html ─────────────────────────────────
        if ($path -eq "/" -or $path -eq "/index.html") {
            $htmlFile = Join-Path $ScriptDir "index.html"
            if (Test-Path $htmlFile) {
                $content = Get-Content $htmlFile -Raw -Encoding UTF8
                Send-Response $res $content "text/html; charset=utf-8"
            } else {
                Send-Response $res "Error: index.html no encontrado en $ScriptDir" "text/plain" 404
            }
        }

        # ── GET /api/run?cmd=...&host=... ──────────────────────
        elseif ($path -eq "/api/run") {
            $hostParam = $query["host"]
            $cmdParam  = $query["cmd"]

            # Validar host: solo caracteres válidos para hostname/IP
            if (-not $hostParam -or $hostParam -notmatch '^[a-zA-Z0-9.\-]{1,253}$') {
                $json = @{ error = "Host inválido. Usa un nombre de dominio o dirección IP." } | ConvertTo-Json
                Send-Response $res $json "application/json; charset=utf-8" 400
                continue
            }

            # Validar comando permitido (whitelist)
            $allowedCmds = @("nslookup", "ping", "tracert")
            if ($cmdParam -notin $allowedCmds) {
                $json = @{ error = "Comando no permitido." } | ConvertTo-Json
                Send-Response $res $json "application/json; charset=utf-8" 400
                continue
            }

            Write-Host "         → $cmdParam $hostParam" -ForegroundColor Green

            $result = Run-NetworkCommand -Cmd $cmdParam -HostParam $hostParam
            $json   = $result | ConvertTo-Json -Compress
            Send-Response $res $json "application/json; charset=utf-8"
        }

        # ── 404 ────────────────────────────────────────────────
        else {
            Send-Response $res "404 - No encontrado" "text/plain" 404
        }

    } catch [System.Net.HttpListenerException] {
        break
    } catch {
        Write-Host " ERROR en solicitud: $_" -ForegroundColor Red
        try {
            $ctx.Response.StatusCode = 500
            $ctx.Response.OutputStream.Close()
        } catch {}
    }
}

$listener.Stop()
Write-Host ""
Write-Host " Servidor detenido." -ForegroundColor Yellow
