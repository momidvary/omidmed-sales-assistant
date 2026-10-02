[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$agentDirectory = Join-Path $repositoryRoot "tools\holoo-sync-agent"
$agentPath = Join-Path $agentDirectory "Invoke-HolooSync.ps1"
$configPath = Join-Path $agentDirectory "config.example.json"
$readmePath = Join-Path $agentDirectory "README.fa.md"

foreach ($scriptPath in Get-ChildItem -LiteralPath $agentDirectory -Filter "*.ps1" -File) {
    $tokens = $null
    $parseErrors = $null
    [void][Management.Automation.Language.Parser]::ParseFile(
        $scriptPath.FullName,
        [ref]$tokens,
        [ref]$parseErrors
    )
    if ($parseErrors.Count -gt 0) {
        throw ("PowerShell syntax failed for {0}: {1}" -f $scriptPath.Name, $parseErrors[0].Message)
    }
}

$agentText = Get-Content -LiteralPath $agentPath -Raw -Encoding UTF8
if ($agentText -notmatch '\[int\]\$WaitSeconds\s*=\s*0') {
    throw "Enter-AgentMutex must expose a bounded wait parameter."
}
if ($agentText -notmatch 'WaitOne\(\[TimeSpan\]::FromSeconds\(\$WaitSeconds\)\)') {
    throw "Full sync modes must use a timed mutex wait."
}
if ($agentText -notmatch '\$Mode\s+-in\s+@\("initial",\s*"weekly_full",\s*"manual_full"\)') {
    throw "Timed mutex waiting must be limited to full sync modes."
}
if ($agentText -match '\[string\]\$ConfigPath\s*=\s*\(Join-Path\s+\$PSScriptRoot') {
    throw "ConfigPath must be initialized after the param block for Windows PowerShell 5.1."
}

$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]$config.sql.server -ne "lpc:.\TNC") {
    throw "config.example.json must use the local Shared Memory transport by default."
}
if ([int]$config.sync.fullSyncMutexWaitSeconds -ne 1800) {
    throw "config.example.json must default fullSyncMutexWaitSeconds to 1800."
}

$readme = Get-Content -LiteralPath $readmePath -Raw -Encoding UTF8
if ($readme -notmatch 'fullSyncMutexWaitSeconds') {
    throw "README.fa.md must document the full-sync mutex wait."
}

$tokens = $null
$parseErrors = $null
$agentAst = [Management.Automation.Language.Parser]::ParseFile(
    $agentPath,
    [ref]$tokens,
    [ref]$parseErrors
)
$mutexFunction = $agentAst.Find(
    {
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
            $node.Name -eq "Enter-AgentMutex"
    },
    $true
)
if ($null -eq $mutexFunction) {
    throw "Enter-AgentMutex was not found in the Agent script."
}

function Write-AgentLog {
    param([string]$Level, [string]$Message)
}

. ([scriptblock]::Create($mutexFunction.Extent.Text))
$testMutexName = "Local\OmidMed.HolooSyncAgent.Test.{0}.{1}" -f $PID, [Guid]::NewGuid().ToString("N")
$holderJob = Start-Job -ScriptBlock {
    param($Name)
    $created = $false
    $mutex = New-Object Threading.Mutex($false, $Name, [ref]$created)
    try {
        [void]$mutex.WaitOne()
        Write-Output "ACQUIRED"
        Start-Sleep -Seconds 2
        $mutex.ReleaseMutex()
    }
    finally {
        $mutex.Dispose()
    }
} -ArgumentList $testMutexName

$leasedMutex = $null
try {
    $holderReady = $false
    $readyDeadline = [DateTime]::UtcNow.AddSeconds(10)
    while (-not $holderReady -and [DateTime]::UtcNow -lt $readyDeadline) {
        $holderReady = @(Receive-Job -Job $holderJob -Keep) -contains "ACQUIRED"
        if (-not $holderReady) {
            Start-Sleep -Milliseconds 100
        }
    }
    if (-not $holderReady) {
        throw "The mutex holder test process did not start in time."
    }

    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    $leasedMutex = Enter-AgentMutex -WaitSeconds 5 -MutexName $testMutexName
    $stopwatch.Stop()
    if ($stopwatch.ElapsedMilliseconds -lt 500 -or $stopwatch.ElapsedMilliseconds -ge 5000) {
        throw ("Timed mutex wait duration was unexpected: {0} ms." -f $stopwatch.ElapsedMilliseconds)
    }
}
finally {
    if ($null -ne $leasedMutex) {
        try {
            $leasedMutex.ReleaseMutex()
        }
        finally {
            $leasedMutex.Dispose()
        }
    }
    Stop-Job -Job $holderJob -ErrorAction SilentlyContinue
    Remove-Job -Job $holderJob -Force -ErrorAction SilentlyContinue
}

Write-Host "Holoo Sync Agent syntax, configuration, and mutex behavior tests passed."
