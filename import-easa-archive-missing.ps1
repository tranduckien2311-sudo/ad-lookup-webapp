param(
    [string]$DbPath = (Join-Path $PSScriptRoot "db\aeroad-database.json"),
    [string]$ArchiveHtmlPath = (Join-Path $PSScriptRoot "db\easa-archive-page.html")
)

$ErrorActionPreference = "Stop"

$FallbackArchivePage = "https://www.easa.europa.eu/en/domains/aircraft-products/airworthiness-directives-ad/archive-airworthiness-directives"
$BaseEasaDomain = "https://www.easa.europa.eu"

function Pick-BestPdfFromHtml([string]$docHtml) {
    $hrefs = [regex]::Matches($docHtml, 'href="([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
    $pdfs = @($hrefs | Where-Object { $_ -match '\.pdf(\?|$)' })
    if ($pdfs.Count -eq 0) { $pdfs = @($hrefs) }
    if ($pdfs.Count -eq 0) { return "" }
    $best = $null; $bestScore = -999
    foreach ($u in $pdfs) {
        $score = 0
        if ($u -match '\.pdf$') { $score += 100 }
        if ($u -match 'EASA_AD_') { $score += 40 }
        if ($u -match '_en\.pdf$|-E\.pdf$') { $score += 30 }
        if ($u -match '_fr\.pdf$|-F\.pdf$') { $score -= 25 }
        if ($u -match 'PAD_') { $score -= 50 }
        if ($score -gt $bestScore) { $bestScore = $score; $best = $u }
    }
    if (-not $best) { $best = $pdfs[0] }
    if ($best -match '^/') { return "$BaseEasaDomain$best" }
    return $best
}

function Normalize-EasaDateIso([string]$d) {
    if ([string]::IsNullOrWhiteSpace($d)) { return "" }
    $s = $d.Trim()
    if ($s -match '^(\d{4})-(\d{2})-(\d{2})$') { return $s }
    if ($s -match '^(\d{2})/(\d{2})/(\d{4})$') { return "$($Matches[3])-$($Matches[1])-$($Matches[2])" }
    try { return ([datetime]::Parse($s, [System.Globalization.CultureInfo]::InvariantCulture)).ToString("yyyy-MM-dd") } catch { return $s }
}

function Format-EasaModels([string]$rawModels) {
    if ([string]::IsNullOrWhiteSpace($rawModels)) { return "" }
    $lines = @($rawModels -split "[\r\n]+" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
    if ($lines.Count -ge 2) {
        $holder = $lines[0]
        $types = ($lines[1..($lines.Count - 1)] -join ", ") -replace '/', ', '
        if ($types.Length -gt 240) { $types = $types.Substring(0, 237) + "..." }
        return "$holder — $types"
    }
    $single = ($rawModels -replace '\s+', ' ').Trim()
    if ($single.Length -gt 240) { $single = $single.Substring(0, 237) + "..." }
    return $single
}

function Norm-Key([string]$s) {
    if ([string]::IsNullOrWhiteSpace($s)) { return "" }
    $x = $s.Trim().ToUpper()
    $x = ($x -replace '^EASA\s*AD\s*', '' -replace '^EASA\s*/\s*STATE\s*AD\s*', '' -replace '^DGAC\s*(?:FRANCE\s*)?AD\s*', '' -replace '^FAA\s*AD\s*', '').Trim()
    $x = ($x -replace '\s*\([^\)]*\)\s*$', '' -replace '\([A-Z]+\)$', '' -replace '\s+CORRECTI.*$', '' -replace '\s*\[CORRECT.*$', '').Trim()
    if ($x -match '^US-(\d{2})-(\d{2})-(\d{2}[A-Z]?)$') {
        $yr = [int]$Matches[1]; $fy = if ($yr -ge 40) { 1900 + $yr } else { 2000 + $yr }
        return "FAA:$fy-$($Matches[2])-$($Matches[3])"
    }
    if ($x -match '^US-(\d{4}-\d{2}-\d{2}[A-Z]?)$') { return "FAA:$($Matches[1])" }
    if ($x -match '^(\d{4}-\d{2}-\d{2}[A-Z]?)$') { return "FAA:$($Matches[1])" }
    if ($x -match '^((?:19|20)\d{2}-\d{4})') { return $Matches[1] }
    if ($x -match '^((?:19|20)\d{2})-(\d{3})(R\d+|-E|-CN)?$') {
        if ([int]$Matches[1] -ge 2004) { return "$($Matches[1])-" + $Matches[2].PadLeft(4, '0') }
    }
    $x = $x -replace 'R\d+$', '' -replace '-CN$', '' -replace '-E$', ''
    return $x
}

Write-Host "[1/4] Loading database and removing synthetic CAAV placeholder (AUTO-CAAV-2026-009)..." -ForegroundColor Cyan
$db = Get-Content -Path $DbPath -Raw -Encoding UTF8 | ConvertFrom-Json
$filteredExisting = @($db.ads | Where-Object { $_.id -ne "AUTO-CAAV-2026-009" -and $_.id -notlike "EASA-ARC-*" })
$removedPlaceholder = $db.ads.Count - $filteredExisting.Count
Write-Host "  -> Removed synthetic placeholder count: $removedPlaceholder"

$dbKeys = @{}
$dbFaaObjMap = @{}
foreach ($ad in $filteredExisting) {
    if ($ad.officialFaaAd) {
        $fk = "FAA:$($ad.officialFaaAd.Trim().ToUpper())"
        $dbKeys[$fk] = $true
        $dbFaaObjMap[$ad.officialFaaAd.Trim().ToUpper()] = $ad
    }
    if ($ad.easaAdNumber) {
        if ($ad.easaAdNumber -match '\(([^\)]+)\)') { $dbKeys[(Norm-Key $Matches[1])] = $true }
        $k = Norm-Key $ad.easaAdNumber; if ($k) { $dbKeys[$k] = $true }
    }
    if ($ad.supersededAds) {
        foreach ($s in $ad.supersededAds) {
            if ($s.officialFaaAd) { $dbKeys["FAA:$($s.officialFaaAd.Trim().ToUpper())"] = $true }
            if ($s.easaAdNumber) { $sk = Norm-Key $s.easaAdNumber; if ($sk) { $dbKeys[$sk] = $true } }
            $ak = Norm-Key $s.adNumber; if ($ak) { $dbKeys[$ak] = $true }
        }
    }
}

Write-Host "[2/4] Scanning EASA Archive HTML for missing active VJC Airframe & Engine ADs..." -ForegroundColor Cyan
$html = Get-Content -Path $ArchiveHtmlPath -Raw -Encoding UTF8
$sIdx = $html.IndexOf('data-drupal-selector="drupal-settings-json"')
$eIdx = $html.IndexOf('</script>', $sIdx)
$jsonStart = $html.IndexOf('>', $sIdx) + 1
$settings = $html.Substring($jsonStart, $eIdx - $jsonStart) | ConvertFrom-Json
$rows = @($settings.easa_datasets.data | Select-Object -Skip 1)

$addedList = New-Object System.Collections.Generic.List[object]
$ad20260189 = $null

foreach ($r in $rows) {
    $cls = [string]$r[0]
    if ($cls -ne "AD" -and $cls -ne "EAD") { continue }
    $num = ([string]$r[1]).Trim().ToUpper()
    $docHtml = [string]$r[2]
    $issRaw = [string]$r[3]
    $subj = ([string]$r[4] -replace '\s+', ' ').Trim()
    $holderRaw = [string]$r[5]
    $effRaw = [string]$r[6]

    if (-not $num -or $subj -match 'SUPERSEDED\s+BY|CANCELLATION\s+NOTICE|CANCELLED|NOT ADOPTED|NOT ELIGIBLE') { continue }

    $key = Norm-Key $num
    if (-not $key) { continue }
    $inDb = $dbKeys.ContainsKey($key) -or ($key -match '^F-(\d{4}-\d{3,4})$' -and $dbKeys.ContainsKey($Matches[1])) -or $dbKeys.ContainsKey("F-$key")
    if ($inDb) { continue }

    $isVjcAirframe = ($holderRaw -match '(?i)AIRBUS' -and $holderRaw -notmatch 'HELICOPTERS|DEFENCE|STC' -and ($holderRaw -match 'A320-214|A321-211|A321-271N|A321-271NX|A330-343' -or ($holderRaw -match 'A320\s*$' -or $holderRaw -match 'A321\s*$' -or $holderRaw -match 'A330\s*$')))
    $isCfm5b = ($holderRaw -match '(?i)CFM56-5B') -or ($holderRaw -match '(?i)CFM56-5\s*$' -and $holderRaw -notmatch 'CFM56-5A|CFM56-5C|CFM56-5-A')
    $isVjcEngine = $isCfm5b -or ($holderRaw -match '(?i)PW1133G|772B-60|RB211 TRENT 700')
    if (-not $isVjcAirframe -and -not $isVjcEngine) { continue }

    $pdfUrl = Pick-BestPdfFromHtml $docHtml
    if (-not $pdfUrl) { $pdfUrl = $FallbackArchivePage }
    $issIso = Normalize-EasaDateIso $issRaw
    $effIso = Normalize-EasaDateIso $effRaw
    if (-not $effIso) { $effIso = $issIso }
    $modelsStr = Format-EasaModels $holderRaw

    # Map matched VJC aircraft variants
    $matchedTypes = New-Object System.Collections.Generic.List[string]
    $vjcLabels = New-Object System.Collections.Generic.List[string]
    $engines = New-Object System.Collections.Generic.List[string]
    $affectedCnt = 0

    if ($holderRaw -match '(?i)A320-214|A320\s*$|CFM56-5B4' -or ($holderRaw -match '(?i)CFM56-5B(?:/|$|\s)' -and $holderRaw -notmatch 'CFM56-5B3/') -or ($holderRaw -match '(?i)CFM56-5\s*$' -and $holderRaw -notmatch 'CFM56-5A|CFM56-5C|CFM56-5-A')) {
        $matchedTypes.Add("A320-214"); $vjcLabels.Add("A320-214 (15 tàu • CFM56-5B4)"); $engines.Add("CFM56-5B4/3 & 5B4/P"); $affectedCnt += 15
    }
    if ($holderRaw -match '(?i)A321-211|A321\s*$|CFM56-5B3' -or ($holderRaw -match '(?i)CFM56-5B(?:/|$|\s)' -and $holderRaw -notmatch 'CFM56-5B4/') -or ($holderRaw -match '(?i)CFM56-5\s*$' -and $holderRaw -notmatch 'CFM56-5A|CFM56-5C|CFM56-5-A')) {
        $matchedTypes.Add("A321-211"); $vjcLabels.Add("A321-211 CEO (41 tàu • CFM56-5B3)"); $engines.Add("CFM56-5B3/3 & 5B3/P"); $affectedCnt += 41
    }
    if ($holderRaw -match '(?i)A321-271N|PW1133G' -or ($holderRaw -match '(?i)A321\s*$' -and $issIso -ge "2016-01-01")) {
        $matchedTypes.Add("A321-271N"); $matchedTypes.Add("A321-271NX")
        $vjcLabels.Add("A321-271N NEO (11 tàu • PW1133G-JM)"); $vjcLabels.Add("A321-271NX NEO ACF (33 tàu • PW1133G-JM)")
        $engines.Add("PW1133G-JM"); $affectedCnt += 44
    }
    if ($holderRaw -match '(?i)A330-343|A330\s*$|772B-60') {
        $matchedTypes.Add("A330-343"); $vjcLabels.Add("A330-343 Widebody (8 tàu • RR Trent 772B-60)"); $engines.Add("RR Trent 772B-60"); $affectedCnt += 8
    }

    $isApp = ($matchedTypes.Count -gt 0)
    $engStr = if ($engines.Count -gt 0) { ($engines | Select-Object -Unique) -join " / " } else { "Theo cấu hình TCDS" }
    $vjcSumStr = if ($isApp) { $vjcLabels -join " + " } else { "Không khớp biến thể tàu bay/động cơ VJC" }

    # Determine FAA vs EASA identity
    $isUs = ($key -like "FAA:*")
    $faaNum = if ($isUs) { $key.Substring(4) } else { "" }
    $easaDisp = if ($isUs) { "" } elseif ($num -match '^(?:19|20)\d{2}-\d{4}') { "EASA AD $num" } else { "EASA / State AD $num" }
    $adDisp = if ($isUs) { "FAA AD $faaNum" } else { $easaDisp }
    $auth = if ($isUs) { "FAA" } else { "EASA" }
    $authDual = $auth
    $mainPdf = if ($isUs) { "/api/resolve-ad-pdf?ad=$([System.Uri]::EscapeDataString($faaNum))" } else { $pdfUrl }
    $eUrl = if ($isUs) { "" } else { $pdfUrl }

    # Known FAA equivalent pair for EASA AD 2013-0042 -> FAA AD 2013-19-21 (FR 2013-23432)
    $fullHtml = ""
    if ($num -eq "2013-0042") {
        $faaNum = "2013-19-21"
        $adDisp = "FAA AD 2013-19-21 / EASA AD 2013-0042"
        $auth = "EASA"; $authDual = "EASA / FAA"
        $mainPdf = "https://www.govinfo.gov/content/pkg/FR-2013-10-02/pdf/2013-23432.pdf"
        $fullHtml = "https://www.govinfo.gov/content/pkg/FR-2013-10-02/html/2013-23432.htm"
    }

    $sumText = "[$adDisp | Issued: $issIso | Effective: $effIso] $subj. Applies to: $modelsStr"
    $easaSumText = "[$easaDisp | Issued: $issIso | Effective: $effIso] $subj. Applies to: $modelsStr"

    $newRec = [pscustomobject][ordered]@{
        id                  = "EASA-ARC-" + ($num -replace '[^A-Z0-9\-]', '')
        adNumber            = $adDisp
        authority           = $auth
        authorityDual       = $authDual
        officialFaaAd       = $faaNum
        easaAdNumber        = $easaDisp
        easaUrl             = $eUrl
        easaIssuedDate      = $(if ($eUrl) { $issIso } else { "" })
        easaEffectiveDate   = $(if ($eUrl) { $effIso } else { "" })
        easaSubject         = $(if ($eUrl) { $subj } else { "" })
        easaModels          = $(if ($eUrl) { $modelsStr } else { "" })
        easaSummary         = $(if ($eUrl) { $easaSumText } else { "" })
        adClass             = $(if ($cls -eq "EAD") { "Emergency AD" } else { "Final Rule AD" })
        docketNo            = $adDisp
        amendmentNum        = ""
        issuedDate          = $issIso
        issueDate           = $issIso
        effectiveDate       = $effIso
        ata                 = $(if ($isVjcEngine) { "72 - Engine (Turbine / Turboprop)" } else { "05 / 53 / 57 - Airframe & Systems" })
        category            = $(if ($isVjcEngine) { "Engine" } else { "Aircraft" })
        targetModel         = "$modelsStr → Khớp VJC: $vjcSumStr"
        adExtractedModels   = $modelsStr
        adExtractedEngines  = $engStr
        adMsnScope          = "Theo danh mục EASA Airworthiness Directives Archive"
        vjcMatchedSummary   = $vjcSumStr
        matchedTypes        = @($matchedTypes | Select-Object -Unique)
        subject             = $subj
        summary             = $sumText
        rawRequirementText  = $sumText
        applicabilityStatus = $(if ($isApp) { "Applicable" } else { "Not Applicable" })
        affectedCount       = $affectedCnt
        isRepetitive        = ($subj -match '(?i)Inspection|ALS|Life')
        repetitiveInterval  = $(if ($subj -match '(?i)Inspection|ALS|Life') { "Repeat: Theo văn bản AD gốc (FH / FC / Days)" } else { "Theo văn bản AD gốc" })
        complianceTime      = "Xem chi tiết trong file PDF AD gốc"
        complianceStatus    = "Active"
        isSuperseded        = $false
        supersededBy        = ""
        supersededAds       = @()
        sourceUrl           = $FallbackArchivePage
        pdfUrl              = $mainPdf
        fullTextHtmlUrl     = $fullHtml
    }

    if ($num -eq "2026-0189") {
        $ad20260189 = $newRec
        # Link EASA AD 2026-0172-E as superseded under 2026-0189 per EASA Archive
        $newRec.supersededAds = @(
            [pscustomobject][ordered]@{
                adNumber            = "EASA AD 2026-0172-E"
                easaAdNumber        = "EASA AD 2026-0172-E"
                easaUrl             = "https://www.easa.europa.eu/download/AD-tmp-storage/EASA_AD_2026_0172_E_superseded.pdf"
                authority           = "EASA"
                issuedDate          = "2026-09-04"
                effectiveDate       = "2026-09-08"
                subject             = "SUPERSEDED BY EASA AD 2026-0189 — Engine Oil – Oil Pump"
                summary             = "EASA AD 2026-0172-E (Issued: 2026-09-04) đã bị thay thế hoàn toàn bởi EASA AD 2026-0189 (Issued: 2026-10-01)."
                applicabilityStatus = "Superseded"
                complianceStatus    = "Superseded"
                supersededBy        = "EASA AD 2026-0189"
                sourceUrl           = $FallbackArchivePage
                pdfUrl              = "https://www.easa.europa.eu/download/AD-tmp-storage/EASA_AD_2026_0172_E_superseded.pdf"
            }
        )
    }

    $addedList.Add($newRec)
    $dbKeys[$key] = $true
}

Write-Host "[3/4] Added $($addedList.Count) missing active VJC Airframe & Engine ADs from EASA Archive." -ForegroundColor Green

$combined = New-Object System.Collections.Generic.List[object]
foreach ($a in $filteredExisting) { $combined.Add($a) }
foreach ($n in $addedList) { $combined.Add($n) }
$sortedAds = @($combined | Sort-Object -Property @{Expression = { [string]$_.effectiveDate }; Descending = $true })

$totalSupCnt = 0; $supGroupCnt = 0; $appCnt = 0; $notAppCnt = 0
foreach ($a in $sortedAds) {
    if ($a.applicabilityStatus -eq "Applicable") { $appCnt++ } else { $notAppCnt++ }
    if ($a.supersededAds -and $a.supersededAds.Count -gt 0) { $supGroupCnt++; $totalSupCnt += $a.supersededAds.Count }
}

$db | Add-Member -NotePropertyName "lastSyncedAt" -NotePropertyValue ((Get-Date).ToString("dd/MM/yyyy HH:mm:ss")) -Force
$db | Add-Member -NotePropertyName "totalAds" -NotePropertyValue $sortedAds.Count -Force
$db | Add-Member -NotePropertyName "totalAllAdsIncludingSuperseded" -NotePropertyValue ($sortedAds.Count + $totalSupCnt) -Force
$db | Add-Member -NotePropertyName "applicableCount" -NotePropertyValue $appCnt -Force
$db | Add-Member -NotePropertyName "notApplicableCnt" -NotePropertyValue $notAppCnt -Force
$db | Add-Member -NotePropertyName "supersedingAdCount" -NotePropertyValue $supGroupCnt -Force
$db | Add-Member -NotePropertyName "supersededTotalCnt" -NotePropertyValue $totalSupCnt -Force
$db.ads = $sortedAds

$jsonOut = $db | ConvertTo-Json -Depth 12
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($DbPath, $jsonOut, $utf8NoBom)

Write-Host "[4/4] DONE! Total Active ADs: $($sortedAds.Count) (+ $totalSupCnt Superseded = $($sortedAds.Count + $totalSupCnt) total)." -ForegroundColor Green
