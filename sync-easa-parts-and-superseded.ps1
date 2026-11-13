param(
  [bool]$UseLiveArchive = $false
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$dbPath = Join-Path $root "db\aeroad-database.json"
$txtDir = Join-Path $root "db\easa-pdf-cache"
$archPath = Join-Path $root "db\easa-archive-page.html"

Write-Host "[1/4] Loading database & EASA Archive..."
$db = [System.IO.File]::ReadAllText($dbPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json

$archHtml = ""
if ($UseLiveArchive -or -not (Test-Path $archPath)) {
  try {
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
    $resp = Invoke-WebRequest -Uri "https://www.easa.europa.eu/en/domains/aircraft-products/airworthiness-directives-ad/archive-airworthiness-directives" -UseBasicParsing -TimeoutSec 25 -Headers @{ "User-Agent" = "Mozilla/5.0 AeroAD/1.0" }
    $archHtml = if ($resp.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($resp.Content) } else { [string]$resp.Content }
    if ($archHtml -and $archHtml.Length -gt 20000) {
      [System.IO.File]::WriteAllText($archPath, $archHtml, (New-Object System.Text.UTF8Encoding($false)))
    }
  } catch {
    Write-Warning "Could not fetch live EASA Archive, falling back to local snapshot: $_"
  }
}
if (-not $archHtml -or $archHtml.Length -lt 10000) {
  if (Test-Path $archPath) {
    $archHtml = [System.IO.File]::ReadAllText($archPath, [System.Text.Encoding]::UTF8)
  }
}

function Convert-EasaDateToIso([string]$s) {
  if (-not $s) { return "" }
  $t = $s.Trim()
  if ($t -match '^(\d{2})/(\d{2})/(\d{4})$') {
    return "$($Matches[3])-$($Matches[1])-$($Matches[2])"
  }
  if ($t -match '^\d{4}-\d{2}-\d{2}$') { return $t }
  try {
    $dt = [datetime]::Parse($t, [System.Globalization.CultureInfo]::InvariantCulture)
    return $dt.ToString("yyyy-MM-dd")
  } catch {
    return $t
  }
}

$arcByNum = @{}
$arcByBase = @{}
$mJson = [regex]::Match($archHtml, '<script type="application/json" data-drupal-selector="drupal-settings-json">(.*?)</script>', [System.Text.RegularExpressions.RegexOptions]::Singleline)
if ($mJson.Success) {
  $rows = ($mJson.Groups[1].Value | ConvertFrom-Json).easa_datasets.data
  foreach ($r in $rows) {
    $num = ([string]$r[1]).Trim()
    if (-not $num) { continue }
    $url = if ($r[2] -match 'href="([^"]+)"') {
      $u = $Matches[1].Trim()
      if ($u -match '^/') { "https://www.easa.europa.eu$u" } else { $u }
    } else { "" }
    $entry = [PSCustomObject]@{
      cls     = ([string]$r[0]).Trim()
      num     = $num
      url     = $url
      issRaw  = ([string]$r[3]).Trim()
      issIso  = Convert-EasaDateToIso ([string]$r[3])
      subj    = (([string]$r[4]) -replace '\s+', ' ').Trim()
      models  = (([string]$r[5]) -replace '\s+', ' ').Trim()
      effRaw  = ([string]$r[6]).Trim()
      effIso  = Convert-EasaDateToIso ([string]$r[6])
    }
    $arcByNum[$num] = $entry
    $baseNum = ($num -replace '(R\d+|-E|-CN)$', '')
    if (-not $arcByBase.ContainsKey($baseNum)) {
      $arcByBase[$baseNum] = $entry
    }
  }
}
Write-Host "Loaded EASA Archive entries: $($arcByNum.Count)"

function Find-ArcEntry([string]$eNum) {
  if (-not $eNum) { return $null }
  if ($arcByNum.ContainsKey($eNum)) { return $arcByNum[$eNum] }
  $noRev = ($eNum -replace '(R\d+|-E|-CN)$', '')
  if ($arcByBase.ContainsKey($noRev)) { return $arcByBase[$noRev] }
  return $null
}

function Get-SupByFromSubj([string]$subj) {
  if (-not $subj) { return "" }
  $m = [regex]::Match($subj, '(?i)SU[PB]ERSEDED\s+BY\s+(?:EASA\s+)?(?:EMERGENCY\s+)?(?:AD|EAD|PAD)?\s*([A-Z]?-?\d{4}-\d{3,4}[A-Za-z0-9\-]*)')
  if ($m.Success) { return $m.Groups[1].Value.Trim() }
  return ""
}

function Clean-EasaTxt([string]$raw) {
  if (-not $raw) { return "" }
  $t = $raw -replace '---\s*PAGE\s*\d+\s*---', ' '
  $t = $t -replace 'TE\.CAP\.00\d+-\d+\s*©\s*European Union Aviation Safety Agency\.\s*All rights reserved\..*?(?:An agency of the European Union|European Union)', ' '
  $t = $t -replace 'Page\s+\d+\s+of\s+\d+', ' '
  $t = $t -replace '\bEASA\s+AD\s+No\.:\s*\d{4}-\d{4}[A-Za-z0-9\-]*', ' '
  $t = $t -replace '\s+', ' '
  return $t.Trim()
}

function Extract-AffectedPartFromTxt([string]$txt) {
  $clean = Clean-EasaTxt $txt
  if (-not $clean) { return "" }
  $stopLookahead = '(?=\s+(?:Affected\s+(?:aeroplane|engine|helicopter|rotorcraft|aircraft|system|MLG\s+door|door|structure|part|component|assembly|unit)|Serviceable|Applicable\s+(?:aeroplane|modification|engine|part)|Eligible|Approved|Qualified|Known|Removed|Group\s+[A-Z0-9]|Batch\s+\d+|The\s+(?:SB|AOT|NMSB|NMSBs|SL|SIL|AMOC|AD)\s*:|NSO\s*:|SIL/SB\s*:|EGNOS\b|Note\s+\d+\s*:|Reason\s*:|Required\s+Action|Ref\.\s*Publications|Remarks\s*:|\.\s+[A-Z][A-Za-z0-9/()\- ]{2,34}\s*:\s|$))'
  
  $pattern = '(?i)\b(Affected\s+(?:parts?|components?|assembl(?:y|ies)|units?)(?:\s+[0-9A-Za-z]+)?)\s*:\s*(.+?)' + $stopLookahead
  
  $matches = [regex]::Matches($clean, $pattern)
  if ($matches.Count -eq 0) {
    $patternFallback = "(?i)\bAffected\s+parts?(?:\(s\))?\s*:\s*(.+?)$stopLookahead"
    $m = [regex]::Match($clean, $patternFallback)
    if ($m.Success) {
      $v = $m.Groups[1].Value.Trim().TrimEnd(' ', ';')
      if ($v.Length -gt 550) { $v = $v.Substring(0, 550) + "..." }
      return $v
    }
    return ""
  }

  $partsList = [System.Collections.ArrayList]@()
  foreach ($m in $matches) {
    $label = $m.Groups[1].Value.Trim()
    $val = $m.Groups[2].Value.Trim().TrimEnd(' ', ';')
    if ($val.Length -ge 4) {
      [void]$partsList.Add("${label}: $val")
    }
  }

  $combined = $partsList -join " | "
  if ($combined.Length -gt 650) {
    $cut = $combined.Substring(0, 650)
    $lastSpace = $cut.LastIndexOf(' ')
    if ($lastSpace -gt 350) { $cut = $cut.Substring(0, $lastSpace) }
    $combined = "$cut..."
  }
  return $combined
}

Write-Host "[2/4] Extracting Affected part(s) & PAD Effective Dates from EASA PDF cache..."
$pdfPigLibDir = Join-Path $root "tools\pdfpig\lib\net471"
$pdfPigReady = $false
if (Test-Path $pdfPigLibDir) {
  foreach ($dll in (Get-ChildItem $pdfPigLibDir -Filter "*.dll")) {
    try { [System.Reflection.Assembly]::LoadFrom($dll.FullName) | Out-Null } catch {}
  }
  if ($null -ne ("UglyToad.PdfPig.PdfDocument" -as [type])) { $pdfPigReady = $true }
}

$txtIndex = @{}
Get-ChildItem $txtDir -Filter *.txt -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.BaseName -match '(\d{4})[_-](\d{4})([_A-Za-z0-9]*)') {
    $canon = "$($Matches[1])-$($Matches[2])$($Matches[3] -replace '_superseded|_cancelled','' -replace '_','-')"
    $base  = "$($Matches[1])-$($Matches[2])"
    if (-not $txtIndex.ContainsKey($canon)) { $txtIndex[$canon] = $_.FullName }
    if (-not $txtIndex.ContainsKey($base))  { $txtIndex[$base]  = $_.FullName }
    $noDash = "$($Matches[1])-$($Matches[2])$($Matches[3] -replace '_superseded|_cancelled','' -replace '_','')"
    if (-not $txtIndex.ContainsKey($noDash)) { $txtIndex[$noDash] = $_.FullName }
  }
}

