$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $projectRoot '.env'
if (!(Test-Path -LiteralPath $envFile)) { throw 'Copy .env.example to .env and set POSTGRES_PASSWORD first.' }
$passwordLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^POSTGRES_PASSWORD=' } | Select-Object -First 1
if (!$passwordLine) { throw 'POSTGRES_PASSWORD is required in .env' }
$dbPassword = $passwordLine.Substring('POSTGRES_PASSWORD='.Length)
if (!$dbPassword -or $dbPassword -eq 'replace-with-local-password') { throw 'Set a local database password before starting.' }
$env:DATABASE_URL = 'postgres://assets:' + [Uri]::EscapeDataString($dbPassword) + '@127.0.0.1:15432/assets?sslmode=disable'
$adminLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^BOOTSTRAP_ADMIN_USERNAME=' } | Select-Object -First 1
$env:BOOTSTRAP_ADMIN_USERNAME = if ($adminLine) { $adminLine.Substring('BOOTSTRAP_ADMIN_USERNAME='.Length).Trim() } else { '' }
Push-Location (Join-Path $projectRoot 'backend')
try { go run . -f etc/asset-api.yaml } finally { Pop-Location }
