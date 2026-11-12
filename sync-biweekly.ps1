param(
  [string]$DbPath = (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "db\aeroad-database.json"),
  [int]$DaysBack = 28
)

$ErrorActionPreference = "Continue"
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$EasaCacheDir = Join-Path $Root "db\easa-pdf-cache"
if (!(Test-Path $EasaCacheDir)) { New-Item -ItemType Directory -Path $EasaCacheDir -Force | Out-Null }

# Load PdfPig if available for verbatim EASA summary extraction
$PdfPigLibDir = Join-Path $Root "tools\pdfpig\lib\net471"
$PdfPigReady = $false
if (Test-Path $PdfPigLibDir) {
  foreach ($dll in (Get-ChildItem $PdfPigLibDir -Filter "*.dll")) {
    try { [System.Reflection.Assembly]::LoadFrom($dll.FullName) | Out-Null } catch {}
  }
  if ($null -ne ("UglyToad.PdfPig.PdfDocument" -as [type])) { $PdfPigReady = $true }
}

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$db = [System.IO.File]::ReadAllText($DbPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json

# Biweekly Calendar Helpers (26 periods/year anchored Jan 1: YYYY-01 .. YYYY-26)
function Get-BiweeklyPeriodInfo([datetime]$dt) {
  $bwNum = [Math]::Min(26, [Math]::Max(1, [int][Math]::Ceiling($dt.DayOfYear / 14.0)))
  $jan1 = [datetime]::new($dt.Year, 1, 1)
  $pStart = $jan1.AddDays(($bwNum - 1) * 14)
  $pEnd = if ($bwNum -lt 26) { $jan1.AddDays($bwNum * 14 - 1) } else { [datetime]::new($dt.Year, 12, 31) }
  return [PSCustomObject]@{
    Year      = $dt.Year
    Period    = $bwNum
    Code      = ("{0}-{1:D2}" -f $dt.Year, $bwNum)
    StartDate = $pStart
    EndDate   = $pEnd
  }
}

function Parse-BiweeklyPeriodCode([string]$code) {
  if ($code -match '^(\d{4})-(\d{2})$') {
    $y = [int]$matches[1]
    $p = [Math]::Min(26, [Math]::Max(1, [int]$matches[2]))
    $jan1 = [datetime]::new($y, 1, 1)
    $pStart = $jan1.AddDays(($p - 1) * 14)
    $pEnd = if ($p -lt 26) { $jan1.AddDays($p * 14 - 1) } else { [datetime]::new($y, 12, 31) }
    return [PSCustomObject]@{
      Year      = $y
      Period    = $p
      Code      = ("{0}-{1:D2}" -f $y, $p)
      StartDate = $pStart
      EndDate   = $pEnd
    }
  }
  return $null
}

function Get-NextBiweeklyCode([string]$code) {
  $info = Parse-BiweeklyPeriodCode $code
  if (-not $info) { return "" }
  if ($info.Period -lt 26) {
    return ("{0}-{1:D2}" -f $info.Year, ($info.Period + 1))
  }
  return ("{0}-01" -f ($info.Year + 1))
}

function Get-BiweeklySequence([string]$startCode, [string]$endCode) {
  $seq = New-Object 'System.Collections.Generic.List[object]'
  $cur = $startCode
  $guard = 0
  while ($cur -and $cur -le $endCode -and $guard -lt 52) {
    $obj = Parse-BiweeklyPeriodCode $cur
    if (-not $obj) { break }
    $seq.Add($obj)
    if ($cur -eq $endCode) { break }
    $cur = Get-NextBiweeklyCode $cur
    $guard++
  }
  return $seq
}

# Build Incremental Biweekly Plan starting from the last recorded scan cursor
$now = Get-Date
$today = $now.Date
$currentBw = Get-BiweeklyPeriodInfo $today
$windowEnd = $today.ToString("yyyy-MM-dd")

$prevReport = $db.lastBiweeklyReport
$lastRecordedBwCode = ""
$lastScannedDate = $null
if ($prevReport) {
  if ($prevReport.lastCompletedBiweekly -and [string]$prevReport.lastCompletedBiweekly -match '^\d{4}-\d{2}$') {
    $lastRecordedBwCode = [string]$prevReport.lastCompletedBiweekly
  } elseif ($prevReport.biweeklyLabel) {
    $bwMatches = [regex]::Matches([string]$prevReport.biweeklyLabel, '\b(20\d{2}-\d{2})\b')
    if ($bwMatches.Count -gt 0) {
      $lastRecordedBwCode = $bwMatches[$bwMatches.Count - 1].Groups[1].Value
    }
  }
  $rawLastDate = if ($prevReport.lastScannedDate) { [string]$prevReport.lastScannedDate } else { [string]$prevReport.windowEnd }
  if ($rawLastDate -match '^(\d{4}-\d{2}-\d{2})$') {
    try {
      $lastScannedDate = [datetime]::ParseExact($matches[1], "yyyy-MM-dd", [System.Globalization.CultureInfo]::InvariantCulture)
      if (-not $lastRecordedBwCode) {
        $lastRecordedBwCode = (Get-BiweeklyPeriodInfo $lastScannedDate).Code
      }
    } catch {}
  }
}

$periodsToScan = New-Object 'System.Collections.Generic.List[object]'
if ($lastRecordedBwCode -and $lastRecordedBwCode -le $currentBw.Code) {
  $lastBwInfo = Parse-BiweeklyPeriodCode $lastRecordedBwCode
  if ($lastRecordedBwCode -eq $currentBw.Code) {
    $scanFrom = if ($lastScannedDate) { $lastScannedDate.AddDays(-3) } else { $currentBw.StartDate }
    if ($scanFrom -lt $currentBw.StartDate.AddDays(-3)) { $scanFrom = $currentBw.StartDate }
    if ($scanFrom -gt $today) { $scanFrom = $today }
    $periodsToScan.Add([PSCustomObject]@{
      Code      = $currentBw.Code
      ScanStart = $scanFrom.ToString("yyyy-MM-dd")
      ScanEnd   = $windowEnd
    })
  } else {
    # Re-scan any remaining/overlap tail of the last recorded biweekly first so mid-period gaps aren't missed
    if ($lastBwInfo) {
      $tailStart = if ($lastScannedDate) { $lastScannedDate.AddDays(-3) } else { $lastBwInfo.StartDate }
      if ($tailStart -lt $lastBwInfo.StartDate) { $tailStart = $lastBwInfo.StartDate }
      if ($tailStart -le $lastBwInfo.EndDate) {
        $periodsToScan.Add([PSCustomObject]@{
          Code      = $lastBwInfo.Code
          ScanStart = $tailStart.ToString("yyyy-MM-dd")
          ScanEnd   = $lastBwInfo.EndDate.ToString("yyyy-MM-dd")
        })
      }
    }
    $nextCode = Get-NextBiweeklyCode $lastRecordedBwCode
    foreach ($p in (Get-BiweeklySequence $nextCode $currentBw.Code)) {
      $pEnd = if ($p.EndDate -gt $today) { $today } else { $p.EndDate }
      $periodsToScan.Add([PSCustomObject]@{
        Code      = $p.Code
        ScanStart = $p.StartDate.ToString("yyyy-MM-dd")
        ScanEnd   = $pEnd.ToString("yyyy-MM-dd")
      })
    }
  }
} else {
  $fallbackStartDt = $today.AddDays(-1 * $DaysBack)
  $startBwInfo = Get-BiweeklyPeriodInfo $fallbackStartDt
  foreach ($p in (Get-BiweeklySequence $startBwInfo.Code $currentBw.Code)) {
    $pStart = if ($p.Code -eq $startBwInfo.Code -and $fallbackStartDt -gt $p.StartDate) { $fallbackStartDt } else { $p.StartDate }
    $pEnd = if ($p.EndDate -gt $today) { $today } else { $p.EndDate }
    $periodsToScan.Add([PSCustomObject]@{
      Code      = $p.Code
      ScanStart = $pStart.ToString("yyyy-MM-dd")
      ScanEnd   = $pEnd.ToString("yyyy-MM-dd")
    })
  }
}

$windowStart = $periodsToScan[0].ScanStart
$firstCode = $periodsToScan[0].Code
$lastCode = $periodsToScan[$periodsToScan.Count - 1].Code
$biweeklyLabel = if ($firstCode -eq $lastCode) {
  "Biweekly $lastCode"
} else {
  "Biweekly $firstCode → $lastCode ($($periodsToScan.Count) kỳ)"
}

$perBwStats = @{}
foreach ($p in $periodsToScan) {
  $perBwStats[$p.Code] = @{
    faaScanned = 0; faaAdded = 0; faaUpdated = 0
    easaScanned = 0; easaAdded = 0; easaUpdated = 0
  }
}

# Build quick lookups of existing ADs & VJC fleet types
$adsList = [System.Collections.ArrayList]@($db.ads)
$byDocNum = @{}
$byFaaNum = @{}
$byEasaNum = @{}
foreach ($a in $adsList) {
  if ($a.docNumber) { $byDocNum[[string]$a.docNumber] = $a }
  if ($a.officialFaaAd) { $byFaaNum[[string]$a.officialFaaAd] = $a }
  if ($a.easaAdNumber) {
    $normE = ([string]$a.easaAdNumber -replace '^EASA\s+(?:PAD|EAD|AD)\s+', '' -replace '\s*\(.*$', '').Trim()
    if ($normE) { $byEasaNum[$normE] = $a }
  }
  if ($a.adNumber -match 'EASA\s+(?:PAD|EAD|AD)\s+([0-9A-Z\-]+)') {
    $byEasaNum[$matches[1]] = $a
  }
}

$fleetTypes = @($db.fleet | ForEach-Object { $_.type } | Select-Object -Unique)

function Evaluate-FleetMatch([string]$text) {
  $matched = New-Object System.Collections.Generic.List[string]
  $u = $text.ToUpper()
  $specA320 = [regex]::IsMatch($u, '\bA320-[0-9]{3}')
  $specA321 = [regex]::IsMatch($u, '\bA321-[0-9]{3}')
  $specA330 = [regex]::IsMatch($u, '\bA330-[0-9]{3}')
  if ($u -match '\bA320-214\b|\bA320-200\b|\bCFM56-5B' -or (-not $specA320 -and $u -match '\b(?:MODEL|ALL)\s+A320\b|\bA320\s+(?:SERIES|FAMILY)\b')) {
    if ($fleetTypes -contains "A320-214") { $matched.Add("A320-214") }
  }
  if ($u -match '\bA321-211\b|\bA321-200\b|\bCFM56-5B' -or (-not $specA321 -and $u -match '\b(?:MODEL|ALL)\s+A321\b|\bA321\s+(?:SERIES|FAMILY)\b')) {
    if ($fleetTypes -contains "A321-211") { $matched.Add("A321-211") }
  }
  if ($u -match '\bA321-271N\b|\bPW1133G|\bPW1100G' -or (-not $specA321 -and $u -match '\b(?:MODEL|ALL)\s+A321\b|\bA321\s+(?:SERIES|FAMILY|NEO)\b')) {
    if ($fleetTypes -contains "A321-271N") { $matched.Add("A321-271N") }
  }
  if ($u -match '\bA321-271NX\b|\bPW1133G|\bPW1100G' -or (-not $specA321 -and $u -match '\b(?:MODEL|ALL)\s+A321\b|\bA321\s+(?:SERIES|FAMILY|NEO)\b')) {
    if ($fleetTypes -contains "A321-271NX") { $matched.Add("A321-271NX") }
  }
  if ($u -match '\bA330-343\b|\bA330-300\b|\bTRENT\s*772|\bTRENT\s*700\b' -or (-not $specA330 -and $u -match '\b(?:MODEL|ALL)\s+A330\b|\bA330\s+(?:SERIES|FAMILY)\b')) {
    if ($fleetTypes -contains "A330-343") { $matched.Add("A330-343") }
  }
  if ($u -match '\bA330-941\b|\bA330-900\b|\bA330NEO\b|\bTRENT\s*7000') {
    if ($fleetTypes -contains "A330-941") { $matched.Add("A330-941") }
  }
  return @($matched | Select-Object -Unique)
}

function ConvertTo-IsoDate([string]$d) {
  if ([string]::IsNullOrWhiteSpace($d)) { return "" }
  if ($d -match '^(\d{4})-(\d{2})-(\d{2})') { return $d.Substring(0,10) }
  if ($d -match '^(\d{2})/(\d{2})/(\d{4})$') { return "$($matches[3])-$($matches[1])-$($matches[2])" }
  return $d
}

$faaScanned = 0; $faaAdded = 0; $faaUpdated = 0
$easaScanned = 0; $easaAdded = 0; $easaUpdated = 0

# ------------------------------------------------------------------------------
# 1. Scan FAA Federal Register Sequentially Across Each Missed Biweekly Window
# ------------------------------------------------------------------------------
try {
  foreach ($bwPeriod in $periodsToScan) {
    $bwCode = $bwPeriod.Code
    $nextUrl = "https://www.federalregister.gov/api/v1/documents.json?per_page=100&order=newest&conditions[agencies][]=federal-aviation-administration&conditions[type][]=RULE&conditions[term]=%22Airworthiness%20Directives%22&conditions[publication_date][gte]=$($bwPeriod.ScanStart)&conditions[publication_date][lte]=$($bwPeriod.ScanEnd)&fields[]=document_number&fields[]=title&fields[]=publication_date&fields[]=effective_on&fields[]=pdf_url&fields[]=html_url&fields[]=abstract&fields[]=docket_ids"
    $pageGuard = 0
    while ($nextUrl -and $pageGuard -lt 5) {
      $pageGuard++
      $frResp = Invoke-RestMethod -Uri $nextUrl -TimeoutSec 25
      if (-not $frResp -or -not $frResp.results) { break }
      $faaScanned += $frResp.results.Count
      $perBwStats[$bwCode].faaScanned += $frResp.results.Count
      foreach ($doc in $frResp.results) {
        if ($doc.title -notmatch "Airworthiness Directives") { continue }
        $docNum = [string]$doc.document_number
        $pubDate = [string]$doc.publication_date
        $effDate = if ($doc.effective_on) { [string]$doc.effective_on } else { $pubDate }
        $abs = [string]$doc.abstract

        $faaNum = ""
        if ($doc.docket_ids) {
          foreach ($dk in $doc.docket_ids) {
            if ([string]$dk -match 'AD\s+([0-9]{4}-[0-9]{2}-[0-9]{2}[A-Z0-9\-]*)') { $faaNum = $matches[1]; break }
          }
        }
        $easaNum = ""
        if ($abs -match 'EASA\s+(?:Emergency\s+)?AD\s+([0-9]{4}-[0-9]{4}[A-Z0-9\-]*)') {
          $easaNum = $matches[1]
        }

        $existing = $null
        if ($byDocNum.ContainsKey($docNum)) { $existing = $byDocNum[$docNum] }
        elseif ($faaNum -and $byFaaNum.ContainsKey($faaNum)) { $existing = $byFaaNum[$faaNum] }

        if ($existing) {
          $changed = $false
          if ($abs -and ([string]$existing.summary -match '^\[(FAA|AMOS)' -or [string]$existing.summary -eq "" -or [string]::IsNullOrWhiteSpace($existing.summary))) {
            $existing.summary = $abs
            $changed = $true
          }
          if (-not $existing.pdfUrl -and $doc.pdf_url) { $existing.pdfUrl = $doc.pdf_url; $changed = $true }
          if ($changed) {
            $faaUpdated++
            $perBwStats[$bwCode].faaUpdated++
          }
          continue
        }

        $mTypes = Evaluate-FleetMatch "$($doc.title) $abs"
        $affFleet = @($db.fleet | Where-Object { $mTypes -contains $_.type } | ForEach-Object {
          [PSCustomObject]@{ reg = $_.reg; msn = $_.msn; type = $_.type; engine = $_.engine }
        })
        $isApp = $affFleet.Count -gt 0
        $dispNum = if ($faaNum -and $easaNum) { "FAA AD $faaNum / EASA AD $easaNum" } elseif ($faaNum) { "FAA AD $faaNum" } else { "FAA FR-$docNum" }

        $parsedSupAds = New-Object 'System.Collections.Generic.List[object]'
        $seenSup = @{}
        $msSup = [regex]::Matches($abs, '(?i)(?:supersed\w*|rescind\w*)\s+(?:Airworthiness\s+Directive\s*(?:\(AD\)\s*)?|AD\s+)+([0-9]{4}-[0-9]{2}-[0-9]{2}[A-Z0-9\-]*)')
        foreach ($mSup in $msSup) {
          $oldF = $mSup.Groups[1].Value.Trim()
          if ($oldF -and $oldF -ne $faaNum -and -not $seenSup.ContainsKey($oldF)) {
            $seenSup[$oldF] = $true
            $parsedSupAds.Add([PSCustomObject]@{
              adNumber = "FAA AD $oldF"
              officialFaaAd = $oldF
              authority = "FAA"
              issuedDate = "Historical"
              effectiveDate = "Superseded"
              subject = "Superseded by FAA AD $faaNum"
              summary = "Superseded by $dispNum ($pubDate)"
              supersededBy = $dispNum
              applicabilityStatus = "Superseded"
              complianceStatus = "Superseded"
            })
          }
        }

        $newFaa = [PSCustomObject]@{
          id = "AUTO-$docNum"
          docNumber = $docNum
          adNumber = $dispNum
          officialFaaAd = $faaNum
          easaAdNumber = if ($easaNum) { "EASA AD $easaNum" } else { "" }
          authority = if ($easaNum) { "EASA" } else { "FAA" }
          authorityDual = if ($easaNum) { "EASA / FAA" } else { "FAA" }
          adClass = "Final Rule AD"
          issuedDate = $pubDate
          issueDate = $pubDate
          effectiveDate = $effDate
          ata = if ("$($doc.title) $abs" -match 'Engine|turbine|HPT|LPT|rotor') { "72 - Engine Turbine / Compressor / Rotor" } else { "05 - Airworthiness Limitations (ALS)" }
          category = if ($doc.title -match 'Engine') { "Engine" } else { "Aircraft" }
          subject = $doc.title
          summary = if ($abs) { $abs } else { $doc.title }
          targetModel = $doc.title
          adExtractedModels = $doc.title
          adExtractedEngines = ""
          adMsnScope = "Theo mục (c) Applicability trong văn bản gốc AD"
          vjcMatchedSummary = if ($isApp) { "Khớp $($affFleet.Count) tàu VJC" } else { "Không khớp biến thể tàu bay / động cơ của VJC" }
          matchedTypes = $mTypes
          applicabilityStatus = if ($isApp) { "Applicable" } else { "Not Applicable" }
          affectedCount = $affFleet.Count
          affectedFleet = $affFleet
          pdfUrl = if ($doc.pdf_url) { $doc.pdf_url } else { "https://www.govinfo.gov/content/pkg/FR-$pubDate/pdf/$docNum.pdf" }
          fullTextHtmlUrl = "https://www.govinfo.gov/content/pkg/FR-$pubDate/html/$docNum.htm"
          sourceUrl = $doc.html_url
          isSuperseded = $false
          supersededAds = $parsedSupAds.ToArray()
          hasSupersededAds = ($parsedSupAds.Count -gt 0)
          supersededCount = $parsedSupAds.Count
        }
        [void]$adsList.Insert(0, $newFaa)
        $byDocNum[$docNum] = $newFaa
        if ($faaNum) { $byFaaNum[$faaNum] = $newFaa }
        if ($easaNum) { $byEasaNum[$easaNum] = $newFaa }
        $faaAdded++
        $perBwStats[$bwCode].faaAdded++
      }
      $nextUrl = if ($frResp.PSObject.Properties.Name -contains 'next_page_url' -and $frResp.next_page_url) { [string]$frResp.next_page_url } else { "" }
    }
  }
} catch {
  Write-Warning "FAA Biweekly scan warning: $_"
}

# ------------------------------------------------------------------------------
# 2. Scan EASA Archive Live (fallback to cached HTML) for Biweekly Window
# ------------------------------------------------------------------------------
$archiveHtml = ""
try {
  $resp = Invoke-WebRequest -Uri "https://www.easa.europa.eu/en/domains/aircraft-products/airworthiness-directives-ad/archive-airworthiness-directives" -UseBasicParsing -TimeoutSec 15 -Headers @{ "User-Agent" = "Mozilla/5.0 AeroAD-Biweekly/1.0" }
  if ($resp.StatusCode -eq 200 -and $resp.Content.Length -gt 100000) {
    $archiveHtml = if ($resp.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($resp.Content) } else { [string]$resp.Content }
    [System.IO.File]::WriteAllText((Join-Path $Root "db\easa-archive-page.html"), $archiveHtml, $Utf8NoBom)
  }
} catch {
  $localArch = Join-Path $Root "db\easa-archive-page.html"
  if (Test-Path $localArch) {
    $archiveHtml = [System.IO.File]::ReadAllText($localArch, [System.Text.Encoding]::UTF8)
  }
}
if (-not $archiveHtml) {
  $localArch = Join-Path $Root "db\easa-archive-page.html"
  if (Test-Path $localArch) {
    $archiveHtml = [System.IO.File]::ReadAllText($localArch, [System.Text.Encoding]::UTF8)
  }
}

if ($archiveHtml) {
  $mJson = [regex]::Match($archiveHtml, '<script type="application/json" data-drupal-selector="drupal-settings-json">(.*?)</script>', [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if ($mJson.Success) {
    $rows = ($mJson.Groups[1].Value | ConvertFrom-Json).easa_datasets.data
    foreach ($r in $rows) {
      $cls = ([string]$r[0]).Trim()
      $num = ([string]$r[1]).Trim()
      if (-not $num -or $cls -eq "AD class" -or $num -eq "Class number") { continue }
      $issIso = ConvertTo-IsoDate ([string]$r[3]).Trim()
      $effIso = ConvertTo-IsoDate ([string]$r[6]).Trim()
      if (-not $issIso -or $issIso -notmatch '^\d{4}-\d{2}-\d{2}') { continue }
      if ($issIso -lt $windowStart -and $effIso -lt $windowStart) { continue }

      $easaScanned++
      $easaBwCode = ""
      try {
        $easaDateRef = if ($issIso -ge $windowStart) { $issIso } elseif ($effIso -match '^\d{4}-\d{2}-\d{2}$') { $effIso } else { $issIso }
        $eDt = [datetime]::ParseExact($easaDateRef, "yyyy-MM-dd", [System.Globalization.CultureInfo]::InvariantCulture)
        $candCode = (Get-BiweeklyPeriodInfo $eDt).Code
        if ($perBwStats.ContainsKey($candCode)) { $easaBwCode = $candCode }
      } catch {}
      if ($easaBwCode) { $perBwStats[$easaBwCode].easaScanned++ }

      $url = if ($r[2] -match 'href="([^"]+)"') { "https://www.easa.europa.eu" + $matches[1] } else { "" }
      $subj = (([string]$r[4]) -replace '\s+', ' ').Trim()
      $models = (([string]$r[5]) -replace '\s+', ' ').Trim()

      if ($num -match '^US-(.+)$' -and $byFaaNum.ContainsKey($matches[1])) {
        $exFaa = $byFaaNum[$matches[1]]
        if ($url -and -not $exFaa.easaUrl) {
          $exFaa | Add-Member -MemberType NoteProperty -Name "easaUrl" -Value $url -Force
          $easaUpdated++
          if ($easaBwCode) { $perBwStats[$easaBwCode].easaUpdated++ }
        }
        continue
      }

      if ($byEasaNum.ContainsKey($num)) {
        $ex = $byEasaNum[$num]
        $ch = $false
        if ($url -and ($ex.easaUrl -notlike "*AD-tmp-storage*" -or -not $ex.easaUrl)) {
          $ex | Add-Member -MemberType NoteProperty -Name "easaUrl" -Value $url -Force
          if ($ex.authority -eq "EASA") { $ex.pdfUrl = $url }
          $ch = $true
        }
        if ($issIso -and -not $ex.easaIssuedDate) { $ex | Add-Member -MemberType NoteProperty -Name "easaIssuedDate" -Value $issIso -Force; $ch = $true }
        if ($effIso -and -not $ex.easaEffectiveDate) { $ex | Add-Member -MemberType NoteProperty -Name "easaEffectiveDate" -Value $effIso -Force; $ch = $true }
        if ($ch) {
          $easaUpdated++
          if ($easaBwCode) { $perBwStats[$easaBwCode].easaUpdated++ }
        }
        continue
      }

      # Skip already-superseded notice rows unless needed; add active/EAD/PAD/CN EASA ADs
      $prefix = if ($cls -eq "PAD") { "EASA PAD" } elseif ($cls -eq "EAD") { "EASA EAD" } else { "EASA AD" }
      $dispNum = "$prefix $num"
      $mTypes = Evaluate-FleetMatch "$subj $models"
      $affFleet = @($db.fleet | Where-Object { $mTypes -contains $_.type } | ForEach-Object {
        [PSCustomObject]@{ reg = $_.reg; msn = $_.msn; type = $_.type; engine = $_.engine }
      })
      $isApp = $affFleet.Count -gt 0

      $richSum = "[$dispNum | Issued: $issIso | Effective: $effIso] $subj. Applies to: $models"
      $pdfEffRaw = ""
      if ($PdfPigReady -and ($isApp -or $cls -eq "PAD" -or -not $effIso) -and $url -like "*.pdf") {
        try {
          $pdfLocal = Join-Path $EasaCacheDir (([System.IO.Path]::GetFileName(($url -split '\?')[0])) -replace '[^A-Za-z0-9_.\-]', '_')
          if (-not (Test-Path $pdfLocal)) {
            $req = [System.Net.HttpWebRequest]::Create($url)
            $req.Timeout = 8000
            $req.ReadWriteTimeout = 8000
            $req.UserAgent = "Mozilla/5.0 AeroAD-Biweekly/1.0"
            $rPdf = $req.GetResponse()
            $sPdf = $rPdf.GetResponseStream()
            $fPdf = [System.IO.File]::Create($pdfLocal)
            try { $sPdf.CopyTo($fPdf) } finally { $fPdf.Dispose(); $sPdf.Dispose(); $rPdf.Close() }
          }
          $docPdf = [UglyToad.PdfPig.PdfDocument]::Open($pdfLocal)
          try {
            $allW = (($docPdf.GetPages() | ForEach-Object { ($_.GetWords() | ForEach-Object { $_.Text }) -join " " }) -join " ")
            $allW = [regex]::Replace($allW, 'Page \d+ of \d+\s+TE\.CAP\.\d+-\d+.*?An agency of the European Union', ' ', [System.Text.RegularExpressions.RegexOptions]::Singleline)
            $allW = [regex]::Replace($allW, 'TE\.CAP\.\d+-\d+.*?An agency of the European Union', ' ', [System.Text.RegularExpressions.RegexOptions]::Singleline)
            $allW = ($allW -replace '\s+', ' ').Trim()
            $mEff = [regex]::Match($allW, '(?i)Effective\s+Date\s*:\s*(.+?)(?=\s*(?:TCDS|ETSO|EASA|Foreign\s+AD|Supersedure|Comments\s+on|Publication|ATA\s+\d+|Manufacturer|$))')
            if ($mEff.Success -and $mEff.Groups[1].Value -match 'TBD|standard:') {
              $pdfEffRaw = $mEff.Groups[1].Value.Trim()
            }
            $mApp = [regex]::Match($allW, 'Applicability:\s*(.+?)(?=\s*(?:Definitions:|Reason:|Required Action\(s\)|Ref\. Publications:|$))')
            $mR = [regex]::Match($allW, 'Reason:\s*(.+?)(?=\s*(?:Required Action\(s\) and Compliance Time\(s\):|Required Action\(s\):|Ref\. Publications:|$))')
            $parts = @()
            if ($mApp.Success) { $parts += "Applicability: $($mApp.Groups[1].Value.Trim())" }
            if ($mR.Success) { $parts += "Reason: $($mR.Groups[1].Value.Trim())" }
            if ($parts.Count -gt 0) {
              $richSum = $parts -join "`n`n"
            }
          } finally { $docPdf.Dispose() }
        } catch {}
      }
      $finalEff = if ($pdfEffRaw) { $pdfEffRaw } elseif ($effIso) { $effIso } elseif ($cls -eq "PAD") { "[TBD - standard: 14 days after AD issue date]" } else { $issIso }

      $newEasa = [PSCustomObject]@{
        id = "EASA-BW-$($num -replace '[^A-Za-z0-9\-]', '_')"
        adNumber = $dispNum
        authority = "EASA"
        authorityDual = "EASA"
        adClass = if ($cls -eq "PAD") { "Proposed AD (PAD)" } elseif ($cls -eq "EAD") { "Emergency AD" } else { "Airworthiness Directive" }
        officialFaaAd = ""
        easaAdNumber = $dispNum
        easaUrl = $url
        pdfUrl = $url
        sourceUrl = "https://www.easa.europa.eu/en/domains/aircraft-products/airworthiness-directives-ad/archive-airworthiness-directives"
        issuedDate = $issIso
        issueDate = $issIso
        effectiveDate = $finalEff
        easaIssuedDate = $issIso
        easaEffectiveDate = $finalEff
        ata = if ($subj -match '\b(Engine Oil|Engine –|Turbine|HPT|LPT|CFM56|Trent\s*7|Trent\s*1000|PW11)\b' -and $models -notmatch 'HELICOPTER|Main Rotor|Tail Rotor') { "72 - Engine (Turbine / Turboprop)" } else { "05 - Airworthiness Limitations (ALS)" }
        category = if ($subj -match '\b(Engine Oil|Engine –|Turbine|HPT|LPT|CFM56|Trent\s*7|Trent\s*1000|PW11)\b' -and $models -notmatch 'HELICOPTER') { "Engine" } else { "Aircraft" }
        subject = $subj
        easaSubject = $subj
        summary = $richSum
        easaSummary = $richSum
        targetModel = $models
        adExtractedModels = $models
        easaModels = $models
        adExtractedEngines = ""
        adMsnScope = "Theo mục Applicability trong EASA AD"
        vjcMatchedSummary = if ($isApp) { "Khớp $($affFleet.Count) tàu VJC" } else { "Không khớp biến thể tàu bay / động cơ của VJC" }
        matchedTypes = $mTypes
        applicabilityStatus = if ($isApp) { "Applicable" } else { "Not Applicable" }
        affectedCount = $affFleet.Count
        affectedFleet = $affFleet
        isSuperseded = ($subj -match '^SUPERSEDED BY')
        supersededAds = @()
      }
      [void]$adsList.Insert(0, $newEasa)
      $byEasaNum[$num] = $newEasa
      $easaAdded++
      if ($easaBwCode) { $perBwStats[$easaBwCode].easaAdded++ }
    }
  }
}

$scannedAtStr = (Get-Date).ToString("dd/MM/yyyy HH:mm:ss")
$perBwList = @(
  foreach ($p in $periodsToScan) {
    $st = $perBwStats[$p.Code]
    [PSCustomObject]@{
      biweekly    = $p.Code
      windowStart = $p.ScanStart
      windowEnd   = $p.ScanEnd
      faaScanned  = $st.faaScanned
      faaAdded    = $st.faaAdded
      faaUpdated  = $st.faaUpdated
      easaScanned = $st.easaScanned
      easaAdded   = $st.easaAdded
      easaUpdated = $st.easaUpdated
    }
  }
)
$report = [PSCustomObject]@{
  biweeklyLabel         = $biweeklyLabel
  previousBiweekly      = $lastRecordedBwCode
  lastCompletedBiweekly = $currentBw.Code
  lastScannedDate       = $windowEnd
  biweeklySequence      = @($periodsToScan | ForEach-Object { $_.Code })
  perBiweeklyStats      = $perBwList
  windowStart           = $windowStart
  windowEnd             = $windowEnd
  scannedAt             = $scannedAtStr
  faaScanned            = $faaScanned
  faaAdded              = $faaAdded
  faaUpdated            = $faaUpdated
  easaScanned           = $easaScanned
  easaAdded             = $easaAdded
  easaUpdated           = $easaUpdated
}

$db.ads = @($adsList)
$db | Add-Member -MemberType NoteProperty -Name "lastSyncedAt" -Value $scannedAtStr -Force
$db | Add-Member -MemberType NoteProperty -Name "lastBiweeklyReport" -Value $report -Force

[System.IO.File]::WriteAllText($DbPath, ($db | ConvertTo-Json -Depth 12 -Compress), $Utf8NoBom)

$partsScript = Join-Path $PSScriptRoot "sync-easa-parts-and-superseded.ps1"
if (Test-Path $partsScript) {
  try { & $partsScript -UseLiveArchive $false } catch { Write-Warning "Post-sync consolidation warning: $_" }
}

Write-Host ("BIWEEKLY_SYNC_OK | {0} ({1} -> {2}) | FAA: +{3} new, {4} updated (scanned {5}) | EASA: +{6} new, {7} updated (scanned {8})" -f $biweeklyLabel, $windowStart, $windowEnd, $faaAdded, $faaUpdated, $faaScanned, $easaAdded, $easaUpdated, $easaScanned)
