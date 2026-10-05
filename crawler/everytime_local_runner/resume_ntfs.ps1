param(
    [Parameter(Mandatory=$true)][string]$PythonExe,
    [Parameter(Mandatory=$true)][string]$OutputRoot,
    [Parameter(Mandatory=$true)][string]$CampaignName,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$previousRoot = $env:EVERYTIME_LOCAL_OUTPUT_ROOT
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$env:EVERYTIME_LOCAL_OUTPUT_ROOT = (Resolve-Path -LiteralPath $OutputRoot).Path
$campaignRoot = Join-Path $env:EVERYTIME_LOCAL_OUTPUT_ROOT $CampaignName
Push-Location $repoRoot
try {
    if ($CheckOnly) {
        $summary = & $pythonExe -X utf8 -B -m crawler.everytime_local_runner.full_campaign summary --root $campaignRoot | ConvertFrom-Json
        $summary | Select-Object catalog_count,recorded,pending,states,reviews_saved_or_reused,unresolved_count,collection_complete | ConvertTo-Json -Depth 5
    } else {
        & node (Join-Path $PSScriptRoot 'full_runner.cjs') $pythonExe $campaignRoot
    }
    if ($LASTEXITCODE -ne 0) { throw 'Local runner did not finish normally' }
} finally {
    Pop-Location
    $env:EVERYTIME_LOCAL_OUTPUT_ROOT = $previousRoot
}
