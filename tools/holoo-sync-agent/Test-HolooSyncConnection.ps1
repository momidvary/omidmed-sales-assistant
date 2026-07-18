[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot "config.json"),

    [switch]$TestApi
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$agentScript = Join-Path $PSScriptRoot "Invoke-HolooSync.ps1"
if (-not (Test-Path -LiteralPath $agentScript -PathType Leaf)) {
    throw "Invoke-HolooSync.ps1 was not found next to this script."
}

& $agentScript -Mode dry_run -ConfigPath $ConfigPath -ConnectionTestOnly -TestApi:$TestApi
