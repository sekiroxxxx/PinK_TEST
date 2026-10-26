param(
    [string]$Pink,
    [string]$Project,
    [int]$Port = 9222,
    [int]$TimeoutSeconds = 600,
    [int]$QueueTimeoutSeconds = 1800,
    [int]$ConfigurationTimeoutSeconds = 120,
    [string]$ResultsRoot = (Join-Path $PSScriptRoot 'results'),
    [ValidateSet('existing', 'debug', 'release-a', 'release-b', 'release-c-local')][string]$Profile = 'existing',
    [string]$Platform = 'web-desktop',
    [string]$AgcServices = '',
    [ValidateSet('', 'existing-local-seven', 'debug-priority', 'release-a-priority', 'release-b-priority', 'release-c-local-priority', 'debug-additional', 'release-a-additional', 'debug-all', 'release-a-all')][string]$Suite = '',
    [ValidateSet('', 'four-groups', 'acceptance', 'local-options-nine', 'special-options-ten')][string]$Plan = '',
    [string]$Cases = '',
    [string]$Groups = '',
    [string]$Materials = '',
    [string]$CasesFile = '',
    [string]$StepsFile = '',
    [string]$CatalogFile = '',
    [string]$RunConfig = '',
    [string]$ExpectedPlan = '',
    [switch]$CheckPlan,
    [switch]$FieldCapabilities,
    [switch]$Preview,
    [string]$PreviewFile = '',
    [switch]$ListCases,
    [ValidateSet('skip', 'verify')][string]$Persistence = 'skip',
    [switch]$ApplyProfile,
    [string]$SceneUuid = '2e58824f-0bca-4f31-a495-1eceb60b610f'
)

