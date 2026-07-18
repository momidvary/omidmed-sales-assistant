[CmdletBinding()]
param(
    [string]$InstallDirectory = (Join-Path $env:ProgramData "OmidMed\HolooSyncAgent"),

    [string]$ConfigTemplate = (Join-Path $PSScriptRoot "config.example.json"),

    [Security.SecureString]$AgentSecret,

    [switch]$Force
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$IncrementalTaskName = "OmidMed Holoo Incremental Sync"
$WeeklyTaskName = "OmidMed Holoo Weekly Full Sync"

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-SecureStringEqual {
    param(
        [Security.SecureString]$First,
        [Security.SecureString]$Second
    )

    $firstPointer = [IntPtr]::Zero
    $secondPointer = [IntPtr]::Zero
    try {
        $firstPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($First)
        $secondPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Second)
        $firstText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($firstPointer)
        $secondText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secondPointer)
        return $firstText -ceq $secondText
    }
    finally {
        $firstText = $null
        $secondText = $null
        if ($firstPointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($firstPointer)
        }
        if ($secondPointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secondPointer)
        }
    }
}

function Set-PrivateFileAcl {
    param(
        [string]$Path,
        [Security.Principal.SecurityIdentifier]$OwnerSid
    )

    $systemSid = New-Object Security.Principal.SecurityIdentifier("S-1-5-18")
    $administratorsSid = New-Object Security.Principal.SecurityIdentifier("S-1-5-32-544")
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetOwner($OwnerSid)
    $acl.SetAccessRuleProtection($true, $false)

    foreach ($sid in @($OwnerSid, $systemSid, $administratorsSid)) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule(
            $sid,
            [Security.AccessControl.FileSystemRights]::FullControl,
            [Security.AccessControl.AccessControlType]::Allow
        )
        [void]$acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Set-PrivateDirectoryAcl {
    param(
        [string]$Path,
        [Security.Principal.SecurityIdentifier]$OwnerSid
    )

    $systemSid = New-Object Security.Principal.SecurityIdentifier("S-1-5-18")
    $administratorsSid = New-Object Security.Principal.SecurityIdentifier("S-1-5-32-544")
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($OwnerSid)
    $acl.SetAccessRuleProtection($true, $false)

    foreach ($sid in @($OwnerSid, $systemSid, $administratorsSid)) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule(
            $sid,
            [Security.AccessControl.FileSystemRights]::FullControl,
            [Security.AccessControl.InheritanceFlags]"ContainerInherit, ObjectInherit",
            [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow
        )
        [void]$acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

if (-not (Test-IsAdministrator)) {
    throw "Administrator approval is required. Reopen Windows PowerShell with Run as administrator and run this installer again."
}

$sourceFiles = @(
    "Invoke-HolooSync.ps1",
    "Install-HolooSyncAgent.ps1",
    "Uninstall-HolooSyncAgent.ps1",
    "Test-HolooSyncConnection.ps1",
    "config.example.json",
    "README.fa.md"
)

foreach ($sourceFile in $sourceFiles) {
    $sourcePath = Join-Path $PSScriptRoot $sourceFile
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Required installer source file is missing: $sourcePath"
    }
}
if (-not (Test-Path -LiteralPath $ConfigTemplate -PathType Leaf)) {
    throw "Config template was not found: $ConfigTemplate"
}

$installPath = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($InstallDirectory))
$dataPath = Join-Path $installPath "data"
$logPath = Join-Path $dataPath "logs"
$configPath = Join-Path $installPath "config.json"
$secretPath = Join-Path $dataPath "agent-secret.dpapi"

foreach ($directory in @($installPath, $dataPath, $logPath)) {
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$ownerSid = $identity.User
$taskUser = $identity.Name
Set-PrivateDirectoryAcl -Path $dataPath -OwnerSid $ownerSid

foreach ($sourceFile in $sourceFiles) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $sourceFile) -Destination (Join-Path $installPath $sourceFile) -Force
}

if (-not (Test-Path -LiteralPath $configPath -PathType Leaf) -or $Force) {
    $config = Get-Content -LiteralPath $ConfigTemplate -Raw -Encoding UTF8 | ConvertFrom-Json
    $config.storage.dataDirectory = $dataPath
    $config.storage.stateFile = "state.json"
    $config.storage.logDirectory = "logs"
    $config.api.secretFile = "agent-secret.dpapi"
    $config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $configPath -Encoding UTF8
}

$mustWriteSecret = $null -ne $AgentSecret -or -not (Test-Path -LiteralPath $secretPath -PathType Leaf) -or $Force
if ($mustWriteSecret) {
    if ($null -eq $AgentSecret) {
        $AgentSecret = Read-Host "Enter HOLO_SYNC_AGENT_SECRET" -AsSecureString
        $confirmation = Read-Host "Enter HOLO_SYNC_AGENT_SECRET again" -AsSecureString
        if (-not (Test-SecureStringEqual -First $AgentSecret -Second $confirmation)) {
            throw "Secret confirmation did not match. No scheduled tasks were created."
        }
    }

    $AgentSecret | ConvertFrom-SecureString | Set-Content -LiteralPath $secretPath -Encoding UTF8
    Set-PrivateFileAcl -Path $secretPath -OwnerSid $ownerSid
}

$testScript = Join-Path $installPath "Test-HolooSyncConnection.ps1"
& $testScript -ConfigPath $configPath -TestApi

Import-Module ScheduledTasks -ErrorAction Stop
$powerShellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$agentScript = Join-Path $installPath "Invoke-HolooSync.ps1"
$incrementalArguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Mode incremental -ConfigPath "{1}"' -f $agentScript, $configPath
$weeklyArguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Mode weekly_full -ConfigPath "{1}"' -f $agentScript, $configPath

$incrementalAction = New-ScheduledTaskAction -Execute $powerShellPath -Argument $incrementalArguments -WorkingDirectory $installPath
$weeklyAction = New-ScheduledTaskAction -Execute $powerShellPath -Argument $weeklyArguments -WorkingDirectory $installPath
$incrementalStart = (Get-Date).AddMinutes(5)
$incrementalTrigger = New-ScheduledTaskTrigger -Once -At $incrementalStart -RepetitionInterval (New-TimeSpan -Hours 2)
$weeklyTrigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Sunday -At "03:00"
# The ScheduledTasks cmdlet calls Task Scheduler's InteractiveToken logon type "Interactive".
$principal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName $IncrementalTaskName -Action $incrementalAction -Trigger $incrementalTrigger -Principal $principal -Settings $settings -Description "OmidMed SELECT-only Holoo incremental sync every two hours" -Force | Out-Null
Register-ScheduledTask -TaskName $WeeklyTaskName -Action $weeklyAction -Trigger $weeklyTrigger -Principal $principal -Settings $settings -Description "OmidMed SELECT-only Holoo weekly full sync" -Force | Out-Null

Write-Host "Holoo Sync Agent installed successfully."
Write-Host ("Install directory: {0}" -f $installPath)
Write-Host ("Task user: {0}" -f $taskUser)
Write-Host ("Incremental task: {0} (every two hours)" -f $IncrementalTaskName)
Write-Host ("Weekly task: {0} (Sunday at 03:00 local time)" -f $WeeklyTaskName)
Write-Host "The installer did not run a real sync. Run dry_run first, then start a real sync only after approval."
