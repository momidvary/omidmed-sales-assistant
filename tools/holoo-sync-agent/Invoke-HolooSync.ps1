[CmdletBinding()]
param(
    [ValidateSet("initial", "incremental", "weekly_full", "manual_full", "dry_run")]
    [string]$Mode = "incremental",

    [string]$ConfigPath = (Join-Path $PSScriptRoot "config.json"),

    [switch]$ConnectionTestOnly,

    [switch]$TestApi
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$script:LogFile = $null
$script:LogRetentionDays = 30
$script:SourceTimeZone = "Iran Standard Time"

function Get-PropertyValue {
    param(
        [object]$Object,
        [string]$Name,
        [object]$DefaultValue = $null
    )

    if ($null -eq $Object) {
        return $DefaultValue
    }

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value) {
        return $DefaultValue
    }

    return $property.Value
}

function Resolve-LocalPath {
    param(
        [string]$Path,
        [string]$BasePath
    )

    $expanded = [Environment]::ExpandEnvironmentVariables($Path)
    if ([IO.Path]::IsPathRooted($expanded)) {
        return [IO.Path]::GetFullPath($expanded)
    }

    return [IO.Path]::GetFullPath((Join-Path $BasePath $expanded))
}

function Import-AgentConfiguration {
    param([string]$RequestedPath)

    $resolved = Resolve-LocalPath -Path $RequestedPath -BasePath (Get-Location).Path
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
        $examplePath = Join-Path $PSScriptRoot "config.example.json"
        if ($Mode -eq "dry_run" -and (Test-Path -LiteralPath $examplePath -PathType Leaf)) {
            $resolved = [IO.Path]::GetFullPath($examplePath)
        }
        else {
            throw "Configuration file was not found: $resolved"
        }
    }

    $config = Get-Content -LiteralPath $resolved -Raw -Encoding UTF8 | ConvertFrom-Json
    $configDirectory = Split-Path -Parent $resolved

    $sql = Get-PropertyValue -Object $config -Name "sql"
    $api = Get-PropertyValue -Object $config -Name "api"
    $sync = Get-PropertyValue -Object $config -Name "sync"
    $storage = Get-PropertyValue -Object $config -Name "storage"

    $dataDirectorySetting = [string](Get-PropertyValue -Object $storage -Name "dataDirectory" -DefaultValue ".holoo-sync-agent")
    $dataDirectory = Resolve-LocalPath -Path $dataDirectorySetting -BasePath $configDirectory
    $stateSetting = [string](Get-PropertyValue -Object $storage -Name "stateFile" -DefaultValue "state.json")
    $logSetting = [string](Get-PropertyValue -Object $storage -Name "logDirectory" -DefaultValue "logs")
    $secretSetting = [string](Get-PropertyValue -Object $api -Name "secretFile" -DefaultValue "agent-secret.dpapi")

    $statePath = Resolve-LocalPath -Path $stateSetting -BasePath $dataDirectory
    $logDirectory = Resolve-LocalPath -Path $logSetting -BasePath $dataDirectory
    $secretPath = Resolve-LocalPath -Path $secretSetting -BasePath $dataDirectory

    $customerBatchSize = [int](Get-PropertyValue -Object $sync -Name "customerBatchSize" -DefaultValue 150)
    $invoiceBatchSize = [int](Get-PropertyValue -Object $sync -Name "invoiceBatchSize" -DefaultValue 25)
    if ($customerBatchSize -lt 1 -or $customerBatchSize -gt 150) {
        throw "sync.customerBatchSize must be between 1 and 150."
    }
    if ($invoiceBatchSize -lt 1 -or $invoiceBatchSize -gt 25) {
        throw "sync.invoiceBatchSize must be between 1 and 25."
    }
    $maxPayloadBytes = [int](Get-PropertyValue -Object $sync -Name "maxPayloadBytes" -DefaultValue 2250000)
    if ($maxPayloadBytes -lt 10000 -or $maxPayloadBytes -gt 2400000) {
        throw "sync.maxPayloadBytes must be between 10000 and 2400000."
    }

    $integratedSecurity = [bool](Get-PropertyValue -Object $sql -Name "integratedSecurity" -DefaultValue $true)
    if (-not $integratedSecurity) {
        throw "Only Windows Integrated Security is supported. Use a Windows account with SELECT-only access."
    }

    $server = [string](Get-PropertyValue -Object $sql -Name "server" -DefaultValue "localhost\TNC")
    $database = [string](Get-PropertyValue -Object $sql -Name "database" -DefaultValue "Holoo1")
    $apiUrl = [string](Get-PropertyValue -Object $api -Name "url" -DefaultValue "https://omidmed-sales-assistant.vercel.app/api/holo-agent/sync")

    if ([string]::IsNullOrWhiteSpace($server) -or [string]::IsNullOrWhiteSpace($database)) {
        throw "sql.server and sql.database are required."
    }
    if ([string]::IsNullOrWhiteSpace($apiUrl)) {
        throw "api.url is required."
    }

    return [pscustomobject]@{
        ConfigPath = $resolved
        Server = $server
        Database = $database
        ConnectTimeoutSeconds = [int](Get-PropertyValue -Object $sql -Name "connectTimeoutSeconds" -DefaultValue 15)
        CommandTimeoutSeconds = [int](Get-PropertyValue -Object $sql -Name "commandTimeoutSeconds" -DefaultValue 120)
        Encrypt = [bool](Get-PropertyValue -Object $sql -Name "encrypt" -DefaultValue $false)
        TrustServerCertificate = [bool](Get-PropertyValue -Object $sql -Name "trustServerCertificate" -DefaultValue $true)
        ApiUrl = $apiUrl.TrimEnd("/")
        ApiTimeoutSeconds = [int](Get-PropertyValue -Object $api -Name "timeoutSeconds" -DefaultValue 60)
        RetryCount = [int](Get-PropertyValue -Object $api -Name "retryCount" -DefaultValue 5)
        RetryInitialDelaySeconds = [int](Get-PropertyValue -Object $api -Name "retryInitialDelaySeconds" -DefaultValue 2)
        RetryMaxDelaySeconds = [int](Get-PropertyValue -Object $api -Name "retryMaxDelaySeconds" -DefaultValue 30)
        SecretPath = $secretPath
        CustomerBatchSize = $customerBatchSize
        InvoiceBatchSize = $invoiceBatchSize
        MaxPayloadBytes = $maxPayloadBytes
        IncrementalOverlapMinutes = [int](Get-PropertyValue -Object $sync -Name "incrementalOverlapMinutes" -DefaultValue 15)
        SourceTimeZone = [string](Get-PropertyValue -Object $sync -Name "sourceTimeZone" -DefaultValue "Iran Standard Time")
        DataDirectory = $dataDirectory
        StatePath = $statePath
        LogDirectory = $logDirectory
        LogRetentionDays = [int](Get-PropertyValue -Object $storage -Name "logRetentionDays" -DefaultValue 30)
    }
}

