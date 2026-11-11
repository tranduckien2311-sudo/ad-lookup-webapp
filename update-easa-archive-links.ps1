param(
    [string]$DbPath = (Join-Path $PSScriptRoot "db\aeroad-database.json"),
    [string]$ArchiveHtmlPath = (Join-Path $PSScriptRoot "db\easa-archive-page.html"),
    [string]$InterimHtmlPath = (Join-Path $PSScriptRoot "db\easa-interim-page.html")
)

$ErrorActionPreference = "Stop"

$FallbackArchivePage = "https://www.easa.europa.eu/en/domains/aircraft-products/airworthiness-directives-ad/archive-airworthiness-directives"
$InterimPage = "https://www.easa.europa.eu/en/domains/aircraft-products/airworthiness-directives-ad/safety-publications-tool-interim-solution"
$BaseEasaDomain = "https://www.easa.europa.eu"

function Pick-BestPdfFromHtml([string]$docHtml) {
    $hrefs = [regex]::Matches($docHtml, 'href="([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
    $pdfs = @($hrefs | Where-Object { $_ -match '\.pdf(\?|$)' })
    if ($pdfs.Count -eq 0) {
        $pdfs = @($hrefs)
    }
    if ($pdfs.Count -eq 0) { return "" }

    $best = $null
    $bestScore = -999
    foreach ($u in $pdfs) {
        $score = 0
        if ($u -match '\.pdf$') { $score += 100 }
        if ($u -match 'EASA_AD_') { $score += 40 }
        if ($u -match '_en\.pdf$|-E\.pdf$') { $score += 30 }
        if ($u -match '_fr\.pdf$|-F\.pdf$') { $score -= 25 }
        if ($u -match 'PAD_') { $score -= 50 }
        if ($u -match 'superseded') { $score -= 5 }
        if ($score -gt $bestScore) {
            $bestScore = $score
            $best = $u
        }
    }
    if (-not $best) { $best = $pdfs[0] }
    if ($best -match '^/') { return "$BaseEasaDomain$best" }
    return $best
}

function Normalize-EasaDateIso([string]$d) {
    if ([string]::IsNullOrWhiteSpace($d)) { return "" }
    $s = $d.Trim()
    if ($s -match '^(\d{4})-(\d{2})-(\d{2})$') { return $s }
    if ($s -match '^(\d{2})/(\d{2})/(\d{4})$') {
        return "$($Matches[3])-$($Matches[1])-$($Matches[2])"
    }
    try {
        return ([datetime]::Parse($s, [System.Globalization.CultureInfo]::InvariantCulture)).ToString("yyyy-MM-dd")
    } catch { return $s }
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

function Normalize-EasaLookupKey([string]$code) {
    if ([string]::IsNullOrWhiteSpace($code)) { return "" }
    $s = $code.Trim().ToUpper()
    $s = ($s -replace '^EASA\s*AD\s*', '' -replace '^EASA\s*/\s*STATE\s*AD\s*', '' -replace '^DGAC\s*(?:FRANCE\s*)?AD\s*', '').Trim()
    $s = ($s -replace '\s*\([A-Z]+\)\s*$', '' -replace '\([A-Z]+\)$', '' -replace '\s+CORRECTI.*$', '' -replace '\s*\[CORRECT.*$', '').Trim()
    if ($s -match '^((?:19|20)\d{2})-(\d{3})(R\d+|-E|-CN)?$') {
        $yr = [int]$Matches[1]
        if ($yr -ge 2004) {
            $s = "$yr-" + $Matches[2].PadLeft(4, '0') + $Matches[3]
        }
    }
    if ($s -match '^((?:19|20)\d{2}-\d{4})E$') {
        $s = "$($Matches[1])-E"
    }
    return $s
}

function Get-BaseEasaKey([string]$s) {
    if ($s -match '^((?:19|20)\d{2}-\d{4})') { return $Matches[1] }
    if ($s -match '^F-(\d{4}-\d{3,4})') { return "F-$($Matches[1])" }
    if ($s -match '^(\d{4}-\d{3})(?:-\d{3})?') { return "F-$($Matches[1])" }
    return ($s -replace 'R\d+$', '' -replace '-CN$', '' -replace '-E$', '').Trim()
}

Write-Host "[1/3] Building rich EASA lookup map (PDF + Dates + Subject + Models) from Archive & Interim HTML..." -ForegroundColor Cyan
$exactMap = @{}
$baseMap = @{}

if (Test-Path $ArchiveHtmlPath) {
    $html = Get-Content -Path $ArchiveHtmlPath -Raw -Encoding UTF8
    $sIdx = $html.IndexOf('data-drupal-selector="drupal-settings-json"')
    if ($sIdx -ge 0) {
        $eIdx = $html.IndexOf('</script>', $sIdx)
        $jsonStart = $html.IndexOf('>', $sIdx) + 1
        if ($eIdx -gt $jsonStart) {
            $settings = $html.Substring($jsonStart, $eIdx - $jsonStart) | ConvertFrom-Json
            $rows = $settings.easa_datasets.data
            foreach ($row in ($rows | Select-Object -Skip 1)) {
                $adClass = [string]$row[0]
                if ($adClass -ne "AD" -and $adClass -ne "EAD") { continue }
                $classNum = ([string]$row[1]).Trim().ToUpper()
                $docHtml = [string]$row[2]
                $pdfUrl = Pick-BestPdfFromHtml $docHtml
                if (-not $classNum -or -not $pdfUrl) { continue }

                $issDate = Normalize-EasaDateIso ([string]$row[3])
                $subj = ([string]$row[4] -replace '\s+', ' ').Trim()
                $models = Format-EasaModels ([string]$row[5])
                $effDate = Normalize-EasaDateIso ([string]$row[6])
                if (-not $effDate) { $effDate = $issDate }

                $rec = [pscustomobject]@{
                    ClassNum    = $classNum
                    Pdf         = $pdfUrl
                    Source      = $FallbackArchivePage
                    IssuedDate  = $issDate
                    EffectiveDate = $effDate
                    Subject     = $subj
                    Models      = $models
                }

                if (-not $exactMap.ContainsKey($classNum)) {
                    $exactMap[$classNum] = $rec
                }
                $baseKey = Get-BaseEasaKey $classNum
                if ($baseKey -and -not $baseMap.ContainsKey($baseKey)) {
                    $baseMap[$baseKey] = $rec
                }
                if ($baseKey -match '^F-(\d{4}-\d{3,4})') {
                    $noF = $Matches[1]
                    if (-not $baseMap.ContainsKey($noF)) {
                        $baseMap[$noF] = $rec
                    }
                }
            }
        }
    }
}

if (Test-Path $InterimHtmlPath) {
    $iHtml = Get-Content -Path $InterimHtmlPath -Raw -Encoding UTF8
    $trMatches = [regex]::Matches($iHtml, '(?s)<tr>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*</tr>')
    foreach ($m in $trMatches) {
        $codeRaw = ([System.Net.WebUtility]::HtmlDecode(($m.Groups[1].Value -replace '<[^>]+>', ''))).Trim().ToUpper()
        $issRaw  = Normalize-EasaDateIso (([System.Net.WebUtility]::HtmlDecode(($m.Groups[3].Value -replace '<[^>]+>', ''))).Trim())
        $subjRaw = ([System.Net.WebUtility]::HtmlDecode(($m.Groups[4].Value -replace '<[^>]+>', '')) -replace '\s+', ' ').Trim()
        $modRaw  = ([System.Net.WebUtility]::HtmlDecode(($m.Groups[5].Value -replace '</li>', ', ' -replace '<[^>]+>', '')) -replace '\s+', ' ').Trim(' ,')
        if ($modRaw.Length -gt 240) { $modRaw = $modRaw.Substring(0, 237) + "..." }
        $effRaw  = Normalize-EasaDateIso (([System.Net.WebUtility]::HtmlDecode(($m.Groups[6].Value -replace '<[^>]+>', ''))).Trim())
        $pdfUrl  = Pick-BestPdfFromHtml $m.Groups[7].Value
        if (-not $codeRaw -or -not $pdfUrl) { continue }

        $rec = [pscustomobject]@{
            ClassNum      = $codeRaw
            Pdf           = $pdfUrl
            Source        = $InterimPage
            IssuedDate    = $issRaw
            EffectiveDate = $(if ($effRaw) { $effRaw } else { $issRaw })
            Subject       = $subjRaw
            Models        = $modRaw
        }
        if (-not $exactMap.ContainsKey($codeRaw)) { $exactMap[$codeRaw] = $rec }
        $baseKey = Get-BaseEasaKey $codeRaw
        if ($baseKey -and -not $baseMap.ContainsKey($baseKey)) { $baseMap[$baseKey] = $rec }
    }
}

Write-Host "  -> Indexed $($exactMap.Count) exact EASA records and $($baseMap.Count) base EASA records."

function Resolve-EasaArchiveRecord([string]$easaAdStr, [string]$oldUrl) {
    $candidates = New-Object System.Collections.Generic.List[string]
    if ($easaAdStr -match '\(([^\)]+)\)') {
        $candidates.Add($Matches[1].Trim().ToUpper())
    }
    $cleanPrimary = Normalize-EasaLookupKey ($easaAdStr -replace '\s*\([^\)]*\)\s*$', '')
    if ($cleanPrimary) { $candidates.Add($cleanPrimary) }
    if ($oldUrl -match '/ad/([^/\?#]+)') {
        $candidates.Add($Matches[1].Trim().ToUpper())
    }

    foreach ($c in $candidates) {
        if ($exactMap.ContainsKey($c)) { return $exactMap[$c] }
        $fPref = "F-$c"
        if ($exactMap.ContainsKey($fPref)) { return $exactMap[$fPref] }
    }
    foreach ($c in $candidates) {
        $b = Get-BaseEasaKey $c
        if ($b -and $baseMap.ContainsKey($b)) { return $baseMap[$b] }
    }
    return $null
}

Write-Host "[2/3] Enriching all EASA AD URLs, Effective Dates, Issued Dates, Models & Subjects in $DbPath..." -ForegroundColor Cyan
$db = Get-Content -Path $DbPath -Raw -Encoding UTF8 | ConvertFrom-Json

$matchedCount = 0
$fallbackCount = 0
$supUpdated = 0

foreach ($ad in $db.ads) {
    $hasEasa = (-not [string]::IsNullOrWhiteSpace($ad.easaAdNumber)) -or ($ad.easaUrl -like "*easa.europa.eu*") -or ($ad.pdfUrl -like "*ad.easa.europa.eu*")
    if ($hasEasa) {
        $rec = Resolve-EasaArchiveRecord ([string]$ad.easaAdNumber) ([string]$ad.easaUrl)
        if ($null -ne $rec) {
            $ad | Add-Member -NotePropertyName "easaUrl" -NotePropertyValue $rec.Pdf -Force
            $ad | Add-Member -NotePropertyName "easaIssuedDate" -NotePropertyValue $rec.IssuedDate -Force
            $ad | Add-Member -NotePropertyName "easaEffectiveDate" -NotePropertyValue $rec.EffectiveDate -Force
            $ad | Add-Member -NotePropertyName "easaSubject" -NotePropertyValue $rec.Subject -Force
            $ad | Add-Member -NotePropertyName "easaModels" -NotePropertyValue $rec.Models -Force
            $eSum = "[$($ad.easaAdNumber) | Issued: $($rec.IssuedDate) | Effective: $($rec.EffectiveDate)] $($rec.Subject). Applies to: $($rec.Models)"
            $ad | Add-Member -NotePropertyName "easaSummary" -NotePropertyValue $eSum -Force

            if ($ad.pdfUrl -like "*ad.easa.europa.eu*" -or [string]::IsNullOrWhiteSpace($ad.pdfUrl)) {
                $ad.pdfUrl = $rec.Pdf
            }
            if (-not $ad.officialFaaAd) {
                # Also upgrade EASA-only effectiveDate & models from official EASA Archive metadata
                if ($rec.EffectiveDate) { $ad.effectiveDate = $rec.EffectiveDate }
                if ($rec.IssuedDate) { $ad.issuedDate = $rec.IssuedDate; $ad | Add-Member -NotePropertyName "issueDate" -NotePropertyValue $rec.IssuedDate -Force }
                if ($rec.Subject -and ($ad.subject -eq $ad.subject.ToUpper() -or [string]::IsNullOrWhiteSpace($ad.subject))) {
                    $ad.subject = $rec.Subject
                }
                if ($rec.Models) { $ad.adExtractedModels = $rec.Models }
                $ad.summary = $eSum
            }
            if ($ad.sourceUrl -like "*ad.easa.europa.eu*" -or [string]::IsNullOrWhiteSpace($ad.sourceUrl)) {
                $ad.sourceUrl = $rec.Source
            }
            $matchedCount++
        } else {
            if ($ad.easaUrl -like "*ad.easa.europa.eu*" -or [string]::IsNullOrWhiteSpace($ad.easaUrl)) {
                $ad | Add-Member -NotePropertyName "easaUrl" -NotePropertyValue $FallbackArchivePage -Force
            }
            if ($ad.pdfUrl -like "*ad.easa.europa.eu*") {
                $ad.pdfUrl = $FallbackArchivePage
            }
            if ($ad.sourceUrl -like "*ad.easa.europa.eu*" -or [string]::IsNullOrWhiteSpace($ad.sourceUrl)) {
                $ad.sourceUrl = $FallbackArchivePage
            }
            $fallbackCount++
        }
    }

    if ($ad.supersededAds) {
        foreach ($sup in $ad.supersededAds) {
            $supHasEasa = (-not [string]::IsNullOrWhiteSpace($sup.easaAdNumber)) -or ($sup.easaUrl -like "*easa.europa.eu*") -or ($sup.pdfUrl -like "*ad.easa.europa.eu*")
            if ($supHasEasa) {
                $sRec = Resolve-EasaArchiveRecord ([string]$sup.easaAdNumber) ([string]$sup.easaUrl)
                if ($null -ne $sRec) {
                    $sup | Add-Member -NotePropertyName "easaUrl" -NotePropertyValue $sRec.Pdf -Force
                    $sup | Add-Member -NotePropertyName "easaIssuedDate" -NotePropertyValue $sRec.IssuedDate -Force
                    $sup | Add-Member -NotePropertyName "easaEffectiveDate" -NotePropertyValue $sRec.EffectiveDate -Force
                    $sup | Add-Member -NotePropertyName "easaSubject" -NotePropertyValue $sRec.Subject -Force
                    if ($sup.pdfUrl -like "*ad.easa.europa.eu*" -or [string]::IsNullOrWhiteSpace($sup.pdfUrl)) {
                        $sup.pdfUrl = $sRec.Pdf
                    }
                    if ($sup.sourceUrl -like "*ad.easa.europa.eu*" -or [string]::IsNullOrWhiteSpace($sup.sourceUrl)) {
                        $sup.sourceUrl = $sRec.Source
                    }
                } else {
                    $sup | Add-Member -NotePropertyName "easaUrl" -NotePropertyValue $FallbackArchivePage -Force
                    if ($sup.pdfUrl -like "*ad.easa.europa.eu*") { $sup.pdfUrl = $FallbackArchivePage }
                    if ($sup.sourceUrl -like "*ad.easa.europa.eu*") { $sup.sourceUrl = $FallbackArchivePage }
                }
                $supUpdated++
            }
        }
    }
}

Write-Host "[3/3] Saving enriched database..." -ForegroundColor Cyan
$jsonOut = $db | ConvertTo-Json -Depth 12
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($DbPath, $jsonOut, $utf8NoBom)

Write-Host "DONE! Enriched EASA ADs: $matchedCount (Fallback: $fallbackCount) | Superseded updated: $supUpdated" -ForegroundColor Green