$affectedPartCount = 0
$padEffUpdatedCount = 0
foreach ($ad in $db.ads) {
  $eNum = ""
  if ($ad.easaAdNumber -match '(\d{4}-\d{4}[A-Za-z0-9\-]*)') { $eNum = $Matches[1] }
  elseif ($ad.adNumber -match 'EASA\s+(?:AD|EAD|PAD)\s+(\d{4}-\d{4}[A-Za-z0-9\-]*)') { $eNum = $Matches[1] }

  $txtFile = $null
  $pdfFile = $null
  if ($ad.easaUrl -match '/([^/]+)\.pdf') {
    $basePdfName = $Matches[1]
    $candTxt = Join-Path $txtDir ($basePdfName + ".txt")
    $candPdf = Join-Path $txtDir ($basePdfName + ".pdf")
    if (Test-Path $candTxt) { $txtFile = $candTxt }
    if (Test-Path $candPdf) { $pdfFile = $candPdf }
  }
  if (-not $txtFile -and $eNum) {
    $c1 = $eNum
    $c2 = ($eNum -replace '(R\d+|-E|-CN)$', '')
    if ($txtIndex.ContainsKey($c1)) { $txtFile = $txtIndex[$c1] }
    elseif ($txtIndex.ContainsKey($c2)) { $txtFile = $txtIndex[$c2] }
  }

  $rawTxt = ""
  if ($txtFile -and (Test-Path $txtFile)) {
    $rawTxt = [System.IO.File]::ReadAllText($txtFile, [System.Text.Encoding]::UTF8)
  } elseif ($pdfPigReady -and $pdfFile -and (Test-Path $pdfFile)) {
    try {
      $docPdf = [UglyToad.PdfPig.PdfDocument]::Open($pdfFile)
      try {
        $pages = New-Object 'System.Collections.Generic.List[string]'
        $pIdx = 0
        foreach ($pg in $docPdf.GetPages()) {
          $pIdx++
          $pgTxt = ($pg.GetWords() | ForEach-Object { $_.Text }) -join " "
          $pages.Add("--- PAGE $pIdx ---`n$pgTxt")
        }
        $rawTxt = $pages -join "`n`n"
        if ($rawTxt.Trim()) {
          $saveTxtPath = [System.IO.Path]::ChangeExtension($pdfFile, ".txt")
          [System.IO.File]::WriteAllText($saveTxtPath, $rawTxt, (New-Object System.Text.UTF8Encoding($false)))
        }
      } finally { $docPdf.Dispose() }
    } catch {}
  }

  $affPart = if ($rawTxt) { Extract-AffectedPartFromTxt $rawTxt } else { "" }
  if ($ad.PSObject.Properties['adAffectedPart']) {
    $ad.adAffectedPart = $affPart
  } else {
    $ad | Add-Member -NotePropertyName 'adAffectedPart' -NotePropertyValue $affPart
  }
  if ($affPart) { $affectedPartCount++ }

  # Extract Effective Date directly from PDF for PADs or pending/TBD records
  $isPad = ("$($ad.adNumber) $($ad.easaAdNumber) $($ad.easaUrl)" -match '\bPAD\b|EASA_PAD_')
  if ($isPad -or "$($ad.effectiveDate)" -match 'Pending|TBD') {
    $effRaw = ""
    if ($rawTxt) {
      $cleanTxt = Clean-EasaTxt $rawTxt
      $mEff = [regex]::Match($cleanTxt, '(?i)Effective\s+Date\s*:\s*(.+?)(?=\s*(?:TCDS|ETSO|EASA|Foreign\s+AD|Supersedure|Comments\s+on|Publication|ATA\s+\d+|Manufacturer|$))')
      if ($mEff.Success) { $effRaw = $mEff.Groups[1].Value.Trim() }
    }
    if (-not $effRaw -and $isPad) {
      $effRaw = "[TBD - standard: 14 days after AD issue date]"
    }
    if ($effRaw -match 'TBD|standard:') {
      $ad.effectiveDate = $effRaw
      if ($ad.PSObject.Properties['easaEffectiveDate']) { $ad.easaEffectiveDate = $effRaw }
      else { $ad | Add-Member -NotePropertyName 'easaEffectiveDate' -NotePropertyValue $effRaw }
      $padEffUpdatedCount++
    }
    if ($isPad -and -not $ad.adClass) {
      if ($ad.PSObject.Properties['adClass']) { $ad.adClass = "Proposed AD (PAD)" }
      else { $ad | Add-Member -NotePropertyName 'adClass' -NotePropertyValue "Proposed AD (PAD)" }
    }
    if ($rawTxt -and ($isPad -or -not $ad.adApplicabilityText)) {
      $cleanTxt = Clean-EasaTxt $rawTxt
      $mApp = [regex]::Match($cleanTxt, '(?i)Applicability\s*:\s*(.+?)(?=\s*(?:Definitions\s*:|Reason\s*:|Required\s+Action|Ref\.\s*Publications|Remarks\s*:|$))')
      if ($mApp.Success -and (-not $ad.adApplicabilityText)) {
        $appVal = $mApp.Groups[1].Value.Trim()
        if ($ad.PSObject.Properties['adApplicabilityText']) { $ad.adApplicabilityText = $appVal }
        else { $ad | Add-Member -NotePropertyName 'adApplicabilityText' -NotePropertyValue $appVal }
      }
      $mRsn = [regex]::Match($cleanTxt, '(?i)Reason\s*:\s*(.+?)(?=\s*(?:Required\s+Action\(s\)|Required\s+Action\s*:|Ref\.\s*Publications|Remarks\s*:|$))')
      if ($mRsn.Success -and ("$($ad.summary)" -match '^\[EASA\s+PAD|^\s*$')) {
        $rsnVal = "Reason: " + $mRsn.Groups[1].Value.Trim()
        $ad.summary = $rsnVal
        if ($ad.PSObject.Properties['easaSummary']) { $ad.easaSummary = $rsnVal }
      }
    }
  }
}
Write-Host "Updated PAD/TBD Effective Dates on $padEffUpdatedCount ADs."
Write-Host "Extracted non-empty adAffectedPart on $affectedPartCount ADs."