function Initialize-AgentStorage {
    param([object]$Settings)

    foreach ($directory in @($Settings.DataDirectory, $Settings.LogDirectory, (Split-Path -Parent $Settings.StatePath))) {
        if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
            New-Item -ItemType Directory -Path $directory -Force | Out-Null
        }
    }

    $script:LogRetentionDays = [Math]::Max(1, $Settings.LogRetentionDays)
    $script:LogFile = Join-Path $Settings.LogDirectory ((Get-Date).ToString("yyyy-MM-dd") + ".log")

    $cutoff = (Get-Date).AddDays(-1 * $script:LogRetentionDays)
    Get-ChildItem -LiteralPath $Settings.LogDirectory -Filter "*.log" -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt $cutoff } |
        Remove-Item -Force -ErrorAction SilentlyContinue
}

function Write-AgentLog {
    param(
        [ValidateSet("DEBUG", "INFO", "WARN", "ERROR")]
        [string]$Level,
        [string]$Message
    )

    $safeMessage = ($Message -replace "[\r\n]+", " ").Trim()
    if ($safeMessage.Length -gt 2000) {
        $safeMessage = $safeMessage.Substring(0, 2000)
    }

    $line = "{0} [{1}] {2}" -f (Get-Date).ToUniversalTime().ToString("o"), $Level, $safeMessage
    Write-Host $line
    if (-not [string]::IsNullOrWhiteSpace($script:LogFile)) {
        Add-Content -LiteralPath $script:LogFile -Value $line -Encoding UTF8
    }
}

function Enter-AgentMutex {
    $created = $false
    $mutex = New-Object Threading.Mutex($false, "Global\OmidMed.HolooSyncAgent", [ref]$created)
    $acquired = $false
    try {
        $acquired = $mutex.WaitOne(0)
    }
    catch [Threading.AbandonedMutexException] {
        $acquired = $true
    }

    if (-not $acquired) {
        $mutex.Dispose()
        throw "Another Holoo sync process is already running."
    }

    return $mutex
}

function New-ReadOnlySqlConnection {
    param([object]$Settings)

    $builder = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
    $builder["Data Source"] = $Settings.Server
    $builder["Initial Catalog"] = $Settings.Database
    $builder["Integrated Security"] = $true
    $builder["Connect Timeout"] = [Math]::Max(1, $Settings.ConnectTimeoutSeconds)
    $builder["Application Name"] = "OmidMed Holoo SELECT-only Sync Agent"
    $builder["Encrypt"] = $Settings.Encrypt
    $builder["TrustServerCertificate"] = $Settings.TrustServerCertificate

    if ($builder.PSObject.Properties["ApplicationIntent"]) {
        $builder["ApplicationIntent"] = "ReadOnly"
    }

    return New-Object System.Data.SqlClient.SqlConnection($builder.ConnectionString)
}

function Assert-SelectOnlySql {
    param([string]$Sql)

    $trimmed = $Sql.TrimStart()
    if ($trimmed -notmatch "^(?i:SELECT)\s") {
        throw "The SQL guard rejected a command that does not start with SELECT."
    }
    if ($trimmed.Contains(";") -or $trimmed.Contains("--") -or $trimmed.Contains("/*")) {
        throw "The SQL guard rejected comments or multiple statements."
    }
    $writePattern = "(?is)\b(SELECT\s+.+\s+INTO\s+|INSERT\s+INTO\s+|UPDATE\s+.+\s+SET\s+|DELETE\s+FROM\s+|ALTER\s+(TABLE|VIEW|DATABASE|LOGIN|USER|ROLE)\s+|DROP\s+(TABLE|VIEW|DATABASE|LOGIN|USER|ROLE)\s+|CREATE\s+(TABLE|VIEW|DATABASE|LOGIN|USER|ROLE)\s+|MERGE\s+|TRUNCATE\s+TABLE\s+|EXEC(UTE)?\s+)"
    if ($trimmed -match $writePattern) {
        throw "The SQL guard rejected a potentially mutating SELECT statement."
    }
}

function Invoke-SelectQuery {
    param(
        [System.Data.SqlClient.SqlConnection]$Connection,
        [string]$Sql,
        [hashtable]$Parameters = @{},
        [int]$CommandTimeoutSeconds = 120
    )

    Assert-SelectOnlySql -Sql $Sql
    $command = $Connection.CreateCommand()
    try {
        $command.CommandText = $Sql
        $command.CommandType = [Data.CommandType]::Text
        $command.CommandTimeout = [Math]::Max(1, $CommandTimeoutSeconds)

        foreach ($name in $Parameters.Keys) {
            $value = $Parameters[$name]
            if ($null -eq $value) {
                $value = [DBNull]::Value
            }
            [void]$command.Parameters.AddWithValue($name, $value)
        }

        $reader = $command.ExecuteReader()
        try {
            $rows = New-Object "System.Collections.Generic.List[object]"
            while ($reader.Read()) {
                $row = [ordered]@{}
                for ($index = 0; $index -lt $reader.FieldCount; $index++) {
                    $value = $reader.GetValue($index)
                    if ($value -is [DBNull]) {
                        $value = $null
                    }
                    $row[$reader.GetName($index)] = $value
                }
                $rows.Add([pscustomobject]$row)
            }
            return $rows.ToArray()
        }
        finally {
            $reader.Dispose()
        }
    }
    finally {
        $command.Dispose()
    }
}

function Get-HolooObjects {
    param(
        [System.Data.SqlClient.SqlConnection]$Connection,
        [int]$CommandTimeoutSeconds
    )

    $sql = @"
SELECT
    s.name AS SchemaName,
    o.name AS ObjectName,
    o.type_desc AS ObjectType,
    c.column_id AS ColumnOrder,
    c.name AS ColumnName
FROM sys.objects AS o
INNER JOIN sys.schemas AS s ON s.schema_id = o.schema_id
INNER JOIN sys.columns AS c ON c.object_id = o.object_id
WHERE o.type IN ('U', 'V')
ORDER BY s.name, o.name, c.column_id
"@

    $rows = Invoke-SelectQuery -Connection $Connection -Sql $sql -CommandTimeoutSeconds $CommandTimeoutSeconds
    $objects = @{}
    foreach ($row in $rows) {
        $key = (([string]$row.SchemaName) + "." + ([string]$row.ObjectName)).ToLowerInvariant()
        if (-not $objects.ContainsKey($key)) {
            $objects[$key] = [pscustomobject]@{
                Schema = [string]$row.SchemaName
                Name = [string]$row.ObjectName
                Type = [string]$row.ObjectType
                Columns = @{}
            }
        }
        $columnName = [string]$row.ColumnName
        $objects[$key].Columns[$columnName.ToLowerInvariant()] = $columnName
    }

    return @($objects.Values)
}

