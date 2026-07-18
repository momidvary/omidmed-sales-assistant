[CmdletBinding()]
param(
    [string]$InstallDirectory = (Join-Path $env:ProgramData "OmidMed\HolooSyncAgent"),

    [switch]$KeepData,

    [switch]$Force
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    throw "Administrator approval is required. Reopen Windows PowerShell with Run as administrator and run the uninstaller again."
}

$installPath = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($InstallDirectory))
$programDataPath = [IO.Path]::GetFullPath($env:ProgramData).TrimEnd("\")
$allowedPrefix = $programDataPath + "\"
if (-not $installPath.StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase) -or $installPath -ieq $programDataPath) {
    throw "Refusing to remove a directory outside ProgramData: $installPath"
}

if (-not $Force) {
    $dataAction = if ($KeepData) { "keep DPAPI secret, state, and logs" } else { "permanently remove DPAPI secret, state, and logs" }
    $answer = Read-Host ("Remove both OmidMed Holoo scheduled tasks and {0}? Type UNINSTALL to continue" -f $dataAction)
    if ($answer -cne "UNINSTALL") {
        Write-Host "Uninstall cancelled."
        return
    }
}

Import-Module ScheduledTasks -ErrorAction Stop
foreach ($taskName in @("OmidMed Holoo Incremental Sync", "OmidMed Holoo Weekly Full Sync")) {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
}

if (Test-Path -LiteralPath $installPath -PathType Container) {
    if ($KeepData) {
        foreach ($fileName in @(
            "Invoke-HolooSync.ps1",
            "Install-HolooSyncAgent.ps1",
            "Uninstall-HolooSyncAgent.ps1",
            "Test-HolooSyncConnection.ps1",
            "config.example.json",
            "config.json",
            "README.fa.md"
        )) {
            $filePath = Join-Path $installPath $fileName
            if (Test-Path -LiteralPath $filePath -PathType Leaf) {
                Remove-Item -LiteralPath $filePath -Force
            }
        }
    }
    else {
        Remove-Item -LiteralPath $installPath -Recurse -Force
    }
}

Write-Host "Holoo Sync Agent scheduled tasks and installed program files were removed."
if ($KeepData) {
    Write-Host ("Sensitive data was preserved at: {0}" -f (Join-Path $installPath "data"))
}