Write-Host "[3/4] Resolving Superseded EASA ADs & folding into active superseding ADs..."
# Map base/exact EASA AD -> active top-level AD candidates
$topByEasa = @{}
foreach ($ad in $db.ads) {
  $eNum = ""
  if ($ad.easaAdNumber -match '(\d{4}-\d{4}[A-Za-z0-9\-]*)') { $eNum = $Matches[1] }
  elseif ($ad.adNumber -match 'EASA\s+(?:AD|EAD|PAD)\s+(\d{4}-\d{4}[A-Za-z0-9\-]*)') { $eNum = $Matches[1] }
  elseif ($ad.adNumber -match 'State AD\s+([A-Z]-\d{4}-\d{3,4}[A-Za-z0-9\-]*)') { $eNum = $Matches[1] }
  if (-not $eNum -and "$($ad.easaUrl) $($ad.pdfUrl)" -notmatch '_superseded\.pdf|_cancelled\.pdf') { continue }
  foreach ($k in @($eNum, ($eNum -replace '(R\d+|-E|-CN)$', ''))) {
    if (-not $topByEasa.ContainsKey($k)) { $topByEasa[$k] = @() }
    $topByEasa[$k] += $ad
  }
}

function Find-ActiveTargetAd([string]$eNum, $arcByNum, $topByEasa) {
  $cur = $eNum
  $visited = @{}
  for ($hop = 0; $hop -lt 15; $hop++) {
    if (-not $cur -or $visited.ContainsKey($cur)) { break }
    $visited[$cur] = $true
    $arc = Find-ArcEntry $cur
    if ($arc) {
      $next = Get-SupByFromSubj $arc.subj
      if ($next) {
        $cur = $next
        continue
      }
    }
    break
  }
  $termNum = $cur
  $cands = @()
  if ($topByEasa.ContainsKey($termNum)) { $cands = $topByEasa[$termNum] }
  elseif ($topByEasa.ContainsKey(($termNum -replace '(R\d+|-E|-CN)$', ''))) {
    $cands = $topByEasa[($termNum -replace '(R\d+|-E|-CN)$', '')]
  }
  $pick = $cands | Where-Object { -not ("$($_.easaUrl) $($_.pdfUrl)" -match '_superseded\.pdf') } | Select-Object -First 1
  if (-not $pick) { $pick = $cands | Select-Object -First 1 }
  return [PSCustomObject]@{ TerminalNum = $termNum; TargetAd = $pick }
}