function Resolve-Column {
    param(
        [object]$Object,
        [string[]]$Candidates,
        [switch]$Required
    )

    if ($null -eq $Object) {
        if ($Required) {
            throw "A required Holoo source object is missing."
        }
        return $null
    }

    foreach ($candidate in $Candidates) {
        $key = $candidate.ToLowerInvariant()
        if ($Object.Columns.ContainsKey($key)) {
            return [string]$Object.Columns[$key]
        }
    }

    if ($Required) {
        throw ("Required column was not found on {0}.{1}. Candidates: {2}" -f $Object.Schema, $Object.Name, ($Candidates -join ", "))
    }
    return $null
}

function Test-ObjectColumns {
    param(
        [object]$Object,
        [hashtable]$RequiredColumnGroups
    )

    foreach ($group in $RequiredColumnGroups.Values) {
        $found = $false
        foreach ($candidate in $group) {
            if ($Object.Columns.ContainsKey(([string]$candidate).ToLowerInvariant())) {
                $found = $true
                break
            }
        }
        if (-not $found) {
            return $false
        }
    }
    return $true
}

function Resolve-HolooObject {
    param(
        [object[]]$Objects,
        [string[]]$PreferredNames,
        [hashtable]$RequiredColumnGroups,
        [switch]$Optional
    )

    foreach ($preferredName in $PreferredNames) {
        foreach ($object in $Objects) {
            if ($object.Name -ieq $preferredName -and (Test-ObjectColumns -Object $object -RequiredColumnGroups $RequiredColumnGroups)) {
                return $object
            }
        }
    }

    foreach ($object in ($Objects | Sort-Object @{ Expression = { if ($_.Type -eq "VIEW") { 0 } else { 1 } } }, Name)) {
        if (Test-ObjectColumns -Object $object -RequiredColumnGroups $RequiredColumnGroups) {
            return $object
        }
    }

    if ($Optional) {
        return $null
    }
    throw ("No Holoo table or view matched required metadata groups: {0}" -f (($RequiredColumnGroups.Keys | Sort-Object) -join ", "))
}

function Get-HolooMapping {
    param([object[]]$Objects)

    $customerRequirements = @{
        Code = @("C_Code", "CustomerCode", "CustCode", "Code")
        Name = @("C_Name", "CustomerName", "CustName", "Name")
    }
    $balanceRequirements = @{
        Code = @("C_Code", "CustomerCode", "CustCode", "Code")
        Balance = @("Mandeh", "Balance", "Remain", "Remaining")
    }
    $invoiceRequirements = @{
        FacCode = @("Fac_Code", "FacCode", "InvoiceCode")
        FacType = @("Fac_Type", "FacType", "InvoiceType")
        CustomerCode = @("C_Code", "CustomerCode", "CustCode")
        InvoiceDate = @("Fac_Date", "InvoiceDate", "Date")
    }
    $itemRequirements = @{
        FacCode = @("Fac_Code", "FacCode", "InvoiceCode")
        FacType = @("Fac_Type", "FacType", "InvoiceType")
        ArticleCode = @("A_Code", "ArticleCode", "ProductCode")
    }
    $articleRequirements = @{
        ArticleCode = @("A_Code", "ArticleCode", "ProductCode")
        ArticleName = @("A_Name", "ArticleName", "ProductName", "Name")
    }

    $customer = Resolve-HolooObject -Objects $Objects -PreferredNames @("W_Calc_Mandeh_Customer", "W_ShowCustomer", "CUSTOMER") -RequiredColumnGroups $customerRequirements
    $balance = $customer
    if ($null -eq (Resolve-Column -Object $customer -Candidates $balanceRequirements.Balance)) {
        $balance = Resolve-HolooObject -Objects $Objects -PreferredNames @("W_Calc_Mandeh_Customer", "MandehOfCustomer", "CustomerBalance") -RequiredColumnGroups $balanceRequirements
    }
    $invoice = Resolve-HolooObject -Objects $Objects -PreferredNames @("FACTURE", "FactureU", "Invoice", "Invoices") -RequiredColumnGroups $invoiceRequirements
    $item = Resolve-HolooObject -Objects $Objects -PreferredNames @("FACTART", "InvoiceItem", "InvoiceItems") -RequiredColumnGroups $itemRequirements
    $article = Resolve-HolooObject -Objects $Objects -PreferredNames @("ARTICLE", "Articles", "Product", "Products") -RequiredColumnGroups $articleRequirements -Optional
    $customerLookup = Resolve-HolooObject -Objects $Objects -PreferredNames @("CUSTOMER", "W_ShowCustomer", "W_Calc_Mandeh_Customer") -RequiredColumnGroups $customerRequirements

    return [pscustomobject]@{
        Customer = $customer
        Balance = $balance
        Invoice = $invoice
        Item = $item
        Article = $article
        CustomerLookup = $customerLookup
    }
}

function Quote-SqlIdentifier {
    param([string]$Name)
    return "[" + $Name.Replace("]", "]]") + "]"
}

function Get-ObjectSql {
    param(
        [object]$Object,
        [string]$Alias
    )
    return (Quote-SqlIdentifier $Object.Schema) + "." + (Quote-SqlIdentifier $Object.Name) + " AS " + (Quote-SqlIdentifier $Alias)
}

function Get-ColumnSql {
    param(
        [object]$Object,
        [string[]]$Candidates,
        [string]$Alias,
        [string]$FallbackSql = "CAST(NULL AS nvarchar(1))",
        [switch]$Required
    )

    $column = Resolve-Column -Object $Object -Candidates $Candidates -Required:$Required
    if ($null -eq $column) {
        return $FallbackSql
    }
    return (Quote-SqlIdentifier $Alias) + "." + (Quote-SqlIdentifier $column)
}

function Get-StringValue {
    param([object]$Value)
    if ($null -eq $Value -or $Value -is [DBNull]) {
        return $null
    }
    $text = ([string]$Value).Trim()
    if ([string]::IsNullOrWhiteSpace($text)) {
        return $null
    }
    return $text
}

function Get-DecimalValue {
    param([object]$Value)
    if ($null -eq $Value -or $Value -is [DBNull]) {
        return [decimal]0
    }
    try {
        return [Convert]::ToDecimal($Value, [Globalization.CultureInfo]::InvariantCulture)
    }
    catch {
        return [decimal]0
    }
}

function Get-BooleanValue {
    param([object]$Value)
    if ($null -eq $Value -or $Value -is [DBNull]) {
        return $false
    }
    try {
        return [Convert]::ToBoolean($Value, [Globalization.CultureInfo]::InvariantCulture)
    }
    catch {
        return $false
    }
}

function Convert-ToSourceDateTime {
    param([object]$Value)
    if ($null -eq $Value -or $Value -is [DBNull]) {
        return $null
    }
    try {
        return [Convert]::ToDateTime($Value, [Globalization.CultureInfo]::InvariantCulture)
    }
    catch {
        return $null
    }
}

