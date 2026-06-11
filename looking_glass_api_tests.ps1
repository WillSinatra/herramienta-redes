param(
    [string]$BaseUrl = 'http://127.0.0.1:8787'
)

$ErrorActionPreference = 'Stop'

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw "ASSERT FAILED: $Message"
    }
}

function Run-Test {
    param(
        [string]$Name,
        [ScriptBlock]$Body
    )

    try {
        & $Body
        Write-Host "[PASS] $Name" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "[FAIL] $Name" -ForegroundColor Red
        Write-Host "       $($_.Exception.Message)" -ForegroundColor DarkRed
        return $false
    }
}

$results = @()

$results += Run-Test -Name 'Health endpoint responde OK' -Body {
    $resp = Invoke-RestMethod -Uri "$BaseUrl/health" -Method GET
    Assert-True ($resp.status -eq 'ok') 'health.status debe ser ok'
}

$results += Run-Test -Name 'Ping endpoint responde exito' -Body {
    $resp = Invoke-RestMethod -Uri "$BaseUrl/api/looking-glass/ping?target_ip=127.0.0.1" -Method GET
    Assert-True ($resp.success -eq $true) 'success debe ser true'
    Assert-True ($resp.endpoint -eq 'ping') 'endpoint debe ser ping'
    Assert-True ($null -ne $resp.data.exitCode) 'exitCode no debe ser null'
}

$results += Run-Test -Name 'Traceroute endpoint responde exito' -Body {
    $resp = Invoke-RestMethod -Uri "$BaseUrl/api/looking-glass/traceroute?target_ip=127.0.0.1" -Method GET
    Assert-True ($resp.success -eq $true) 'success debe ser true'
    Assert-True ($resp.endpoint -eq 'traceroute') 'endpoint debe ser traceroute'
    Assert-True ($null -ne $resp.data.lines) 'lines no debe ser null'
}

$results += Run-Test -Name 'BGP endpoint responde exito' -Body {
    $resp = Invoke-RestMethod -Uri "$BaseUrl/api/looking-glass/bgp?target_ip=1.1.1.1" -Method GET
    Assert-True ($resp.success -eq $true) 'success debe ser true'
    Assert-True ($resp.endpoint -eq 'bgp') 'endpoint debe ser bgp'
    Assert-True ([string]::IsNullOrWhiteSpace($resp.data.asn) -eq $false) 'asn no debe estar vacio'
}

$results += Run-Test -Name 'Input invalido devuelve error' -Body {
    try {
        Invoke-RestMethod -Uri "$BaseUrl/api/looking-glass/ping?target_ip=8.8.8.8%20%26%26%20whoami" -Method GET
        throw 'Se esperaba error HTTP 400 para input invalido.'
    }
    catch {
        $msg = $_.Exception.Message
        Assert-True ($msg -match '400') 'debe devolver HTTP 400'
    }
}

$passed = ($results | Where-Object { $_ -eq $true }).Count
$total = $results.Count

Write-Host "`nResumen: $passed/$total pruebas OK"

if ($passed -ne $total) {
    exit 1
}

exit 0