$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$line = Get-Content -LiteralPath (Join-Path $projectRoot '.env') | Where-Object { $_ -match '^POSTGRES_PASSWORD=' } | Select-Object -First 1
if (!$line) { throw 'POSTGRES_PASSWORD is required' }
$env:DATABASE_URL = 'postgres://assets:' + [Uri]::EscapeDataString($line.Substring('POSTGRES_PASSWORD='.Length)) + '@127.0.0.1:15432/assets?sslmode=disable'
Push-Location (Join-Path $projectRoot 'backend')
try { go run ./cmd/migrate; if ($LASTEXITCODE -ne 0) { throw 'Migration failed' } } finally { Pop-Location }