function Convert-ToUtcIso {
    param([object]$Value)

    $date = Convert-ToSourceDateTime -Value $Value
    if ($null -eq $date) {
        return $null
    }

    try {
        $unspecified = [DateTime]::SpecifyKind($date, [DateTimeKind]::Unspecified)
        $timeZone = [TimeZoneInfo]::FindSystemTimeZoneById($script:SourceTimeZone)
        $utc = [TimeZoneInfo]::ConvertTimeToUtc($unspecified, $timeZone)
        return $utc.ToString("o", [Globalization.CultureInfo]::InvariantCulture)
    }
    catch {
        return ([DateTime]$date).ToUniversalTime().ToString("o", [Globalization.CultureInfo]::InvariantCulture)
    }
}

function Convert-ToApiDate {
    param([object]$Value)
    $date = Convert-ToSourceDateTime -Value $Value
    if ($null -eq $date) {
        return $null
    }
    return $date.ToString("yyyy-MM-dd", [Globalization.CultureInfo]::InvariantCulture)
}

function Convert-ToWatermark {
    param([object]$Value)
    $date = Convert-ToSourceDateTime -Value $Value
    if ($null -eq $date) {
        return $null
    }
    return $date.ToString("yyyy-MM-ddTHH:mm:ss.fff", [Globalization.CultureInfo]::InvariantCulture)
}

function Get-IncrementalSince {
    param(
        [string]$Watermark,
        [int]$OverlapMinutes
    )

    if ([string]::IsNullOrWhiteSpace($Watermark)) {
        return $null
    }
    try {
        $parsed = [DateTime]::Parse($Watermark, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AllowWhiteSpaces)
        return $parsed.AddMinutes(-1 * [Math]::Max(0, $OverlapMinutes))
    }
    catch {
        Write-AgentLog -Level "WARN" -Message "Stored watermark is invalid; this source will be read without an incremental filter."
        return $null
    }
}

function Get-CustomerRows {
    param(
        [System.Data.SqlClient.SqlConnection]$Connection,
        [object]$Mapping,
        [object]$Settings,
        [object]$Since
    )

    $source = $Mapping.Customer
    $balanceSource = $Mapping.Balance
    $codeColumn = Resolve-Column -Object $source -Candidates @("C_Code", "CustomerCode", "CustCode", "Code") -Required
    $nameExpression = Get-ColumnSql -Object $source -Candidates @("C_Name", "CustomerName", "CustName", "Name") -Alias "c" -Required
    $codeExpression = (Quote-SqlIdentifier "c") + "." + (Quote-SqlIdentifier $codeColumn)
    $updateColumn = Resolve-Column -Object $source -Candidates @("Endeditdate", "EndEditDate", "UpdatedAt", "ModifiedDate", "Creation_Date", "CreationDate")
    $updateExpression = if ($null -eq $updateColumn) { "CAST(NULL AS datetime)" } else { (Quote-SqlIdentifier "c") + "." + (Quote-SqlIdentifier $updateColumn) }

    $joinSql = ""
    $balanceAlias = "c"
    if ($balanceSource.Schema -ine $source.Schema -or $balanceSource.Name -ine $source.Name) {
        $balanceAlias = "b"
        $balanceCode = Resolve-Column -Object $balanceSource -Candidates @("C_Code", "CustomerCode", "CustCode", "Code") -Required
        $joinSql = " LEFT JOIN " + (Get-ObjectSql -Object $balanceSource -Alias "b") + " ON " +
            (Quote-SqlIdentifier "b") + "." + (Quote-SqlIdentifier $balanceCode) + " = " + $codeExpression
    }

    $balanceExpression = Get-ColumnSql -Object $balanceSource -Candidates @("Mandeh", "Balance", "Remain", "Remaining") -Alias $balanceAlias -FallbackSql "CAST(0 AS decimal(18, 3))" -Required
    $balanceTypeExpression = Get-ColumnSql -Object $balanceSource -Candidates @("Type_Mandeh", "BalanceType", "RemainType") -Alias $balanceAlias -FallbackSql "CAST(NULL AS smallint)"
    $whereParts = New-Object "System.Collections.Generic.List[string]"
    $whereParts.Add("1 = 1")
    $deletedColumn = Resolve-Column -Object $source -Candidates @("Delete", "IsDeleted", "Deleted")
    if ($null -ne $deletedColumn) {
        $deletedExpression = (Quote-SqlIdentifier "c") + "." + (Quote-SqlIdentifier $deletedColumn)
        $whereParts.Add("($deletedExpression IS NULL OR $deletedExpression = 0)")
    }

    $parameters = @{}
    if ($null -ne $Since -and $null -ne $updateColumn) {
        $whereParts.Add("$updateExpression >= @since")
        $parameters["@since"] = $Since
    }
    elseif ($null -ne $Since -and $null -eq $updateColumn) {
        Write-AgentLog -Level "WARN" -Message "Customer metadata has no update timestamp; customers will be reread idempotently."
    }

    $sql = @"
SELECT
    $codeExpression AS CustomerCode,
    $nameExpression AS CustomerName,
    $(Get-ColumnSql -Object $source -Candidates @("Counective_Name", "ContactName", "Contact_Name") -Alias "c") AS ContactName,
    $(Get-ColumnSql -Object $source -Candidates @("C_Mobile", "Mobile", "MobilePhone") -Alias "c") AS Mobile,
    $(Get-ColumnSql -Object $source -Candidates @("C_Tel", "Telephone", "Phone", "Tel") -Alias "c") AS Telephone,
    $(Get-ColumnSql -Object $source -Candidates @("Cust_Ostan", "Province", "StateName") -Alias "c") AS Province,
    $(Get-ColumnSql -Object $source -Candidates @("Cust_City", "City", "CityName") -Alias "c") AS City,
    $(Get-ColumnSql -Object $source -Candidates @("C_Address", "Address", "PostalAddress") -Alias "c") AS CustomerAddress,
    $balanceExpression AS BalanceAmount,
    $balanceTypeExpression AS BalanceType,
    $updateExpression AS SourceUpdatedAt
FROM $(Get-ObjectSql -Object $source -Alias "c")$joinSql
WHERE $($whereParts -join " AND ")
ORDER BY $codeExpression
"@

    return @(Invoke-SelectQuery -Connection $Connection -Sql $sql -Parameters $parameters -CommandTimeoutSeconds $Settings.CommandTimeoutSeconds)
}