function Evaluate-VjcMatchForTarget([string]$text, $fleet) {
  $types = New-Object 'System.Collections.Generic.List[string]'
  $t = $text
  if (-not $t) { return @() }
  if ($t -match '\bA320\b|A320-214|CFM56-5B') { $types.Add("A320-214") }
  if ($t -match '\bA321\b|A321-211|A321-231|V2500') { $types.Add("A321-211") }
  if ($t -match '\bA321\b|A321-271N\b|A321neo|A321-251|PW1100G|PW1133G') { $types.Add("A321-271N") }
  if ($t -match '\bA321\b|A321-271NX|A321neo|PW1100G|PW1133G') { $types.Add("A321-271NX") }
  if ($t -match '\bA330\b|A330-343|Trent\s*700\b|RB211[\s\-]*Trent\s*7') { $types.Add("A330-343") }
  if ($t -match 'A330-941|A330neo|Trent\s*7000') { $types.Add("A330-941") }
  return $types.ToArray()
}

function Enrich-TargetFromPdf([object]$targetAd, [string]$url) {
  if (-not $pdfPigReady -or -not $url -or $url -notlike "*.pdf") { return }
  try {
    $fileName = (([System.IO.Path]::GetFileName(($url -split '\?')[0])) -replace '[^A-Za-z0-9_.\-]', '_')
    $pdfLocal = Join-Path $txtDir $fileName
    $txtLocal = [System.IO.Path]::ChangeExtension($pdfLocal, ".txt")
    if (-not (Test-Path $txtLocal)) {
      if (-not (Test-Path $pdfLocal)) {
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
        $req = [System.Net.HttpWebRequest]::Create($url)
        $req.Timeout = 10000; $req.ReadWriteTimeout = 10000; $req.UserAgent = "Mozilla/5.0 AeroAD/1.0"
        $resp = $req.GetResponse(); $s = $resp.GetResponseStream(); $fs = [System.IO.File]::Create($pdfLocal)
        try { $s.CopyTo($fs) } finally { $fs.Dispose(); $s.Dispose(); $resp.Close() }
      }
      if (Test-Path $pdfLocal) {
        $docPdf = [UglyToad.PdfPig.PdfDocument]::Open($pdfLocal)
        try {
          $pages = New-Object 'System.Collections.Generic.List[string]'
          $pIdx = 0
          foreach ($pg in $docPdf.GetPages()) {
            $pIdx++
            $pages.Add("--- PAGE $pIdx ---`n" + (($pg.GetWords() | ForEach-Object { $_.Text }) -join " "))
          }
          $rawT = $pages -join "`n`n"
          if ($rawT.Trim()) { [System.IO.File]::WriteAllText($txtLocal, $rawT, (New-Object System.Text.UTF8Encoding($false))) }
        } finally { $docPdf.Dispose() }
      }
    }
    if (Test-Path $txtLocal) {
      $rawTxt = [System.IO.File]::ReadAllText($txtLocal, [System.Text.Encoding]::UTF8)
      $cleanTxt = Clean-EasaTxt $rawTxt
      $affP = Extract-AffectedPartFromTxt $rawTxt
      if ($affP) { Set-SafeProp $targetAd 'adAffectedPart' $affP }
      $mApp = [regex]::Match($cleanTxt, '(?i)Applicability\s*:\s*(.+?)(?=\s*(?:Definitions\s*:|Reason\s*:|Required\s+Action|Ref\.\s*Publications|Remarks\s*:|$))')
      if ($mApp.Success) {
        $appVal = $mApp.Groups[1].Value.Trim()
        Set-SafeProp $targetAd 'adApplicabilityText' $appVal
      }
      $mRsn = [regex]::Match($cleanTxt, '(?i)Reason\s*:\s*(.+?)(?=\s*(?:Required\s+Action\(s\)|Required\s+Action\s*:|Ref\.\s*Publications|Remarks\s*:|$))')
      if ($mRsn.Success) {
        $rsnVal = "Reason: " + $mRsn.Groups[1].Value.Trim()
        $targetAd.summary = $rsnVal
      }
      $mTyp = [regex]::Match($cleanTxt, '(?i)Type/Model\s+designation\(s\)\s*:\s*(.+?)(?=\s*(?:Effective\s+Date\s*:|TCDS|ETSO|EASA|Foreign\s+AD|$))')
      if ($mTyp.Success) {
        $modVal = $mTyp.Groups[1].Value.Trim()
        $targetAd.adExtractedModels = $modVal
        $targetAd.targetModel = $modVal
      }
    }
  } catch {}
}

