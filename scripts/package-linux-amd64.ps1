param(
    [Parameter(Mandatory = $false)]
    [ValidatePattern('^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$')]
    [string]$Version = '1.0.4',

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^http://[^/]+$')]
    [string]$PublicOrigin
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$releaseRoot = Join-Path $projectRoot 'release'
$releaseDir = Join-Path $releaseRoot ("digital-assets-$Version-linux-amd64")
$archiveName = "images-linux-amd64-$Version.tar"
$archivePath = Join-Path $releaseDir $archiveName

if (Test-Path -LiteralPath $releaseDir) {
    throw "Release directory already exists: $releaseDir. Choose another version or move it aside."
}

docker version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker is not available.' }
docker buildx version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker Buildx is not available.' }

New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

Push-Location $projectRoot
try {
    docker buildx build --platform linux/amd64 --file backend/Dockerfile --tag "digital-assets-backend:$Version" --load .
    if ($LASTEXITCODE -ne 0) { throw 'Backend AMD64 image build failed.' }

    docker buildx build --platform linux/amd64 --file frontend/Dockerfile --tag "digital-assets-frontend:$Version" --load .
    if ($LASTEXITCODE -ne 0) { throw 'Frontend AMD64 image build failed.' }

    docker pull --platform linux/amd64 postgres:17-alpine
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL AMD64 image pull failed.' }

    $images = @(
        "digital-assets-backend:$Version",
        "digital-assets-frontend:$Version",
        'postgres:17-alpine'
    )
    foreach ($image in $images) {
        $architecture = docker image inspect $image --format '{{.Os}}/{{.Architecture}}'
        if ($LASTEXITCODE -ne 0 -or $architecture.Trim() -ne 'linux/amd64') {
            throw "$image is not a linux/amd64 image (reported: $architecture)."
        }
    }

    docker image save --output $archivePath $images
    if ($LASTEXITCODE -ne 0) { throw 'Image archive export failed.' }

    Copy-Item -LiteralPath 'compose.production.yaml' -Destination $releaseDir
    $releaseDeployDir = New-Item -ItemType Directory -Path (Join-Path $releaseDir 'deploy')
    Copy-Item -LiteralPath 'deploy/deploy.sh' -Destination $releaseDeployDir
    Copy-Item -LiteralPath 'deploy/backup.sh' -Destination $releaseDeployDir
    Copy-Item -LiteralPath 'deploy/README.md' -Destination $releaseDeployDir

    $passwordBytes = New-Object byte[] 32
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $random.GetBytes($passwordBytes)
    }
    finally {
        $random.Dispose()
    }
    $databasePassword = -join ($passwordBytes | ForEach-Object { $_.ToString('x2') })
    $productionEnvironment = @(
        "IMAGE_VERSION=$Version"
        "POSTGRES_PASSWORD=$databasePassword"
        "DATABASE_URL=postgres://assets:$databasePassword@postgres:5432/assets?sslmode=disable"
        "ALLOWED_ORIGIN=$PublicOrigin"
        'COOKIE_SECURE=false'
        'BOOTSTRAP_ADMIN_USERNAME=admin'
        'HTTP_PORT=9009'
    )
    [System.IO.File]::WriteAllLines(
        (Join-Path $releaseDir '.env.production'),
        $productionEnvironment,
        [System.Text.UTF8Encoding]::new($false)
    )

}
finally {
    Pop-Location
}

Write-Host "AMD64 release created: $releaseDir"
Write-Host 'A random database password was written to .env.production in the release directory.'
Write-Host 'Copy this directory to the Kylin Linux server, then follow deploy/README.md.'