function Get-InvoiceRows {
    param(
        [System.Data.SqlClient.SqlConnection]$Connection,
        [object]$Mapping,
        [object]$Settings,
        [object]$Since
    )

    $header = $Mapping.Invoice
    $item = $Mapping.Item
    $customer = $Mapping.CustomerLookup
    $article = $Mapping.Article

    $headerFacCode = Resolve-Column -Object $header -Candidates @("Fac_Code", "FacCode", "InvoiceCode") -Required
    $headerFacType = Resolve-Column -Object $header -Candidates @("Fac_Type", "FacType", "InvoiceType") -Required
    $headerCustomerCode = Resolve-Column -Object $header -Candidates @("C_Code", "CustomerCode", "CustCode") -Required
    $itemFacCode = Resolve-Column -Object $item -Candidates @("Fac_Code", "FacCode", "InvoiceCode") -Required
    $itemFacType = Resolve-Column -Object $item -Candidates @("Fac_Type", "FacType", "InvoiceType") -Required
    $itemArticleCode = Resolve-Column -Object $item -Candidates @("A_Code", "ArticleCode", "ProductCode") -Required
    $customerCode = Resolve-Column -Object $customer -Candidates @("C_Code", "CustomerCode", "CustCode", "Code") -Required

    $hFacCode = (Quote-SqlIdentifier "h") + "." + (Quote-SqlIdentifier $headerFacCode)
    $hFacType = (Quote-SqlIdentifier "h") + "." + (Quote-SqlIdentifier $headerFacType)
    $hCustomerCode = (Quote-SqlIdentifier "h") + "." + (Quote-SqlIdentifier $headerCustomerCode)
    $iFacCode = (Quote-SqlIdentifier "i") + "." + (Quote-SqlIdentifier $itemFacCode)
    $iFacType = (Quote-SqlIdentifier "i") + "." + (Quote-SqlIdentifier $itemFacType)
    $iArticleCode = (Quote-SqlIdentifier "i") + "." + (Quote-SqlIdentifier $itemArticleCode)
    $cCustomerCode = (Quote-SqlIdentifier "c") + "." + (Quote-SqlIdentifier $customerCode)

    $creationColumn = Resolve-Column -Object $header -Candidates @("Creation_Date", "CreationDate", "CreatedAt", "Endeditdate", "UpdatedAt", "Fac_Date")
    $creationExpression = if ($null -eq $creationColumn) { "CAST(NULL AS datetime)" } else { (Quote-SqlIdentifier "h") + "." + (Quote-SqlIdentifier $creationColumn) }

    $articleJoin = ""
    $articleNameExpression = "CAST(NULL AS nvarchar(1))"
    if ($null -ne $article) {
        $articleCode = Resolve-Column -Object $article -Candidates @("A_Code", "ArticleCode", "ProductCode") -Required
        $aArticleCode = (Quote-SqlIdentifier "a") + "." + (Quote-SqlIdentifier $articleCode)
        $articleJoin = " LEFT JOIN " + (Get-ObjectSql -Object $article -Alias "a") + " ON $aArticleCode = $iArticleCode"
        $articleNameExpression = Get-ColumnSql -Object $article -Candidates @("A_Name", "ArticleName", "ProductName", "Name") -Alias "a"
    }

    $whereParts = New-Object "System.Collections.Generic.List[string]"
    $whereParts.Add("$hFacType = @facType")
    $parameters = @{ "@facType" = "F" }
    if ($null -ne $Since -and $null -ne $creationColumn) {
        $whereParts.Add("$creationExpression >= @since")
        $parameters["@since"] = $Since
    }
    elseif ($null -ne $Since -and $null -eq $creationColumn) {
        Write-AgentLog -Level "WARN" -Message "Invoice metadata has no update timestamp; sales invoices will be reread idempotently."
    }

    $itemIndexExpression = Get-ColumnSql -Object $item -Candidates @("A_Index", "ArticleIndex", "RowNumber", "RowNo") -Alias "i" -FallbackSql "CAST(0 AS int)"

    $sql = @"
SELECT
    $hFacCode AS FacCode,
    $hFacType AS FacType,
    $(Get-ColumnSql -Object $header -Candidates @("Fac_Code_C", "InvoiceNumber", "FacNumber") -Alias "h" -FallbackSql $hFacCode) AS InvoiceNumber,
    $(Get-ColumnSql -Object $header -Candidates @("Sanad_Code", "DocumentNumber", "DocNumber") -Alias "h") AS DocumentNumber,
    $hCustomerCode AS CustomerCode,
    $(Get-ColumnSql -Object $customer -Candidates @("C_Name", "CustomerName", "CustName", "Name") -Alias "c") AS CustomerName,
    $(Get-ColumnSql -Object $header -Candidates @("Fac_Date", "InvoiceDate", "Date") -Alias "h" -Required) AS InvoiceDate,
    $(Get-ColumnSql -Object $header -Candidates @("CorrectDateTasvieh", "DueDate", "TasviehDate") -Alias "h" -FallbackSql "CAST(NULL AS datetime)") AS DueDate,
    $creationExpression AS CreationDate,
    $(Get-ColumnSql -Object $header -Candidates @("Sum_Few", "TotalQuantity", "TotalQty") -Alias "h" -FallbackSql "CAST(0 AS decimal(18, 3))") AS TotalQuantity,
    $(Get-ColumnSql -Object $header -Candidates @("Sum_Price", "TotalAmount", "TotalPrice") -Alias "h" -FallbackSql "CAST(0 AS decimal(18, 3))") AS TotalAmount,
    $(Get-ColumnSql -Object $header -Candidates @("FNaghd", "CashAmount") -Alias "h" -FallbackSql "CAST(0 AS decimal(18, 3))") AS CashAmount,
    $(Get-ColumnSql -Object $header -Candidates @("FCheck", "CheckAmount", "ChequeAmount") -Alias "h" -FallbackSql "CAST(0 AS decimal(18, 3))") AS CheckAmount,
    $(Get-ColumnSql -Object $header -Candidates @("Card", "CardAmount", "PosAmount") -Alias "h" -FallbackSql "CAST(0 AS decimal(18, 3))") AS CardAmount,
    $(Get-ColumnSql -Object $header -Candidates @("FNesieh", "CreditAmount") -Alias "h" -FallbackSql "CAST(0 AS decimal(18, 3))") AS CreditAmount,
    $(Get-ColumnSql -Object $header -Candidates @("Takhfif", "DiscountAmount", "Discount") -Alias "h" -FallbackSql "CAST(0 AS decimal(18, 3))") AS InvoiceDiscountAmount,
    $(Get-ColumnSql -Object $header -Candidates @("Delete", "IsDeleted", "Deleted") -Alias "h" -FallbackSql "CAST(0 AS bit)") AS IsDeleted,
    $iArticleCode AS ArticleCode,
    $itemIndexExpression AS ArticleIndex,
    $articleNameExpression AS ProductName,
    $(Get-ColumnSql -Object $item -Candidates @("Few_Article", "Quantity", "Qty") -Alias "i" -FallbackSql "CAST(0 AS decimal(18, 3))") AS Quantity,
    $(Get-ColumnSql -Object $item -Candidates @("Price_BS", "UnitPrice", "Price") -Alias "i" -FallbackSql "CAST(0 AS decimal(18, 3))") AS UnitPrice,
    $(Get-ColumnSql -Object $item -Candidates @("FacArtic_Comment", "Description", "Comment") -Alias "i") AS ItemDescription,
    $(Get-ColumnSql -Object $item -Candidates @("Buy_Price", "BuyPrice") -Alias "i" -FallbackSql "CAST(0 AS decimal(18, 3))") AS BuyPrice,
    $(Get-ColumnSql -Object $item -Candidates @("TakhfifSatriR", "DiscountAmount", "LineDiscount") -Alias "i" -FallbackSql "CAST(0 AS decimal(18, 3))") AS ItemDiscountAmount,
    $(Get-ColumnSql -Object $item -Candidates @("Levy", "LevyAmount") -Alias "i" -FallbackSql "CAST(0 AS decimal(18, 3))") AS LevyAmount,
    $(Get-ColumnSql -Object $item -Candidates @("Scot", "TaxAmount", "Tax") -Alias "i" -FallbackSql "CAST(0 AS decimal(18, 3))") AS TaxAmount
FROM $(Get-ObjectSql -Object $header -Alias "h")
LEFT JOIN $(Get-ObjectSql -Object $item -Alias "i") ON $iFacCode = $hFacCode AND $iFacType = $hFacType
LEFT JOIN $(Get-ObjectSql -Object $customer -Alias "c") ON $cCustomerCode = $hCustomerCode$articleJoin
WHERE $($whereParts -join " AND ")
ORDER BY $hFacCode, $itemIndexExpression
"@

    return @(Invoke-SelectQuery -Connection $Connection -Sql $sql -Parameters $parameters -CommandTimeoutSeconds $Settings.CommandTimeoutSeconds)
}