function New-AdFromArchive([string]$termNum, $arc, $dbFleet) {
  $iss = if ($arc.issIso) { $arc.issIso } else { "2026-01-01" }
  $eff = if ($arc.effIso) { $arc.effIso } else { $iss }
  $subj = if ($arc.subj) { $arc.subj } else { "EASA AD $termNum" }
  $mods = if ($arc.models) { $arc.models } else { "" }
  $mTypes = @(Evaluate-VjcMatchForTarget "$mods $subj" $dbFleet)
  $affFleet = @($dbFleet | Where-Object { $mTypes -contains $_.type } | ForEach-Object {
    [PSCustomObject]@{ reg = $_.reg; msn = $_.msn; type = $_.type; engine = $_.engine }
  })
  $isApp = $affFleet.Count -gt 0
  $newObj = [PSCustomObject]@{
    id                    = "AMOS-EASA-$termNum"
    adNumber              = "EASA AD $termNum"
    easaAdNumber          = "EASA AD $termNum"
    officialFaaAd         = ""
    docNumber             = $termNum
    authority             = "EASA"
    adClass               = if ($termNum -match '-E$') { "Emergency AD" } else { "Emergency / Mandatory AD" }
    category              = if ($mods -match 'Engine|CFM|PW1|Trent|V2500|LEAP') { "Engine" } else { "Airframe" }
    ata                   = if ($subj -match 'ATA\s*(\d{2})') { "ATA $($Matches[1])" } else { "ATA 05" }
    subject               = $subj
    summary               = "$mods`n$subj"
    issuedDate            = $iss
    issueDate             = $iss
    effectiveDate         = $eff
    targetModel           = $mods
    adExtractedModels     = $mods
    adExtractedEngines    = ""
    adApplicabilityText   = ""
    adMsnScope            = ""
    adAffectedPart        = ""
    matchedTypes          = $mTypes
    affectedFleet         = $affFleet
    affectedCount         = $affFleet.Count
    vjcMatchedSummary     = if ($isApp) { "Khớp $($affFleet.Count) tàu VJC" } else { "Không khớp biến thể tàu bay / động cơ của VJC" }
    applicabilityStatus   = if ($isApp) { "Applicable" } else { "Not Applicable" }
    complianceStatus      = if ($isApp) { "Required" } else { "Not Applicable" }
    complianceTime        = "See EASA AD $termNum"
    repetitiveInterval    = "N/A"
    pdfUrl                = $arc.url
    easaUrl               = $arc.url
    sourceUrl             = "https://www.easa.europa.eu/en/domains/aircraft-products/airworthiness-directives-ad/archive-airworthiness-directives"
    fullTextHtmlUrl       = ""
    supersededBy          = ""
    supersededAds         = @()
    hasSupersededAds      = $false
    supersededCount       = 0
  }
  if ($isApp) { Enrich-TargetFromPdf $newObj $arc.url }
  return $newObj
}

function Convert-AdToSupersededItem($oldAd, [string]$termAdNumber) {
  return [PSCustomObject]@{
    adNumber            = $oldAd.adNumber
    docNumber           = if ($oldAd.docNumber) { $oldAd.docNumber } else { $oldAd.easaAdNumber }
    issuedDate          = if ($oldAd.issuedDate) { $oldAd.issuedDate } else { $oldAd.issueDate }
    effectiveDate       = $oldAd.effectiveDate
    subject             = $oldAd.subject
    summary             = $oldAd.summary
    pdfUrl              = if ($oldAd.easaUrl) { $oldAd.easaUrl } else { $oldAd.pdfUrl }
    easaUrl             = $oldAd.easaUrl
    sourceUrl           = $oldAd.sourceUrl
    fullTextHtmlUrl     = $oldAd.fullTextHtmlUrl
    officialFaaAd       = $oldAd.officialFaaAd
    supersededBy        = $termAdNumber
    authority           = $oldAd.authority
    applicabilityStatus = "Superseded"
    complianceStatus    = "Superseded"
    targetModel         = $oldAd.targetModel
    complianceTime      = $oldAd.complianceTime
    repetitiveInterval  = $oldAd.repetitiveInterval
  }
}

