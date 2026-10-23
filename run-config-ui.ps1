param(
    [Parameter(Mandatory = $true)][string]$Pink,
    [Parameter(Mandatory = $true)][string]$Project,
    [string]$Platforms = 'all',
    [ValidateSet('inspect', 'exercise', 'openpaas')][string]$Mode = 'inspect',
    [int]$Port = 9222,
    [int]$ConfigurationTimeoutSeconds = 120,
    [string]$ResultsRoot = (Join-Path $PSScriptRoot 'results')
)
$ErrorActionPreference = 'Stop'
$entry = Join-Path $PSScriptRoot 'tools/build-ui/dist/configuration-cli.js'
if (-not (Test-Path -LiteralPath $entry)) { throw '工具尚未编译，请先在 tools/build-ui 执行 npm run build。' }
$nodeCommand = Get-Command node.exe -ErrorAction Stop
$runnerArguments = @($entry, '--pink', $Pink, '--project', $Project, '--platforms', $Platforms, '--mode', $Mode, '--port', $Port, '--configuration-timeout', $ConfigurationTimeoutSeconds, '--results', $ResultsRoot)
& $nodeCommand.Source @runnerArguments
exit $LASTEXITCODE