function Convert-CustomersForApi {
    param([object[]]$Rows)

    $customers = New-Object "System.Collections.Generic.List[object]"
    $skipped = 0
    $maximumTimestamp = $null
    foreach ($row in $Rows) {
        $code = Get-StringValue $row.CustomerCode
        $name = Get-StringValue $row.CustomerName
        if ([string]::IsNullOrWhiteSpace($code) -or [string]::IsNullOrWhiteSpace($name)) {
            $skipped++
            continue
        }

        $balance = Get-DecimalValue $row.BalanceAmount
        $balanceType = Get-StringValue $row.BalanceType
        $balanceStatus = "unknown"
        if ($balance -eq 0) {
            $balanceStatus = "zero"
        }
        elseif ($balanceType -eq "1") {
            $balanceStatus = "debtor"
        }
        elseif ($balanceType -eq "-1") {
            $balanceStatus = "creditor"
        }

        $customers.Add([pscustomobject][ordered]@{
            code = $code
            name = $name
            contactName = Get-StringValue $row.ContactName
            mobile = Get-StringValue $row.Mobile
            telephone = Get-StringValue $row.Telephone
            province = Get-StringValue $row.Province
            city = Get-StringValue $row.City
            address = Get-StringValue $row.CustomerAddress
            balanceAmount = [Math]::Abs($balance)
            balanceStatus = $balanceStatus
            sourceUpdatedAt = Convert-ToUtcIso $row.SourceUpdatedAt
        })

        $timestamp = Convert-ToSourceDateTime $row.SourceUpdatedAt
        if ($null -ne $timestamp -and ($null -eq $maximumTimestamp -or $timestamp -gt $maximumTimestamp)) {
            $maximumTimestamp = $timestamp
        }
    }

    return [pscustomobject]@{
        Items = $customers.ToArray()
        Skipped = $skipped
        MaximumTimestamp = $maximumTimestamp
    }
}

function Convert-InvoicesForApi {
    param([object[]]$Rows)

    $invoicesByKey = [ordered]@{}
    $skipped = 0
    $maximumTimestamp = $null

    foreach ($row in $Rows) {
        $facCode = Get-StringValue $row.FacCode
        $facType = Get-StringValue $row.FacType
        $customerCode = Get-StringValue $row.CustomerCode
        $invoiceDate = Convert-ToApiDate $row.InvoiceDate
        if ([string]::IsNullOrWhiteSpace($facCode) -or $facType -ne "F" -or [string]::IsNullOrWhiteSpace($customerCode) -or [string]::IsNullOrWhiteSpace($invoiceDate)) {
            $skipped++
            continue
        }

        $key = $facType + ":" + $facCode
        if (-not $invoicesByKey.Contains($key)) {
            $invoiceNumber = Get-StringValue $row.InvoiceNumber
            if ([string]::IsNullOrWhiteSpace($invoiceNumber)) {
                $invoiceNumber = $facCode
            }

            $invoicesByKey[$key] = [pscustomobject][ordered]@{
                facCode = $facCode
                facType = "F"
                invoiceNumber = $invoiceNumber
                documentNumber = Get-StringValue $row.DocumentNumber
                customerCode = $customerCode
                customerName = Get-StringValue $row.CustomerName
                invoiceDate = $invoiceDate
                dueDate = Convert-ToApiDate $row.DueDate
                creationDate = Convert-ToUtcIso $row.CreationDate
                totalQuantity = [Math]::Abs((Get-DecimalValue $row.TotalQuantity))
                totalAmount = [Math]::Max([decimal]0, (Get-DecimalValue $row.TotalAmount))
                cashAmount = [Math]::Max([decimal]0, (Get-DecimalValue $row.CashAmount))
                checkAmount = [Math]::Max([decimal]0, (Get-DecimalValue $row.CheckAmount))
                cardAmount = [Math]::Max([decimal]0, (Get-DecimalValue $row.CardAmount))
                creditAmount = [Math]::Max([decimal]0, (Get-DecimalValue $row.CreditAmount))
                discountAmount = [Math]::Max([decimal]0, (Get-DecimalValue $row.InvoiceDiscountAmount))
                isDeleted = Get-BooleanValue $row.IsDeleted
                items = (New-Object "System.Collections.Generic.List[object]")
            }

            $timestamp = Convert-ToSourceDateTime $row.CreationDate
            if ($null -ne $timestamp -and ($null -eq $maximumTimestamp -or $timestamp -gt $maximumTimestamp)) {
                $maximumTimestamp = $timestamp
            }
        }

        $articleCode = Get-StringValue $row.ArticleCode
        if (-not [string]::IsNullOrWhiteSpace($articleCode)) {
            $quantity = Get-DecimalValue $row.Quantity
            $unitPrice = Get-DecimalValue $row.UnitPrice
            $productName = Get-StringValue $row.ProductName
            if ([string]::IsNullOrWhiteSpace($productName)) {
                $productName = $articleCode
            }

            $articleIndex = 0
            if ($null -ne $row.ArticleIndex) {
                [void][int]::TryParse(([string]$row.ArticleIndex), [ref]$articleIndex)
            }

            $invoicesByKey[$key].items.Add([pscustomobject][ordered]@{
                rowNumber = $articleIndex
                productName = $productName
                quantity = [Math]::Abs($quantity)
                unitPrice = [Math]::Max([decimal]0, $unitPrice)
                lineTotal = [Math]::Max([decimal]0, ([Math]::Abs($quantity) * $unitPrice))
                description = Get-StringValue $row.ItemDescription
                articleCode = $articleCode
                articleIndex = $articleIndex
                buyPrice = [Math]::Max([decimal]0, (Get-DecimalValue $row.BuyPrice))
                discountAmount = [Math]::Max([decimal]0, (Get-DecimalValue $row.ItemDiscountAmount))
                levyAmount = [Math]::Max([decimal]0, (Get-DecimalValue $row.LevyAmount))
                taxAmount = [Math]::Max([decimal]0, (Get-DecimalValue $row.TaxAmount))
            })
        }
    }

    return [pscustomobject]@{
        Items = @($invoicesByKey.Values)
        Skipped = $skipped
        MaximumTimestamp = $maximumTimestamp
    }
}