function Set-SafeProp($obj, [string]$name, $val) {
  if ($obj.PSObject.Properties[$name]) {
    $obj.$name = $val
  } else {
    $obj | Add-Member -NotePropertyName $name -NotePropertyValue $val
  }
}

function Add-UniqueSupersededItem($targetAd, $supItem) {
  $list = New-Object 'System.Collections.Generic.List[object]'
  if ($targetAd.PSObject.Properties['supersededAds'] -and $null -ne $targetAd.supersededAds) {
    foreach ($existing in $targetAd.supersededAds) {
      if ($null -ne $existing) { $list.Add($existing) }
    }
  }
  $normNew = ($supItem.adNumber -replace '\s+', ' ').Trim().ToUpperInvariant()
  foreach ($existing in $list) {
    $normEx = (([string]$existing.adNumber) -replace '\s+', ' ').Trim().ToUpperInvariant()
    if ($normEx -eq $normNew -or ($supItem.docNumber -and $existing.docNumber -eq $supItem.docNumber)) {
      return
    }
  }
  $list.Add($supItem)
  $arr = $list.ToArray()
  Set-SafeProp $targetAd 'supersededAds' $arr
  Set-SafeProp $targetAd 'hasSupersededAds' ($arr.Length -gt 0)
  Set-SafeProp $targetAd 'supersededCount' $arr.Length
}

$removeIds = New-Object 'System.Collections.Generic.HashSet[string]'
$createdTargets = New-Object 'System.Collections.Generic.List[object]'
$foldedCount = 0
$createdTargetCount = 0
$dualAnnotatedCount = 0
$cancelledAnnotatedCount = 0

