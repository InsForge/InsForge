param(
    [switch]$NoBrowser,
    [switch]$Foreground,
    [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$dashboardUrl = 'http://localhost:7131'

function Assert-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is not installed or not available on PATH."
    }
}

Push-Location $repoRoot

try {
    Assert-Command 'docker'

    if (-not (Test-Path '.env')) {
        Copy-Item '.env.example' '.env'
        Write-Host 'Created .env from .env.example'
    }

    & docker info | Out-Null

    $composeArgs = @('compose', 'up', '--build')
    if (-not $Foreground) {
        $composeArgs += '-d'
    }

    Write-Host 'Starting InsForge locally with Docker Compose...'
    & docker @composeArgs

    if ($LASTEXITCODE -ne 0) {
        throw "docker compose exited with code $LASTEXITCODE"
    }

    if ($Foreground) {
        return
    }

    Write-Host "Waiting for dashboard at $dashboardUrl ..."
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 5

        try {
            $response = Invoke-WebRequest -Uri $dashboardUrl -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                Write-Host "InsForge is reachable at $dashboardUrl"
                Write-Host 'API is available at http://localhost:7130/api'
                Write-Host 'Auth UI is available at http://localhost:7132'
                Write-Host 'Use "docker compose down" to stop the stack.'

                if (-not $NoBrowser) {
                    Start-Process $dashboardUrl
                }

                return
            }
        } catch {
        }
    }

    Write-Warning "The Docker stack started, but $dashboardUrl did not respond within $TimeoutSeconds seconds."
    Write-Warning 'Check "docker compose ps" and "docker compose logs -f insforge".'
} finally {
    Pop-Location
}