function New-DefaultState {
    return [pscustomobject][ordered]@{
        version = 1
        customerWatermark = $null
        invoiceWatermark = $null
        pendingRunId = $null
        pendingMode = $null
        lastSuccessfulRunId = $null
        lastSuccessfulMode = $null
        lastSuccessfulAt = $null
    }
}

function Import-AgentState {
    param([string]$StatePath)

    $state = New-DefaultState
    if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
        return $state
    }

    try {
        $loaded = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($property in $state.PSObject.Properties.Name) {
            $loadedProperty = $loaded.PSObject.Properties[$property]
            if ($null -ne $loadedProperty) {
                $state.$property = $loadedProperty.Value
            }
        }
        return $state
    }
    catch {
        throw "State file is invalid and was not changed: $StatePath"
    }
}

function Save-AgentState {
    param(
        [object]$State,
        [string]$StatePath
    )

    $directory = Split-Path -Parent $StatePath
    $temporaryPath = Join-Path $directory (([IO.Path]::GetFileName($StatePath)) + ".tmp")
    $State | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
    Move-Item -LiteralPath $temporaryPath -Destination $StatePath -Force
}

function Get-DpapiSecret {
    param([string]$SecretPath)

    if (-not (Test-Path -LiteralPath $SecretPath -PathType Leaf)) {
        throw "DPAPI secret file was not found. Run Install-HolooSyncAgent.ps1 first."
    }

    $encrypted = (Get-Content -LiteralPath $SecretPath -Raw -Encoding UTF8).Trim()
    $secure = ConvertTo-SecureString $encrypted
    $pointer = [IntPtr]::Zero
    try {
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        if ($pointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        }
    }
}

function New-AgentHttpClient {
    param([object]$Settings)

    Add-Type -AssemblyName System.Net.Http
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $client = New-Object System.Net.Http.HttpClient
    $client.Timeout = [TimeSpan]::FromSeconds([Math]::Max(1, $Settings.ApiTimeoutSeconds))

    $secret = Get-DpapiSecret -SecretPath $Settings.SecretPath
    try {
        $client.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", $secret)
        $client.DefaultRequestHeaders.UserAgent.ParseAdd("OmidMed-Holoo-Sync-Agent/1.0")
    }
    finally {
        $secret = $null
    }

    return $client
}

function Invoke-ApiRequestWithRetry {
    param(
        [System.Net.Http.HttpClient]$Client,
        [object]$Settings,
        [ValidateSet("GET", "POST")]
        [string]$Method,
        [object]$Payload = $null
    )

    $attemptLimit = [Math]::Max(1, $Settings.RetryCount)
    for ($attempt = 1; $attempt -le $attemptLimit; $attempt++) {
        $request = $null
        $response = $null
        try {
            $request = New-Object System.Net.Http.HttpRequestMessage
            $request.RequestUri = [Uri]$Settings.ApiUrl
            $request.Method = if ($Method -eq "GET") { [Net.Http.HttpMethod]::Get } else { [Net.Http.HttpMethod]::Post }
            if ($Method -eq "POST") {
                $json = $Payload | ConvertTo-Json -Depth 12 -Compress
                $request.Content = New-Object System.Net.Http.StringContent($json, [Text.Encoding]::UTF8, "application/json")
            }

            $response = $Client.SendAsync($request).GetAwaiter().GetResult()
            if (-not $response.IsSuccessStatusCode) {
                throw ("API returned HTTP {0}." -f [int]$response.StatusCode)
            }

            $responseText = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            if (-not [string]::IsNullOrWhiteSpace($responseText)) {
                $result = $responseText | ConvertFrom-Json
                $okProperty = $result.PSObject.Properties["ok"]
                if ($null -ne $okProperty -and -not [bool]$okProperty.Value) {
                    throw "API response reported failure."
                }
                return $result
            }
            return $null
        }
        catch {
            if ($attempt -ge $attemptLimit) {
                throw
            }
            $baseDelay = [Math]::Max(1, $Settings.RetryInitialDelaySeconds)
            $delay = [Math]::Min([Math]::Max(1, $Settings.RetryMaxDelaySeconds), ($baseDelay * [Math]::Pow(2, $attempt - 1)))
            Write-AgentLog -Level "WARN" -Message ("API attempt {0}/{1} failed; retrying in {2} seconds. {3}" -f $attempt, $attemptLimit, [int]$delay, $_.Exception.Message)
            Start-Sleep -Seconds ([int]$delay)
        }
        finally {
            if ($null -ne $response) {
                $response.Dispose()
            }
            if ($null -ne $request) {
                $request.Dispose()
            }
        }
    }
}

function Send-ApiBatches {
    param(
        [System.Net.Http.HttpClient]$Client,
        [object]$Settings,
        [string]$RunId,
        [string]$SyncMode,
        [ValidateSet("customers", "invoices")]
        [string]$BatchType,
        [object[]]$Items,
        [int]$BatchSize
    )

    $itemsArray = @($Items)
    $offset = 0
    while ($offset -lt $itemsArray.Count) {
        $take = [Math]::Min($BatchSize, $itemsArray.Count - $offset)
        $batch = $null
        $payload = $null
        while ($take -gt 0) {
            $lastIndex = $offset + $take - 1
            $batch = @($itemsArray[$offset..$lastIndex])
            $payload = [ordered]@{
                runId = $RunId
                mode = $SyncMode
                batchType = $BatchType
                sourceServer = $Settings.Server
                sourceDatabase = $Settings.Database
                final = $false
            }
            $payload[$BatchType] = $batch
            $json = $payload | ConvertTo-Json -Depth 12 -Compress
            $payloadBytes = [Text.Encoding]::UTF8.GetByteCount($json)
            if ($payloadBytes -le $Settings.MaxPayloadBytes) {
                break
            }
            $take--
        }

        if ($take -lt 1) {
            throw ("A single {0} record exceeds the configured payload byte limit." -f $BatchType)
        }

        [void](Invoke-ApiRequestWithRetry -Client $Client -Settings $Settings -Method "POST" -Payload $payload)
        Write-AgentLog -Level "INFO" -Message ("Sent {0} batch with {1} record(s)." -f $BatchType, $batch.Count)
        $offset += $take
    }
}

function Get-ObjectDisplayName {
    param([object]$Object)
    if ($null -eq $Object) {
        return "not available"
    }
    return $Object.Schema + "." + $Object.Name + " (" + $Object.Type + ")"
}