foreach ($ad in @($db.ads)) {
  $eNum = ""
  if ($ad.easaAdNumber -match '(\d{4}-\d{4}[A-Za-z0-9\-]*)') { $eNum = $Matches[1] }
  elseif ($ad.adNumber -match 'EASA\s+(?:AD|EAD|PAD)\s+(\d{4}-\d{4}[A-Za-z0-9\-]*)') { $eNum = $Matches[1] }
  elseif ($ad.adNumber -match 'State AD\s+([A-Z]-\d{4}-\d{3,4}[A-Za-z0-9\-]*)') { $eNum = $Matches[1] }
  if (-not $eNum -and "$($ad.easaUrl) $($ad.pdfUrl)" -notmatch '_superseded\.pdf|_cancelled\.pdf') { continue }

  $arc = Find-ArcEntry $eNum
  $arcSubj = if ($arc) { $arc.subj } else { "" }
  $arcUrl = if ($arc) { $arc.url } else { "" }
  $isSupByText = ($arcSubj -match '(?i)^SU[PB]ERSEDED BY\s+') -or ($ad.subject -match '(?i)^SU[PB]ERSEDED BY\s+')
  $isSupUrl = ("$($ad.easaUrl) $($ad.pdfUrl) $arcUrl" -match '_superseded\.pdf')
  $isCn = ($eNum -match '-CN$') -or ($arcSubj -match '^CANCELLED\b') -or ("$($ad.easaUrl) $($ad.pdfUrl) $arcUrl" -match '_cancelled\.pdf')

  $supBy = Get-SupByFromSubj $arcSubj
  if (-not $supBy) { $supBy = Get-SupByFromSubj $ad.subject }

  if (-not $ad.officialFaaAd) {
    # Pure EASA AD
    if ($supBy) {
      $res = Find-ActiveTargetAd $supBy $arcByNum $topByEasa
      $termNum = $res.TerminalNum
      $targetAd = $res.TargetAd
      if (-not $targetAd) {
        $termArc = Find-ArcEntry $termNum
        if ($termArc) {
          $targetAd = New-AdFromArchive $termNum $termArc $db.fleet
          $createdTargets.Add($targetAd)
          if (-not $topByEasa.ContainsKey($termNum)) { $topByEasa[$termNum] = @($targetAd) }
          $createdTargetCount++
        }
      }
      if ($targetAd -and $targetAd.id -ne $ad.id) {
        $termLabel = "EASA AD $termNum"
        if ($targetAd.officialFaaAd) { $termLabel = $targetAd.adNumber }
        Add-UniqueSupersededItem $targetAd (Convert-AdToSupersededItem $ad $termLabel)
        foreach ($nested in @($ad.supersededAds)) {
          Add-UniqueSupersededItem $targetAd $nested
        }
        [void]$removeIds.Add($ad.id)
        $foldedCount++
      }
    } elseif ($isCn -or $isSupByText -or $isSupUrl) {
      # Cancelled AD or superseded by external authority (e.g. CAA UK AD G-2022-0011)
      $note = if ($arcSubj) { $arcSubj } elseif ($isCn) { "CANCELLED EASA AD" } else { "SUPERSEDED" }
      if ($ad.PSObject.Properties['easaStatusNote']) { $ad.easaStatusNote = $note }
      else { $ad | Add-Member -NotePropertyName 'easaStatusNote' -NotePropertyValue $note }
      $cancelledAnnotatedCount++
    }
  } else {
    # Dual FAA + EASA AD: if its EASA side is superseded, fold EASA into final EASA AD and keep FAA AD standalone!
    if ($supBy) {
      $res = Find-ActiveTargetAd $supBy $arcByNum $topByEasa
      $termNum = $res.TerminalNum
      $targetAd = $res.TargetAd
      if (-not $targetAd) {
        $termArc = Find-ArcEntry $termNum
        if ($termArc) {
          $targetAd = New-AdFromArchive $termNum $termArc $db.fleet
          $createdTargets.Add($targetAd)
          if (-not $topByEasa.ContainsKey($termNum)) { $topByEasa[$termNum] = @($targetAd) }
          $createdTargetCount++
        }
      }
      if ($targetAd) {
        $termLabel = if ($targetAd.officialFaaAd) { $targetAd.adNumber } else { "EASA AD $termNum" }
        $easaOnlyItem = [PSCustomObject]@{
          adNumber            = if ($ad.easaAdNumber) { $ad.easaAdNumber } else { "EASA AD $eNum" }
          docNumber           = $eNum
          issuedDate          = if ($ad.easaIssuedDate) { $ad.easaIssuedDate } elseif ($arc -and $arc.issIso) { $arc.issIso } else { $ad.issuedDate }
          effectiveDate       = if ($ad.easaEffectiveDate) { $ad.easaEffectiveDate } elseif ($arc -and $arc.effIso) { $arc.effIso } else { $ad.effectiveDate }
          subject             = if ($ad.easaSubject) { $ad.easaSubject } elseif ($arcSubj) { $arcSubj } else { $ad.subject }
          summary             = if ($ad.easaSummary) { $ad.easaSummary } else { $ad.summary }
          pdfUrl              = if ($ad.easaUrl) { $ad.easaUrl } elseif ($arcUrl) { $arcUrl } else { $ad.pdfUrl }
          easaUrl             = if ($ad.easaUrl) { $ad.easaUrl } else { $arcUrl }
          sourceUrl           = $ad.sourceUrl
          fullTextHtmlUrl     = $ad.fullTextHtmlUrl
          officialFaaAd       = ""
          supersededBy        = $termLabel
          authority           = "EASA"
          applicabilityStatus = "Superseded"
          complianceStatus    = "Superseded"
          targetModel         = if ($ad.easaModels) { $ad.easaModels } else { $ad.targetModel }
          complianceTime      = $ad.complianceTime
          repetitiveInterval  = $ad.repetitiveInterval
        }
        Add-UniqueSupersededItem $targetAd $easaOnlyItem
        # Unlink dead EASA side from active FAA AD
        $oldEasaLbl = if ($ad.easaAdNumber) { $ad.easaAdNumber } else { "EASA AD $eNum" }
        $ad.adNumber = "FAA AD $($ad.officialFaaAd)"
        $ad.easaAdNumber = ""
        $ad.authority = "FAA"
        Set-SafeProp $ad 'authorityDual' "FAA"
        Set-SafeProp $ad 'easaUrl' ""
        Set-SafeProp $ad 'easaSubject' ""
        Set-SafeProp $ad 'easaSummary' ""
        Set-SafeProp $ad 'easaIssuedDate' ""
        Set-SafeProp $ad 'easaEffectiveDate' ""
        Set-SafeProp $ad 'easaModels' ""
        Set-SafeProp $ad 'easaSupersededBy' ""
        Set-SafeProp $ad 'historicalMcaiRef' "$oldEasaLbl → $termLabel"
        $dualAnnotatedCount++
      }
    } elseif ($isCn) {
      $oldEasaLbl = if ($ad.easaAdNumber) { $ad.easaAdNumber } else { "EASA AD $eNum" }
      $ad.adNumber = "FAA AD $($ad.officialFaaAd)"
      $ad.easaAdNumber = ""
      $ad.authority = "FAA"
      Set-SafeProp $ad 'authorityDual' "FAA"
      Set-SafeProp $ad 'easaUrl' ""
      Set-SafeProp $ad 'easaSupersededBy' ""
      Set-SafeProp $ad 'historicalMcaiRef' "$oldEasaLbl (CANCELLED)"
      $dualAnnotatedCount++
    }
  }
}

Write-Host "Folded Pure EASA superseded ADs: $foldedCount (created $createdTargetCount missing target ADs from Archive)"
Write-Host "Annotated external/cancelled EASA ADs: $cancelledAnnotatedCount"
Write-Host "Folded/unlinked Dual FAA+EASA ADs with superseded EASA side: $dualAnnotatedCount"

$newAdsList = New-Object 'System.Collections.Generic.List[object]'
foreach ($t in $createdTargets) { $newAdsList.Add($t) }
foreach ($ad in $db.ads) {
  if (-not $removeIds.Contains($ad.id)) {
    $newAdsList.Add($ad)
  }
}

