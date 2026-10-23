param(
    [Parameter(Mandatory = $true)][string]$Pink,
    [Parameter(Mandatory = $true)][string]$Project,
    [int]$Port = 9222,
    [string]$SuccessResult = (Join-Path $PSScriptRoot 'results/2026-10-16T12-34-21-975Z/result.json'),
    [string]$FailureResult = (Join-Path $PSScriptRoot 'results/2026-10-17T03-38-20-904Z/result.json'),
    [string]$SuccessPlatform = 'web-desktop',
    [string]$FailurePlatform = 'taobao-mini-game',
    [string]$ResultsRoot = (Join-Path $PSScriptRoot 'results')
)

$ErrorActionPreference = 'Stop'
$entry = Join-Path $PSScriptRoot 'tools/build-ui/dist/history-cli.js'
if (-not (Test-Path -LiteralPath $entry)) {
    throw '工具尚未编译，请先在 tools/build-ui 执行 npm run build。'
}
$nodeCommand = Get-Command node.exe -ErrorAction Stop
$runnerArguments = @($entry, '--pink', $Pink, '--project', $Project, '--port', $Port, '--success-result', $SuccessResult, '--failure-result', $FailureResult, '--success-platform', $SuccessPlatform, '--failure-platform', $FailurePlatform, '--results', $ResultsRoot)
& $nodeCommand.Source @runnerArguments
exit $LASTEXITCODE