function Invoke-AgentMain {
    $settings = Import-AgentConfiguration -RequestedPath $ConfigPath
    $script:SourceTimeZone = $settings.SourceTimeZone
    Initialize-AgentStorage -Settings $settings
    $mutex = Enter-AgentMutex
    try {
        Write-AgentLog -Level "INFO" -Message ("Starting mode={0}, server={1}, database={2}." -f $Mode, $settings.Server, $settings.Database)

        $connection = New-ReadOnlySqlConnection -Settings $settings
        try {
            $connection.Open()
            $objects = Get-HolooObjects -Connection $connection -CommandTimeoutSeconds $settings.CommandTimeoutSeconds
            $mapping = Get-HolooMapping -Objects $objects

            Write-AgentLog -Level "INFO" -Message ("Metadata mapping: customers={0}; balances={1}; invoices={2}; items={3}; articles={4}." -f
                (Get-ObjectDisplayName $mapping.Customer),
                (Get-ObjectDisplayName $mapping.Balance),
                (Get-ObjectDisplayName $mapping.Invoice),
                (Get-ObjectDisplayName $mapping.Item),
                (Get-ObjectDisplayName $mapping.Article))

            if ($ConnectionTestOnly) {
                Write-AgentLog -Level "INFO" -Message "SQL connection and SELECT-only metadata discovery succeeded."
                if ($TestApi) {
                    $testClient = New-AgentHttpClient -Settings $settings
                    try {
                        [void](Invoke-ApiRequestWithRetry -Client $testClient -Settings $settings -Method "GET")
                        Write-AgentLog -Level "INFO" -Message "Authenticated API connection succeeded."
                    }
                    finally {
                        $testClient.Dispose()
                    }
                }
                return
            }

            $state = Import-AgentState -StatePath $settings.StatePath
            $effectiveMode = $Mode
            if ($Mode -eq "dry_run") {
                $effectiveMode = "initial"
            }
            elseif ($Mode -eq "incremental" -and [string]::IsNullOrWhiteSpace([string]$state.lastSuccessfulAt)) {
                $effectiveMode = "initial"
                Write-AgentLog -Level "INFO" -Message "No successful state exists; incremental request was promoted to initial mode."
            }

            $customerSince = $null
            $invoiceSince = $null
            if ($effectiveMode -eq "incremental") {
                $customerSince = Get-IncrementalSince -Watermark ([string]$state.customerWatermark) -OverlapMinutes $settings.IncrementalOverlapMinutes
                $invoiceSince = Get-IncrementalSince -Watermark ([string]$state.invoiceWatermark) -OverlapMinutes $settings.IncrementalOverlapMinutes
            }

            $customerRows = Get-CustomerRows -Connection $connection -Mapping $mapping -Settings $settings -Since $customerSince
            $invoiceRows = Get-InvoiceRows -Connection $connection -Mapping $mapping -Settings $settings -Since $invoiceSince
        }
        finally {
            if ($null -ne $connection) {
                $connection.Dispose()
            }
        }

        $customerResult = Convert-CustomersForApi -Rows $customerRows
        $invoiceResult = Convert-InvoicesForApi -Rows $invoiceRows
        $itemCount = 0
        foreach ($invoice in $invoiceResult.Items) {
            $itemCount += $invoice.items.Count
        }

        Write-AgentLog -Level "INFO" -Message ("Read complete: customers={0}, invoices={1}, items={2}, skippedRows={3}." -f
            $customerResult.Items.Count,
            $invoiceResult.Items.Count,
            $itemCount,
            ($customerResult.Skipped + $invoiceResult.Skipped))

        if ($Mode -eq "dry_run") {
            $minimumCustomerBatches = if ($customerResult.Items.Count -eq 0) { 0 } else { [Math]::Ceiling($customerResult.Items.Count / [double]$settings.CustomerBatchSize) }
            $minimumInvoiceBatches = if ($invoiceResult.Items.Count -eq 0) { 0 } else { [Math]::Ceiling($invoiceResult.Items.Count / [double]$settings.InvoiceBatchSize) }
            Write-AgentLog -Level "INFO" -Message ("Dry-run batch plan: customerBatches>={0} (max {1} each), invoiceBatches>={2} (max {3} each), payloadBytes<={4}." -f
                $minimumCustomerBatches,
                $settings.CustomerBatchSize,
                $minimumInvoiceBatches,
                $settings.InvoiceBatchSize,
                $settings.MaxPayloadBytes)
            Write-AgentLog -Level "INFO" -Message "Dry run completed. No API request was sent and state was not advanced."
            return
        }

        $runId = $null
        if (-not [string]::IsNullOrWhiteSpace([string]$state.pendingRunId) -and [string]$state.pendingMode -eq $effectiveMode) {
            $runId = [string]$state.pendingRunId
            Write-AgentLog -Level "INFO" -Message "Resuming the pending idempotent run."
        }
        else {
            $runId = "holoo-{0}-{1}-{2}" -f $env:COMPUTERNAME, (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssfffZ"), ([Guid]::NewGuid().ToString("N").Substring(0, 12))
            $state.pendingRunId = $runId
            $state.pendingMode = $effectiveMode
            Save-AgentState -State $state -StatePath $settings.StatePath
        }

        $client = New-AgentHttpClient -Settings $settings
        try {
            Send-ApiBatches -Client $client -Settings $settings -RunId $runId -SyncMode $effectiveMode -BatchType "customers" -Items $customerResult.Items -BatchSize $settings.CustomerBatchSize
            Send-ApiBatches -Client $client -Settings $settings -RunId $runId -SyncMode $effectiveMode -BatchType "invoices" -Items $invoiceResult.Items -BatchSize $settings.InvoiceBatchSize

            $finishPayload = [ordered]@{
                runId = $runId
                mode = $effectiveMode
                batchType = "finish"
                sourceServer = $settings.Server
                sourceDatabase = $settings.Database
                final = $true
            }
            [void](Invoke-ApiRequestWithRetry -Client $client -Settings $settings -Method "POST" -Payload $finishPayload)
        }
        finally {
            $client.Dispose()
        }

        if ($null -ne $customerResult.MaximumTimestamp) {
            $state.customerWatermark = Convert-ToWatermark $customerResult.MaximumTimestamp
        }
        if ($null -ne $invoiceResult.MaximumTimestamp) {
            $state.invoiceWatermark = Convert-ToWatermark $invoiceResult.MaximumTimestamp
        }
        $state.lastSuccessfulRunId = $runId
        $state.lastSuccessfulMode = $effectiveMode
        $state.lastSuccessfulAt = (Get-Date).ToUniversalTime().ToString("o")
        $state.pendingRunId = $null
        $state.pendingMode = $null
        Save-AgentState -State $state -StatePath $settings.StatePath
        Write-AgentLog -Level "INFO" -Message ("Sync completed successfully. runId={0}." -f $runId)
    }
    finally {
        if ($null -ne $mutex) {
            try {
                $mutex.ReleaseMutex()
            }
            catch {
            }
            $mutex.Dispose()
        }
    }
}

try {
    Invoke-AgentMain
}
catch {
    Write-AgentLog -Level "ERROR" -Message $_.Exception.Message
    throw
}