# [3B] Consolidate Superseded FAA ADs (fold any top-level FAA AD superseded by a newer FAA AD in DB)
Write-Host "[3B/4] Consolidating Superseded FAA ADs..."
$faaTopMap = @{}
foreach ($ad in $newAdsList) {
  $fNum = ""
  if ($ad.officialFaaAd -match '(\d{4}-\d{2}-\d{2}[A-Za-z0-9\-]*)') { $fNum = $Matches[1] }
  elseif ($ad.adNumber -match 'FAA\s+AD\s+(\d{4}-\d{2}-\d{2}[A-Za-z0-9\-]*)') { $fNum = $Matches[1] }
  if ($fNum -and -not $faaTopMap.ContainsKey($fNum)) { $faaTopMap[$fNum] = $ad }
}

$faaSupParentOf = @{}
foreach ($ad in $newAdsList) {
  $pFaa = ""
  if ($ad.officialFaaAd -match '(\d{4}-\d{2}-\d{2}[A-Za-z0-9\-]*)') { $pFaa = $Matches[1] }
  elseif ($ad.adNumber -match 'FAA\s+AD\s+(\d{4}-\d{2}-\d{2}[A-Za-z0-9\-]*)') { $pFaa = $Matches[1] }
  if (-not $pFaa) { continue }

  foreach ($s in @($ad.supersededAds)) {
    $sf = ""
    if ($s.officialFaaAd -match '(\d{4}-\d{2}-\d{2}[A-Za-z0-9\-]*)') { $sf = $Matches[1] }
    elseif ($s.adNumber -match '(\d{4}-\d{2}-\d{2}[A-Za-z0-9\-]*)') { $sf = $Matches[1] }
    if ($sf -and $sf -ne $pFaa -and $faaTopMap.ContainsKey($sf) -and $faaTopMap[$sf].id -ne $ad.id) {
      $faaSupParentOf[$sf] = $pFaa
    }
  }

  $txtF = "$($ad.subject) $($ad.summary)"
  $msF = [regex]::Matches($txtF, '(?i)(?:supersed\w*|rescind\w*)\s+(?:Airworthiness\s+Directive\s*(?:\(AD\)\s*)?|AD\s+)+(\d{4}-\d{2}-\d{2}[A-Za-z0-9\-]*)')
  foreach ($mf in $msF) {
    $sf = $mf.Groups[1].Value.Trim()
    if ($sf -and $sf -ne $pFaa -and $faaTopMap.ContainsKey($sf) -and $faaTopMap[$sf].id -ne $ad.id) {
      $faaSupParentOf[$sf] = $pFaa
    }
  }
}

$faaRemoveIds = New-Object 'System.Collections.Generic.HashSet[string]'
$faaFoldedCount = 0
foreach ($oldFaa in @($faaSupParentOf.Keys)) {
  $cur = $oldFaa
  $visitedF = @{}
  for ($hop = 0; $hop -lt 15; $hop++) {
    if ($visitedF.ContainsKey($cur)) { break }
    $visitedF[$cur] = $true
    if ($faaSupParentOf.ContainsKey($cur)) {
      $cur = $faaSupParentOf[$cur]
    } else {
      break
    }
  }
  $oldAd = $faaTopMap[$oldFaa]
  $termFaaAd = $faaTopMap[$cur]
  if ($oldAd -and $termFaaAd -and $oldAd.id -ne $termFaaAd.id) {
    Add-UniqueSupersededItem $termFaaAd (Convert-AdToSupersededItem $oldAd $termFaaAd.adNumber)
    foreach ($nested in @($oldAd.supersededAds)) {
      Add-UniqueSupersededItem $termFaaAd $nested
    }
    [void]$faaRemoveIds.Add($oldAd.id)
    $faaFoldedCount++
  }
}

$finalAdsList = New-Object 'System.Collections.Generic.List[object]'
foreach ($ad in $newAdsList) {
  if (-not $faaRemoveIds.Contains($ad.id)) {
    $finalAdsList.Add($ad)
  }
}
Write-Host "Folded Superseded FAA ADs into newer FAA ADs: $faaFoldedCount"
$db.ads = $finalAdsList.ToArray()

# Clean check for 2026-0130, 2026-0176, and 2025-0088
$c130 = @($db.ads | Where-Object { "$($_.adNumber) $($_.easaAdNumber)" -match '2026-0130' }).Count
$p176 = $db.ads | Where-Object { "$($_.adNumber) $($_.easaAdNumber)" -match '2026-0176' } | Select-Object -First 1
$p088 = $db.ads | Where-Object { "$($_.adNumber) $($_.easaAdNumber)" -match '2025-0088' } | Select-Object -First 1

Write-Host "[4/4] Saving updated aeroad-database.json (total top-level ads: $($db.ads.Count))..."
$jsonOut = $db | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText($dbPath, $jsonOut, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "Verification:"
Write-Host "  Top-level 2026-0130 count: $c130"
if ($p176) {
  Write-Host "  2026-0176 supersededAds: $((@($p176.supersededAds) | ForEach-Object { $_.adNumber }) -join ', ')"
  Write-Host "  2026-0176 adAffectedPart: $($p176.adAffectedPart)"
}
if ($p088) {
  Write-Host "  2025-0088 adAffectedPart: $($p088.adAffectedPart)"
  Write-Host "  2025-0088 adExtractedModels: $($p088.adExtractedModels)"
}