$ErrorActionPreference = 'Stop'
$entry = Join-Path $PSScriptRoot 'tools/build-ui/dist/cli.js'
if (-not (Test-Path -LiteralPath $entry)) {
    throw '工具尚未准备好，请先在 tools/build-ui 执行 npm ci 和 npm run build。'
}
$nodeCommand = Get-Command node.exe -ErrorAction Stop
if ($StepsFile -or $CatalogFile) {
    if ($StepsFile -and $CatalogFile) { throw 'StepsFile 和 CatalogFile 只能选择一个。' }
    $stepsAllowed = @('StepsFile','CatalogFile','Materials','Pink','Project','Port','ConfigurationTimeoutSeconds','ResultsRoot','Preview','PreviewFile','ExpectedPlan','CheckPlan')
    if ($CatalogFile) { $stepsAllowed += @('Cases','Groups') }
    foreach ($key in $PSBoundParameters.Keys) { if ($key -notin $stepsAllowed) { throw "StepsFile/CatalogFile 不能与 $key 混用；步骤启动使用显式 Pink/Project。" } }
    if (-not $Pink -or -not $Project) { throw '步骤启动/预览必须提供 Pink 和 Project。' }
    $stepsEntry = Join-Path $PSScriptRoot 'tools/build-ui/dist/configuration-steps-cli.js'
    $stepsArguments = @($stepsEntry, '--pink', $Pink, '--project', $Project, '--port', $Port, '--configuration-timeout', $ConfigurationTimeoutSeconds, '--results', $ResultsRoot)
    if ($CatalogFile) {
        $stepsArguments += @('--catalog', $CatalogFile)
        if ($Cases) { $stepsArguments += @('--cases', $Cases) }
        if ($Groups) { $stepsArguments += @('--groups', $Groups) }
    } else { $stepsArguments += @('--file', $StepsFile) }
    if ($Materials) { $stepsArguments += @('--materials', $Materials) }
    if ($Preview) { $stepsArguments += '--preview' }
    elseif ($CheckPlan) { $stepsArguments += '--check-plan' }
    else { $stepsArguments += '--run' }
    if ($Preview -and $CheckPlan) { throw 'Preview 和 CheckPlan 不能同时使用。' }
    if ($PreviewFile) { if (-not $Preview) { throw 'PreviewFile 必须与 Preview 一起使用。' }; $stepsArguments += @('--output', $PreviewFile) }
    if ($ExpectedPlan) { $stepsArguments += @('--expected-plan', $ExpectedPlan) }
    & $nodeCommand.Source @stepsArguments
    exit $LASTEXITCODE
}
if ($FieldCapabilities) {
    & $nodeCommand.Source $entry --field-capabilities
    exit $LASTEXITCODE
}
if ($RunConfig -or $Preview -or $CheckPlan -or $ExpectedPlan) {
    if ($Plan -and $Plan -ne 'four-groups') { throw 'QA启动配置/预览只支持four-groups。' }
    if ($Suite -or $ApplyProfile -or $Profile -ne 'existing' -or $Platform -ne 'web-desktop' -or $Persistence -ne 'skip') { throw 'QA启动配置/预览不能混用旧Suite/Profile/Platform/Persistence。' }
    $qaArguments = @($entry, '--plan', 'four-groups')
    if ($RunConfig) { $qaArguments += @('--run-config', $RunConfig) }
    if ($Preview) { $qaArguments += '--preview' }
    if ($CheckPlan) { $qaArguments += '--check-plan' }
    if ($ExpectedPlan) { $qaArguments += @('--expected-plan', $ExpectedPlan) }
    if ($PreviewFile) { $qaArguments += @('--preview-file', $PreviewFile) }
    if ($Pink) { $qaArguments += @('--pink', $Pink) }
    if ($Project) { $qaArguments += @('--project', $Project) }
    if ($CasesFile) { $qaArguments += @('--cases-file', $CasesFile) }
    if ($Materials) { $qaArguments += @('--materials', $Materials) }
    if ($Groups) { $qaArguments += @('--groups', $Groups) }
    if ($Cases) { $qaArguments += @('--cases', $Cases) }
    if ($ListCases) { $qaArguments += '--list-cases' }
    if ($AgcServices) { $qaArguments += @('--agc-services', $AgcServices) }
    if ($PSBoundParameters.ContainsKey('Port')) { $qaArguments += @('--port', $Port) }
    if ($PSBoundParameters.ContainsKey('ResultsRoot')) { $qaArguments += @('--results', $ResultsRoot) }
    if ($PSBoundParameters.ContainsKey('TimeoutSeconds')) { $qaArguments += @('--timeout', $TimeoutSeconds) }
    if ($PSBoundParameters.ContainsKey('QueueTimeoutSeconds')) { $qaArguments += @('--queue-timeout', $QueueTimeoutSeconds) }
    if ($PSBoundParameters.ContainsKey('ConfigurationTimeoutSeconds')) { $qaArguments += @('--configuration-timeout', $ConfigurationTimeoutSeconds) }
    & $nodeCommand.Source @qaArguments
    exit $LASTEXITCODE
}
if ($PreviewFile) { throw 'PreviewFile 必须与 Preview 一起使用。' }
if ($CasesFile -and $Plan -ne 'four-groups') { throw 'CasesFile 只支持 four-groups，不能被旧入口忽略。' }
if (($Groups -or $Materials) -and $Plan -ne 'four-groups') { throw 'Groups/Materials仅支持four-groups。' }
if ($ListCases) {
    if (-not $Plan -or $Suite -or $ApplyProfile -or $Profile -ne 'existing' -or $Platform -ne 'web-desktop' -or $Persistence -ne 'skip') { throw 'ListCases仅支持独立Plan，不连接PinK。' }
    $previewArguments = @($entry, '--plan', $Plan, '--list-cases')
    if ($Cases) { $previewArguments += @('--cases', $Cases) }
    if ($Groups) { $previewArguments += @('--groups', $Groups) }
    if ($Materials) { $previewArguments += @('--materials', $Materials) }
    if ($CasesFile) { $previewArguments += @('--cases-file', $CasesFile) }
    if ($Project) { $previewArguments += @('--project', $Project) }
    & $nodeCommand.Source @previewArguments
    exit $LASTEXITCODE
}
if (-not $Pink -or -not $Project) { throw '执行时必须提供Pink和Project；离线预览使用-Plan acceptance -ListCases。' }
$runnerArguments = @($entry, '--pink', $Pink, '--project', $Project, '--port', $Port, '--timeout', $TimeoutSeconds, '--queue-timeout', $QueueTimeoutSeconds, '--configuration-timeout', $ConfigurationTimeoutSeconds, '--results', $ResultsRoot, '--platform', $Platform, '--persistence', $Persistence, '--scene-uuid', $SceneUuid)
if ($AgcServices) { $runnerArguments += @('--agc-services', $AgcServices) }
if ($ApplyProfile) { $runnerArguments += '--apply-profile' }
if ($Plan) {
    if ($Suite -or $ApplyProfile -or $Profile -ne 'existing' -or $Platform -ne 'web-desktop' -or $Persistence -ne 'skip') { throw 'Plan不能混用Suite/Profile/Platform/ApplyProfile/Persistence。' }
    $runnerArguments += @('--plan', $Plan)
    if ($Groups) { $runnerArguments += @('--groups', $Groups) }
    if ($Materials) { $runnerArguments += @('--materials', $Materials) }
    if ($Cases) { $runnerArguments += @('--cases', $Cases) }
    if ($CasesFile) { $runnerArguments += @('--cases-file', $CasesFile) }
}
elseif ($Suite) {
    $runnerArguments += @('--suite', $Suite)
    if ($Cases) {
        $runnerArguments += @('--cases', $Cases)
    }
}
elseif ($Cases) { throw 'Cases必须与Plan或Suite一起使用。' }
else { $runnerArguments += @('--profile', $Profile) }
& $nodeCommand.Source @runnerArguments
exit $LASTEXITCODE
