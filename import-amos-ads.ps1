param(
    [string]$DbPath = (Join-Path $PSScriptRoot "db\aeroad-database.json"),
    [string]$Sheet4JsonPath = (Join-Path $PSScriptRoot "db\amos-sheet4-all-ad.json")
)

$ErrorActionPreference = "Stop"

Write-Host "[1/6] Loading existing database and AMOS VJC18828 AD export..." -ForegroundColor Cyan
$db = Get-Content -Path $DbPath -Raw -Encoding UTF8 | ConvertFrom-Json
$raw4 = Get-Content -Path $Sheet4JsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
$sheet4 = $raw4 | Select-Object -Skip 1

Write-Host "  -> Existing Active ADs in DB: $($db.ads.Count)"
Write-Host "  -> AMOS Sheet4 total rows:    $($sheet4.Count)"

function Parse-AmosDate([string]$dStr) {
    if ([string]::IsNullOrWhiteSpace($dStr)) { return $null }
    try {
        return [datetime]::ParseExact($dStr.Trim(), "dd.MMM.yyyy", [System.Globalization.CultureInfo]::InvariantCulture)
    } catch {
        try { return [datetime]::Parse($dStr.Trim()) } catch { return $null }
    }
}

function Format-IsoDate($dt, [string]$fallback) {
    if ($null -ne $dt -and $dt -is [datetime]) {
        return $dt.ToString("yyyy-MM-dd")
    }
    return $fallback
}

function Get-BaseInfo([string]$doc) {
    if ([string]::IsNullOrWhiteSpace($doc)) { return $null }
    $s = $doc.Trim().ToUpper()
    $sClean = ($s -replace '\s*\([A-Z]+\)\s*$', '' -replace '\s+CORRECTI.*$', '' -replace '\s*\[CORRECT.*$', '' -replace '\s*-\s*GROUP\s*\d+.*$', '' -replace '\s+AMDT\s+39-.*$', '').Trim()

    # 2-digit year FAA AD: e.g. US-83-16-01, 98-09-27, 74-08-09
    if ($sClean -match '^(?:FAA\s*AD\s*)?(?:US-)?(\d{2})-(\d{2})-(\d{2}[A-Z]?)(?:-E)?$') {
        $yr = [int]$Matches[1]
        $fullYr = if ($yr -ge 40) { 1900 + $yr } else { 2000 + $yr }
        $base = "$fullYr-$($Matches[2])-$($Matches[3])"
        return @{
            Type      = "FAA"
            Base      = $base
            ShortFaa  = "$($Matches[1])-$($Matches[2])-$($Matches[3])"
            Year      = $fullYr
            RevSuffix = ""
            Raw       = $doc.Trim()
        }
    }
    # 4-digit year FAA AD: e.g. 2026-17-04, US-2011-14-08, 2014-26-53-E
    if ($sClean -match '^(?:FAA\s*AD\s*)?(?:US-)?((?:19|20)\d{2})-(\d{2})-(\d{2}[A-Z]?)(?:-E)?$') {
        $fullYr = [int]$Matches[1]
        $base = "$($Matches[1])-$($Matches[2])-$($Matches[3])"
        return @{
            Type      = "FAA"
            Base      = $base
            ShortFaa  = $base
            Year      = $fullYr
            RevSuffix = ""
            Raw       = $doc.Trim()
        }
    }
    # Standard EASA AD: e.g. 2025-0158, 2025-0151R2, 2025-0268-E, 2024-0055-CN
    if ($sClean -match '^(?:EASA\s*AD\s*)?((?:19|20)\d{2})-(\d{4})(R\d+)?(-E)?(-CN)?$') {
        $fullYr = [int]$Matches[1]
        $base = "$($Matches[1])-$($Matches[2])"
        $revSuf = "$($Matches[3])$($Matches[4])$($Matches[5])"
        return @{
            Type      = "EASA"
            Base      = $base
            Year      = $fullYr
            RevSuffix = $revSuf
            Raw       = $doc.Trim()
        }
    }
    # CAAV AD: e.g. CAAV-21-07-2025
    if ($sClean -match '^CAAV-.*-(\d{4})$') {
        return @{
            Type      = "CAAV"
            Base      = $sClean
            Year      = [int]$Matches[1]
            RevSuffix = ""
            Raw       = $doc.Trim()
        }
    }
    # Pre-EASA / National European / Foreign State-of-Design AD (DGAC France F-..., CAA UK G-..., LBA D-..., RLD NL-..., TCCA CF-...)
    $natBase = ($sClean -replace 'R\d+$', '').Trim()
    $yr = 2000
    if ($natBase -match '(19\d{2}|20\d{2})') {
        $yr = [int]$Matches[1]
    } elseif ($natBase -match '^(\d{2})-\d{3}') {
        $y2 = [int]$Matches[1]
        $yr = if ($y2 -ge 40) { 1900 + $y2 } else { 2000 + $y2 }
    } elseif ($natBase -match '-(\d{2})$') {
        $y2 = [int]$Matches[1]
        $yr = if ($y2 -ge 40) { 1900 + $y2 } else { 2000 + $y2 }
    }
    return @{
        Type      = "EASA_NAT"
        Base      = $natBase
        Year      = $yr
        RevSuffix = ""
        Raw       = $doc.Trim()
    }
}

function Format-EasaDisplay([hashtable]$info, [string]$maxRevCode) {
    if ($info.Type -eq "EASA") {
        $base = $info.Base
        $revNum = 0
        if ($info.RevSuffix -match 'R(\d+)') {
            $revNum = [int]$Matches[1]
        }
        if ($maxRevCode -match '^0*(\d+)$') {
            $rInt = [int]$Matches[1]
            if ($rInt -gt $revNum) { $revNum = $rInt }
        }
        $isEmerg = ($info.RevSuffix -match '-E')
        $isCn = ($info.RevSuffix -match '-CN')
        if ($revNum -gt 0) {
            return "EASA AD ${base}R${revNum} ($base)"
        } elseif ($isEmerg) {
            return "EASA AD ${base}-E ($base)"
        } elseif ($isCn) {
            return "EASA AD ${base}-CN ($base)"
        } else {
            return "EASA AD $base"
        }
    }
    if ($info.Type -eq "EASA_NAT") {
        $rawClean = ($info.Raw -replace '\s+', ' ').Trim()
        return "EASA / State AD $rawClean"
    }
    return $info.Raw
}

function Get-EasaUrl([hashtable]$info, [string]$maxRevCode) {
    if ($info.Type -eq "EASA") {
        $base = $info.Base
        $revNum = 0
        if ($info.RevSuffix -match 'R(\d+)') { $revNum = [int]$Matches[1] }
        if ($maxRevCode -match '^0*(\d+)$') {
            $rInt = [int]$Matches[1]
            if ($rInt -gt $revNum) { $revNum = $rInt }
        }
        if ($revNum -gt 0) {
            return "https://ad.easa.europa.eu/ad/${base}R${revNum}"
        } elseif ($info.RevSuffix -match '-E') {
            return "https://ad.easa.europa.eu/ad/${base}-E"
        } elseif ($info.RevSuffix -match '-CN') {
            return "https://ad.easa.europa.eu/ad/${base}-CN"
        }
        return "https://ad.easa.europa.eu/ad/$base"
    }
    $slug = ($info.Base -replace '[^A-Z0-9\-]', '').Trim()
    return "https://ad.easa.europa.eu/ad/$slug"
}

$ataTitleMap = @{
    "05" = "05 - Time Limits / Maintenance Checks (ALS)"
    "11" = "11 - Placards and Markings"
    "20" = "20 - Standard Practices - Airframe"
    "21" = "21 - Air Conditioning & Pressurization"
    "22" = "22 - Auto Flight"
    "23" = "23 - Communications"
    "24" = "24 - Electrical Power"
    "25" = "25 - Equipment / Furnishings"
    "26" = "26 - Fire Protection"
    "27" = "27 - Flight Controls"
    "28" = "28 - Fuel System"
    "29" = "29 - Hydraulic Power"
    "30" = "30 - Ice and Rain Protection"
    "31" = "31 - Indicating / Recording Systems"
    "32" = "32 - Landing Gear"
    "33" = "33 - Lights"
    "34" = "34 - Navigation"
    "35" = "35 - Oxygen"
    "36" = "36 - Pneumatic"
    "38" = "38 - Water / Waste"
    "44" = "44 - Cabin Systems"
    "46" = "46 - Information Systems"
    "49" = "49 - Airborne Auxiliary Power (APU)"
    "51" = "51 - Standard Practices & Structures"
    "52" = "52 - Doors"
    "53" = "53 - Fuselage"
    "54" = "54 - Nacelles / Pylons"
    "55" = "55 - Stabilizers"
    "56" = "56 - Windows"
    "57" = "57 - Wings"
    "70" = "70 - Standard Practices - Engine"
    "71" = "71 - Powerplant"
    "72" = "72 - Engine (Turbine / Turboprop)"
    "73" = "73 - Engine Fuel and Control"
    "74" = "74 - Ignition"
    "75" = "75 - Air / Engine Bleed"
    "76" = "76 - Engine Controls"
    "77" = "77 - Engine Indicating"
    "78" = "78 - Exhaust & Thrust Reverser"
    "79" = "79 - Oil"
    "80" = "80 - Starting"
}

function Format-AtaLabel([string]$rawAta) {
    if ([string]::IsNullOrWhiteSpace($rawAta)) { return "General / Aircraft & Engine" }
    $ch = ($rawAta.Trim() -split '-')[0].PadLeft(2, '0')
    if ($ataTitleMap.ContainsKey($ch)) { return $ataTitleMap[$ch] }
    return "$($rawAta.Trim()) - Aircraft / Engine System"
}

Write-Host "[2/6] Indexing all existing ADs and Superseded ADs in aeroad-database.json..." -ForegroundColor Cyan
$dbFaaMap = @{}
$dbEasaMap = @{}
$dbParentBySupFaa = @{}
$dbParentBySupEasa = @{}

foreach ($ad in $db.ads) {
    if ($ad.officialFaaAd) {
        $fi = Get-BaseInfo $ad.officialFaaAd
        if ($fi -and $fi.Type -eq "FAA") {
            $dbFaaMap[$fi.Base] = $ad
        }
    }
    if ($ad.easaAdNumber) {
        $cleanE = ($ad.easaAdNumber -replace '^EASA\s*AD\s*', '' -replace '^EASA\s*/\s*State\s*AD\s*', '' -replace '\s*\(.*\)$', '').Trim()
        $ei = Get-BaseInfo $cleanE
        if ($ei) {
            $dbEasaMap[$ei.Base] = $ad
        }
    }
    if ($ad.rawSupersededNums) {
        foreach ($rn in $ad.rawSupersededNums) {
            $rni = Get-BaseInfo ([string]$rn)
            if ($rni -and $rni.Type -eq "FAA" -and -not $dbFaaMap.ContainsKey($rni.Base)) {
                $dbParentBySupFaa[$rni.Base] = $ad
            }
        }
    }
    if ($ad.supersededAds) {
        foreach ($sup in $ad.supersededAds) {
            if ($sup.officialFaaAd) {
                $sfi = Get-BaseInfo $sup.officialFaaAd
                if ($sfi -and $sfi.Type -eq "FAA" -and -not $dbFaaMap.ContainsKey($sfi.Base)) {
                    $dbFaaMap[$sfi.Base] = $sup
                    $dbParentBySupFaa[$sfi.Base] = $ad
                }
            }
            if ($sup.easaAdNumber) {
                $cleanSE = ($sup.easaAdNumber -replace '^EASA\s*AD\s*', '' -replace '\s*\(.*\)$', '').Trim()
                $sei = Get-BaseInfo $cleanSE
                if ($sei -and -not $dbEasaMap.ContainsKey($sei.Base)) {
                    $dbEasaMap[$sei.Base] = $sup
                    $dbParentBySupEasa[$sei.Base] = $ad
                }
            }
            # Also scan superseded summary for grandparent FAA AD numbers ("superseding Airworthiness Directive (AD) 2023-13-10, and AD 2024-04-03")
            if ($sup.summary -match 'superseding\s+Airworthiness\s+Directive[^\.]+') {
                $supSent = $Matches[0]
                $mAll = [regex]::Matches($supSent, '\b((?:19|20)\d{2}-\d{2}-\d{2})\b')
                foreach ($m in $mAll) {
                    $gc = $m.Groups[1].Value
                    if (-not $dbFaaMap.ContainsKey($gc)) {
                        $dbParentBySupFaa[$gc] = $ad
                    }
                }
            }
        }
    }
}

Write-Host "  -> Indexed DB FAA ADs: $($dbFaaMap.Count) (+$($dbParentBySupFaa.Count) chain-superseded) | Indexed DB EASA ADs: $($dbEasaMap.Count)"

Write-Host "[3/6] Consolidating 2,489 AMOS rows by base AD code and revisions..." -ForegroundColor Cyan
$consolidated = [ordered]@{}
$stopWords = @('ATA','THE','AND','FOR','WITH','INSPECTION','REPLACEMENT','MODIFICATION','REPAIR','CHECK','AMENDMENT','LIMITATIONS','AIRWORTHINESS','SECTION','PART','REV','REVISION','FUSELAGE','WINGS','ENGINE','ENGINES','FLIGHT','CONTROLS','LANDING','GEAR','EQUIPMENT','FURNISHINGS','FUEL','SYSTEM','DOORS','STABILIZERS','AIRCRAFT','MANUAL','TIME','LIMITS','MAINTENANCE','CHECKS')

foreach ($r in $sheet4) {
    $doc = ([string]$r.B).Trim()
    if (-not $doc) { continue }
    $info = Get-BaseInfo $doc
    if (-not $info) { continue }
    $bKey = "$($info.Type):$($info.Base)"

    $revStr = ([string]$r.C).Trim()
    $compStr = ([string]$r.D).Trim()
    $acCatStr = ([string]$r.E).Trim()
    $ataStr = ([string]$r.F).Trim()
    $subjStr = ([string]$r.G).Trim()
    $issDateStr = ([string]$r.H).Trim()
    $revDateStr = ([string]$r.I).Trim()
    $sA535 = ([string]$r.J).Trim()
    $sA536 = ([string]$r.K).Trim()
    $sA650 = ([string]$r.L).Trim()
    $sA812 = ([string]$r.M).Trim()

    $dtIss = Parse-AmosDate $issDateStr
    $dtRev = Parse-AmosDate $revDateStr
    $dtEff = if ($dtRev) { $dtRev } else { $dtIss }

    if (-not $consolidated.Contains($bKey)) {
        $consolidated[$bKey] = @{
            Key          = $bKey
            Info         = $info
            Revisions    = New-Object System.Collections.Generic.List[string]
            MaxRev       = $revStr
            Comp         = $compStr
            AcCat        = $acCatStr
            Ata          = $ataStr
            Subject      = $subjStr
            IssueDateDt  = $dtIss
            IssueDateRaw = $issDateStr
            EffDateDt    = $dtEff
            EffDateRaw   = $(if ($revDateStr) { $revDateStr } else { $issDateStr })
            AppA535      = ($sA535 -ne "" -and $sA535 -ne "N")
            AppA536      = ($sA536 -ne "" -and $sA536 -ne "N")
            AppA650      = ($sA650 -ne "" -and $sA650 -ne "N")
            AppA812      = ($sA812 -ne "" -and $sA812 -ne "N")
            HasAnyCellA535 = ($sA535 -ne "")
            HasAnyCellA536 = ($sA536 -ne "")
            HasAnyCellA650 = ($sA650 -ne "")
            HasAnyCellA812 = ($sA812 -ne "")
            StatusCodes  = New-Object System.Collections.Generic.List[string]
            SupersededByTarget = ""
        }
    }

    $entry = $consolidated[$bKey]
    if ($revStr -and -not $entry.Revisions.Contains($revStr)) {
        $entry.Revisions.Add($revStr)
    }
    if ($revStr -gt $entry.MaxRev) {
        $entry.MaxRev = $revStr
    }
    # Prefer a non-superseded / non-cancelled subject if one revision has the real subject, but track if latest is SUPERSEDED BY
    if ($subjStr -match 'SUPERSEDED\s+BY\s+(?:EASA\s+AD\s+|DGAC\s+FRANCE\s+AD\s+|FAA\s+AD\s+)?([A-Z0-9\-]+)') {
        $entry.SupersededByTarget = $Matches[1].Trim()
    }
    if ($subjStr -and ($entry.Subject -match '^SUPERSEDED\s+BY' -or $revStr -ge $entry.MaxRev)) {
        if ($subjStr -notmatch '^SUPERSEDED\s+BY') {
            $entry.Subject = $subjStr
        }
    }
    if ($info.RevSuffix -and (-not $entry.Info.RevSuffix -or $info.RevSuffix.Length -gt $entry.Info.RevSuffix.Length)) {
        $entry.Info = $info
    }
    if ($dtIss -and (-not $entry.IssueDateDt -or $dtIss -lt $entry.IssueDateDt)) {
        $entry.IssueDateDt = $dtIss
        $entry.IssueDateRaw = $issDateStr
    }
    if ($dtEff -and (-not $entry.EffDateDt -or $dtEff -gt $entry.EffDateDt)) {
        $entry.EffDateDt = $dtEff
        $entry.EffDateRaw = $(if ($revDateStr) { $revDateStr } else { $issDateStr })
    }
    if ($sA535 -ne "" -and $sA535 -ne "N") { $entry.AppA535 = $true; $entry.StatusCodes.Add($sA535) }
    if ($sA536 -ne "" -and $sA536 -ne "N") { $entry.AppA536 = $true; $entry.StatusCodes.Add($sA536) }
    if ($sA650 -ne "" -and $sA650 -ne "N") { $entry.AppA650 = $true; $entry.StatusCodes.Add($sA650) }
    if ($sA812 -ne "" -and $sA812 -ne "N") { $entry.AppA812 = $true; $entry.StatusCodes.Add($sA812) }
    if ($sA535 -ne "") { $entry.HasAnyCellA535 = $true }
    if ($sA536 -ne "") { $entry.HasAnyCellA536 = $true }
    if ($sA650 -ne "") { $entry.HasAnyCellA650 = $true }
    if ($sA812 -ne "") { $entry.HasAnyCellA812 = $true }
}

foreach ($k in $consolidated.Keys) {
    $e = $consolidated[$k]
    $subjUp = ([string]$e.Subject).ToUpper().Trim()
    $subjNorm = ($subjUp -replace '^ATA\s*\d+\s*[-:\?]?\s*', '' -replace '[^A-Z0-9]+', ' ' -replace '\s+', ' ').Trim()
    $e.SubjNorm = $subjNorm
    $e.AtaBase = (([string]$e.Ata).Trim() -replace '-\d+$', '').PadLeft(2, '0')
    $e.AcFam = if ($e.AppA812 -or ($e.HasAnyCellA812 -and -not $e.HasAnyCellA535 -and -not $e.HasAnyCellA536 -and -not $e.HasAnyCellA650)) { "A330" } else { "A320" }
    $e.Tokens = @($subjNorm -split '\s+' | Where-Object { $_.Length -ge 3 -and $stopWords -notcontains $_ })
}

Write-Host "  -> Consolidated into $($consolidated.Count) unique base ADs from AMOS."

Write-Host "[4/6] Pairing corresponding EASA/National ADs and FAA ADs (Pass 1 Exact + Pass 2 Token Overlap)..." -ForegroundColor Cyan

# Separate FAA and EASA/EASA_NAT entries in AMOS that are not already paired in DB
$faaToEasaPair = @{}
$easaToFaaPair = @{}

$bySubjGroup = @{}
foreach ($k in $consolidated.Keys) {
    $e = $consolidated[$k]
    if ($e.SupersededByTarget -or $e.SubjNorm -match '^SUPERSEDED BY|^CANCELLED BY') { continue }
    if ($e.SubjNorm.Length -lt 10) { continue }
    $gKey = "$($e.AtaBase)|$($e.AcFam)|$($e.SubjNorm)"
    if (-not $bySubjGroup.ContainsKey($gKey)) { $bySubjGroup[$gKey] = @{} }
    $bySubjGroup[$gKey][$k] = $e
}

# Pass 1: Exact normalized (ATA + AcFam + SubjNorm) with date/year proximity
foreach ($gKey in $bySubjGroup.Keys) {
    $map = $bySubjGroup[$gKey]
    $faas = @($map.Keys | Where-Object { $_ -like "FAA:*" } | Where-Object {
        $fc = $_.Substring(4)
        -not ($dbFaaMap.ContainsKey($fc) -and $dbFaaMap[$fc].easaAdNumber)
    })
    $easas = @($map.Keys | Where-Object { $_ -like "EASA*" } | Where-Object {
        $ec = ($_ -split ':', 2)[1]
        -not $dbEasaMap.ContainsKey($ec)
    })
    if ($faas.Count -eq 0 -or $easas.Count -eq 0) { continue }

    foreach ($fKey in ($faas | Sort-Object)) {
        $fItem = $map[$fKey]
        $bestE = $null
        $bestScore = 999999
        foreach ($eKey in ($easas | Sort-Object)) {
            if ($easaToFaaPair.ContainsKey($eKey)) { continue }
            $eItem = $map[$eKey]
            $yrDiff = $fItem.Info.Year - $eItem.Info.Year
            if ($yrDiff -lt -1 -or $yrDiff -gt 3) { continue }
            if ($fItem.IssueDateDt -and $eItem.IssueDateDt) {
                $dayDiff = ($fItem.IssueDateDt - $eItem.IssueDateDt).TotalDays
                if ($dayDiff -lt -45 -or $dayDiff -gt 1100) { continue }
                $score = [Math]::Abs($dayDiff)
            } else {
                $score = [Math]::Abs($yrDiff) * 365
            }
            if ($score -lt $bestScore) {
                $bestScore = $score
                $bestE = $eKey
            }
        }
        if ($bestE) {
            $faaToEasaPair[$fKey] = $bestE
            $easaToFaaPair[$bestE] = $fKey
        }
    }
}

$pass1Count = $faaToEasaPair.Count

# Pass 2: High token Jaccard similarity (>= 0.78, common >= 3) within same ATA + AcFam + date window [-30, +750] days
$remFaas = @($consolidated.Values | Where-Object {
    $_.Info.Type -eq "FAA" -and
    -not $faaToEasaPair.ContainsKey($_.Key) -and
    -not ($dbFaaMap.ContainsKey($_.Info.Base) -and $dbFaaMap[$_.Info.Base].easaAdNumber) -and
    $_.Tokens.Count -ge 3 -and
    -not $_.SupersededByTarget
})
$remEasas = @($consolidated.Values | Where-Object {
    ($_.Info.Type -like "EASA*") -and
    -not $easaToFaaPair.ContainsKey($_.Key) -and
    -not $dbEasaMap.ContainsKey($_.Info.Base) -and
    $_.Tokens.Count -ge 3 -and
    -not $_.SupersededByTarget
})

foreach ($fItem in $remFaas) {
    $bestE = $null
    $bestJacc = 0.0
    foreach ($eItem in $remEasas) {
        if ($easaToFaaPair.ContainsKey($eItem.Key)) { continue }
        if ($eItem.AtaBase -ne $fItem.AtaBase -or $eItem.AcFam -ne $fItem.AcFam) { continue }
        $yrDiff = $fItem.Info.Year - $eItem.Info.Year
        if ($yrDiff -lt -1 -or $yrDiff -gt 2) { continue }
        if ($fItem.IssueDateDt -and $eItem.IssueDateDt) {
            $dayDiff = ($fItem.IssueDateDt - $eItem.IssueDateDt).TotalDays
            if ($dayDiff -lt -30 -or $dayDiff -gt 750) { continue }
        }
        $common = @($fItem.Tokens | Where-Object { $eItem.Tokens -contains $_ }).Count
        if ($common -lt 3) { continue }
        $union = ($fItem.Tokens + $eItem.Tokens | Select-Object -Unique).Count
        $jacc = if ($union -gt 0) { $common / [double]$union } else { 0.0 }
        if ($jacc -ge 0.78 -and $jacc -gt $bestJacc) {
            $bestJacc = $jacc
            $bestE = $eItem.Key
        }
    }
    if ($bestE) {
        $faaToEasaPair[$fItem.Key] = $bestE
        $easaToFaaPair[$bestE] = $fItem.Key
    }
}

$pass2Count = $faaToEasaPair.Count - $pass1Count
Write-Host "  -> Paired $pass1Count exact subject pairs + $pass2Count fuzzy subject pairs = $($faaToEasaPair.Count) total EASA/FAA pairs from AMOS."

Write-Host "[5/6] Enriching existing DB ADs and building net-new AD records (deduplicating against DB)..." -ForegroundColor Cyan

$enrichedDbCount = 0
$skippedExistingCount = 0
$consumedKeys = @{}

# First, apply any pairs where ONE side already exists in DB!
foreach ($fKey in $faaToEasaPair.Keys) {
    $eKey = $faaToEasaPair[$fKey]
    $fEntry = $consolidated[$fKey]
    $eEntry = $consolidated[$eKey]
    $fBase = $fEntry.Info.Base
    $eBase = $eEntry.Info.Base

    $fInDb = $dbFaaMap.ContainsKey($fBase) -or $dbParentBySupFaa.ContainsKey($fBase)
    $eInDb = $dbEasaMap.ContainsKey($eBase) -or $dbParentBySupEasa.ContainsKey($eBase)

    if ($fInDb -and -not $eInDb) {
        if ($dbFaaMap.ContainsKey($fBase)) {
            $targetRec = $dbFaaMap[$fBase]
            if (-not $targetRec.easaAdNumber) {
                $easaDisp = Format-EasaDisplay $eEntry.Info $eEntry.MaxRev
                $easaUrl = Get-EasaUrl $eEntry.Info $eEntry.MaxRev
                $targetRec | Add-Member -NotePropertyName "easaAdNumber" -NotePropertyValue $easaDisp -Force
                $targetRec | Add-Member -NotePropertyName "easaUrl" -NotePropertyValue $easaUrl -Force
                $targetRec.authority = "EASA"
                $targetRec | Add-Member -NotePropertyName "authorityDual" -NotePropertyValue "EASA / FAA" -Force
                $targetRec.adNumber = "FAA AD $($targetRec.officialFaaAd) / $easaDisp"
                $enrichedDbCount++
            }
        }
        $consumedKeys[$fKey] = $true
        $consumedKeys[$eKey] = $true
        $skippedExistingCount += 2
    } elseif ($eInDb -and -not $fInDb) {
        if ($dbEasaMap.ContainsKey($eBase)) {
            $targetRec = $dbEasaMap[$eBase]
            if (-not $targetRec.officialFaaAd) {
                $targetRec | Add-Member -NotePropertyName "officialFaaAd" -NotePropertyValue $fBase -Force
                $targetRec.authority = "EASA"
                $targetRec | Add-Member -NotePropertyName "authorityDual" -NotePropertyValue "EASA / FAA" -Force
                $targetRec.adNumber = "FAA AD $fBase / $($targetRec.easaAdNumber)"
                $enrichedDbCount++
            }
        }
        $consumedKeys[$fKey] = $true
        $consumedKeys[$eKey] = $true
        $skippedExistingCount += 2
    } elseif ($fInDb -and $eInDb) {
        $consumedKeys[$fKey] = $true
        $consumedKeys[$eKey] = $true
        $skippedExistingCount += 2
    }
}

# Helper to build a full AeroAD record from an AMOS entry (or paired FAA + EASA entries)
function Build-AeroAdFromAmos($primaryEntry, $counterpartEntry) {
    $faaEntry = $null
    $easaEntry = $null
    $caavEntry = $null

    if ($primaryEntry.Info.Type -eq "FAA") { $faaEntry = $primaryEntry }
    elseif ($primaryEntry.Info.Type -eq "CAAV") { $caavEntry = $primaryEntry }
    else { $easaEntry = $primaryEntry }

    if ($null -ne $counterpartEntry) {
        if ($counterpartEntry.Info.Type -eq "FAA") { $faaEntry = $counterpartEntry }
        else { $easaEntry = $counterpartEntry }
    }

    # Combine aircraft applicability across both entries if paired
    $appA650 = ($primaryEntry.AppA650 -or ($null -ne $counterpartEntry -and $counterpartEntry.AppA650))
    $appA535 = ($primaryEntry.AppA535 -or ($null -ne $counterpartEntry -and $counterpartEntry.AppA535))
    $appA536 = ($primaryEntry.AppA536 -or ($null -ne $counterpartEntry -and $counterpartEntry.AppA536))
    $appA812 = ($primaryEntry.AppA812 -or ($null -ne $counterpartEntry -and $counterpartEntry.AppA812))

    $hasCellA650 = ($primaryEntry.HasAnyCellA650 -or ($null -ne $counterpartEntry -and $counterpartEntry.HasAnyCellA650))
    $hasCellA535 = ($primaryEntry.HasAnyCellA535 -or ($null -ne $counterpartEntry -and $counterpartEntry.HasAnyCellA535))
    $hasCellA536 = ($primaryEntry.HasAnyCellA536 -or ($null -ne $counterpartEntry -and $counterpartEntry.HasAnyCellA536))
    $hasCellA812 = ($primaryEntry.HasAnyCellA812 -or ($null -ne $counterpartEntry -and $counterpartEntry.HasAnyCellA812))

    $matchedTypes = New-Object System.Collections.Generic.List[string]
    $vjcLabels = New-Object System.Collections.Generic.List[string]
    $affectedCount = 0

    if ($appA650) {
        $matchedTypes.Add("A320-214")
        $vjcLabels.Add("A320-214 (15 tàu • CFM56-5B4)")
        $affectedCount += 15
    }
    if ($appA535) {
        $matchedTypes.Add("A321-211")
        $vjcLabels.Add("A321-211 CEO (41 tàu • CFM56-5B3)")
        $affectedCount += 41
    }
    if ($appA536) {
        $matchedTypes.Add("A321-271N")
        $matchedTypes.Add("A321-271NX")
        $vjcLabels.Add("A321-271N NEO (11 tàu • PW1133G-JM)")
        $vjcLabels.Add("A321-271NX NEO ACF (33 tàu • PW1133G-JM)")
        $affectedCount += 44
    }
    if ($appA812) {
        $matchedTypes.Add("A330-343")
        $vjcLabels.Add("A330-343 Widebody (8 tàu • RR Trent 772B-60)")
        $affectedCount += 8
    }

    $isApplicable = ($matchedTypes.Count -gt 0)
    $appStatus = if ($isApplicable) { "Applicable" } else { "Not Applicable" }

    # Determine target model & engine description
    $scopeModels = New-Object System.Collections.Generic.List[string]
    $scopeEngines = New-Object System.Collections.Generic.List[string]
    if ($appA650 -or $hasCellA650) { $scopeModels.Add("Airbus A320-214"); $scopeEngines.Add("CFM56-5B4/3 & 5B4/P") }
    if ($appA535 -or $hasCellA535) { $scopeModels.Add("Airbus A321-211"); $scopeEngines.Add("CFM56-5B3/3 & 5B3/P") }
    if ($appA536 -or $hasCellA536) { $scopeModels.Add("Airbus A321-271N / A321-271NX"); $scopeEngines.Add("PW1133G-JM") }
    if ($appA812 -or $hasCellA812) { $scopeModels.Add("Airbus A330-343"); $scopeEngines.Add("RR Trent 772B-60") }

    if ($scopeModels.Count -eq 0) {
        $scopeModels.Add("Airbus A320 / A321 / A330 Series")
        $scopeEngines.Add("CFM56-5B / PW1133G-JM / Trent 772B-60")
    }

    $extractedModelsStr = ($scopeModels | Select-Object -Unique) -join ", "
    $extractedEnginesStr = ($scopeEngines | Select-Object -Unique) -join " / "
    $vjcMatchedSummaryStr = if ($isApplicable) {
        $vjcLabels -join " + "
    } else {
        "Not Applicable trên đội tàu VJC (Theo kiểm soát kỹ thuật AMOS VJC18828)"
    }
    $targetModelStr = if ($isApplicable) {
        "$extractedModelsStr → Khớp VJC: $vjcMatchedSummaryStr"
    } else {
        "$extractedModelsStr (Không áp dụng cho MSN đội tàu VJC hiện tại)"
    }

    # Build AD Number, Authority, URLs
    $adNumber = ""
    $authority = "EASA"
    $authorityDual = ""
    $officialFaaAd = ""
    $easaAdNumber = ""
    $easaUrl = ""
    $pdfUrl = ""
    $sourceUrl = ""
    $idSlug = ""

    if ($null -ne $faaEntry -and $null -ne $easaEntry) {
        $officialFaaAd = $faaEntry.Info.Base
        $easaAdNumber = Format-EasaDisplay $easaEntry.Info $easaEntry.MaxRev
        $easaUrl = Get-EasaUrl $easaEntry.Info $easaEntry.MaxRev
        $adNumber = "FAA AD $officialFaaAd / $easaAdNumber"
        $authority = "EASA"
        $authorityDual = "EASA / FAA"
        $pdfUrl = "/api/resolve-ad-pdf?ad=$([System.Uri]::EscapeDataString($officialFaaAd))"
        $sourceUrl = $easaUrl
        $idSlug = "AMOS-PAIR-$officialFaaAd-$($easaEntry.Info.Base)"
    } elseif ($null -ne $faaEntry) {
        $officialFaaAd = $faaEntry.Info.Base
        $adNumber = "FAA AD $officialFaaAd"
        $authority = "FAA"
        $authorityDual = "FAA"
        $pdfUrl = "/api/resolve-ad-pdf?ad=$([System.Uri]::EscapeDataString($officialFaaAd))"
        $sourceUrl = "https://www.federalregister.gov/documents/search?conditions%5Bterm%5D=$([System.Uri]::EscapeDataString($officialFaaAd))"
        $idSlug = "AMOS-FAA-$officialFaaAd"
    } elseif ($null -ne $caavEntry) {
        $caavCode = $caavEntry.Info.Base
        $adNumber = "CAAV AD $caavCode"
        $authority = "CAAV"
        $authorityDual = "CAAV"
        $pdfUrl = "https://caa.gov.vn/"
        $sourceUrl = "https://caa.gov.vn/"
        $idSlug = "AMOS-$caavCode"
    } else {
        $easaAdNumber = Format-EasaDisplay $easaEntry.Info $easaEntry.MaxRev
        $easaUrl = Get-EasaUrl $easaEntry.Info $easaEntry.MaxRev
        $adNumber = $easaAdNumber
        $authority = "EASA"
        $authorityDual = "EASA"
        $pdfUrl = $easaUrl
        $sourceUrl = $easaUrl
        $idSlug = "AMOS-EASA-$($easaEntry.Info.Base -replace '[^A-Z0-9\-]', '')"
    }

    $issIso = Format-IsoDate $primaryEntry.IssueDateDt "2000-01-01"
    $effIso = Format-IsoDate $primaryEntry.EffDateDt $issIso
    $ataFormatted = Format-AtaLabel $primaryEntry.Ata
    $revsJoined = ($primaryEntry.Revisions | Sort-Object) -join ", "
    $subjClean = $primaryEntry.Subject

    # Check if repetitive ("R" in StatusCodes or "INSPECTION" / "ALS" in subject)
    $isRep = ($primaryEntry.StatusCodes -contains "R") -or ($subjClean -match 'AIRWORTHINESS LIMITATIONS|REPETITIVE')
    $repInterval = if ($isRep) { "Repeat: Theo văn bản AD gốc (FH / FC / Days)" } else { "Theo văn bản AD gốc" }

    $summaryText = "[$adNumber | Rev: $revsJoined | ATA $($primaryEntry.Ata) | Issued: $($primaryEntry.IssueDateRaw)] $subjClean"
    if ($null -ne $counterpartEntry) {
        $summaryText += " (Merged Equivalent: FAA AD $officialFaaAd & $easaAdNumber)."
    }

    return [pscustomobject][ordered]@{
        id                  = $idSlug
        adNumber            = $adNumber
        authority           = $authority
        authorityDual       = $authorityDual
        officialFaaAd       = $officialFaaAd
        easaAdNumber        = $easaAdNumber
        easaUrl             = $easaUrl
        adClass             = "Final Rule AD"
        docketNo            = $(if ($easaAdNumber) { $easaAdNumber } else { $adNumber })
        amendmentNum        = "Rev $revsJoined"
        issuedDate          = $issIso
        issueDate           = $issIso
        effectiveDate       = $effIso
        ata                 = $ataFormatted
        category            = $(if ($primaryEntry.AcCat -eq "C" -or $primaryEntry.Ata -match '^7[1-9]') { "Engine / Component" } else { "Aircraft" })
        targetModel         = $targetModelStr
        adExtractedModels   = $extractedModelsStr
        adExtractedEngines  = $extractedEnginesStr
        adMsnScope          = "Theo danh mục AD kiểm soát kỹ thuật VJC (AMOS Report VJC18828)"
        vjcMatchedSummary   = $vjcMatchedSummaryStr
        matchedTypes        = @($matchedTypes)
        subject             = $subjClean
        summary             = $summaryText
        rawRequirementText  = $summaryText
        applicabilityStatus = $appStatus
        affectedCount       = $affectedCount
        isRepetitive        = $isRep
        repetitiveInterval  = $repInterval
        complianceTime      = "Xem chi tiết trong file PDF AD gốc"
        complianceStatus    = $(if ($isRep) { "Repetitive" } else { "Active" })
        isSuperseded        = $false
        supersededBy        = ""
        supersededAds       = @()
        sourceUrl           = $sourceUrl
        pdfUrl              = $pdfUrl
        fullTextHtmlUrl     = ""
    }
}

$newAdRecords = New-Object System.Collections.Generic.List[object]
$newAdByFaa = @{}
$newAdByEasa = @{}
$supersededAmosEntries = New-Object System.Collections.Generic.List[object]
$newMergedPairsCount = 0

# Process newly paired FAA + EASA entries where NEITHER was in DB
foreach ($fKey in $faaToEasaPair.Keys) {
    if ($consumedKeys.ContainsKey($fKey)) { continue }
    $eKey = $faaToEasaPair[$fKey]
    if ($consumedKeys.ContainsKey($eKey)) { continue }

    $fEntry = $consolidated[$fKey]
    $eEntry = $consolidated[$eKey]

    $newObj = Build-AeroAdFromAmos $fEntry $eEntry
    $newAdRecords.Add($newObj)
    $newAdByFaa[$fEntry.Info.Base] = $newObj
    $newAdByEasa[$eEntry.Info.Base] = $newObj

    $consumedKeys[$fKey] = $true
    $consumedKeys[$eKey] = $true
    $newMergedPairsCount++
}

# Process remaining single AMOS entries
foreach ($k in $consolidated.Keys) {
    if ($consumedKeys.ContainsKey($k)) { continue }
    $entry = $consolidated[$k]
    $info = $entry.Info

    # Check if already in DB!
    if ($info.Type -eq "FAA") {
        if ($dbFaaMap.ContainsKey($info.Base) -or $dbParentBySupFaa.ContainsKey($info.Base)) {
            $skippedExistingCount++
            $consumedKeys[$k] = $true
            continue
        }
    } elseif ($info.Type -eq "EASA" -or $info.Type -eq "EASA_NAT") {
        if ($dbEasaMap.ContainsKey($info.Base) -or $dbParentBySupEasa.ContainsKey($info.Base)) {
            $skippedExistingCount++
            $consumedKeys[$k] = $true
            continue
        }
    }

    # Check if this entry is explicitly marked "SUPERSEDED BY <TARGET>"
    if ($entry.SupersededByTarget) {
        $supersededAmosEntries.Add($entry)
        $consumedKeys[$k] = $true
        continue
    }

    $newObj = Build-AeroAdFromAmos $entry $null
    $newAdRecords.Add($newObj)
    if ($info.Type -eq "FAA") {
        $newAdByFaa[$info.Base] = $newObj
    } elseif ($info.Type -eq "EASA" -or $info.Type -eq "EASA_NAT") {
        $newAdByEasa[$info.Base] = $newObj
    }
    $consumedKeys[$k] = $true
}

# Attach SUPERSEDED BY entries to their superseding parent AD (following chains if needed)
$attachedSupCount = 0
foreach ($supEntry in $supersededAmosEntries) {
    $targetCode = $supEntry.SupersededByTarget
    $hop = 0
    while ($hop -lt 5) {
        $hop++
        $tInfo = Get-BaseInfo $targetCode
        if (-not $tInfo) { break }
        $tKey = "$($tInfo.Type):$($tInfo.Base)"
        if ($consolidated.Contains($tKey) -and $consolidated[$tKey].SupersededByTarget) {
            $targetCode = $consolidated[$tKey].SupersededByTarget
        } else {
            break
        }
    }
    $finalInfo = Get-BaseInfo $targetCode
    $parentAd = $null
    if ($finalInfo) {
        if ($finalInfo.Type -eq "FAA") {
            if ($dbFaaMap.ContainsKey($finalInfo.Base)) { $parentAd = $dbFaaMap[$finalInfo.Base] }
            elseif ($newAdByFaa.ContainsKey($finalInfo.Base)) { $parentAd = $newAdByFaa[$finalInfo.Base] }
        } else {
            if ($dbEasaMap.ContainsKey($finalInfo.Base)) { $parentAd = $dbEasaMap[$finalInfo.Base] }
            elseif ($newAdByEasa.ContainsKey($finalInfo.Base)) { $parentAd = $newAdByEasa[$finalInfo.Base] }
            elseif ($finalInfo.Base -notmatch '^F-' -and $newAdByEasa.ContainsKey("F-$($finalInfo.Base)")) {
                $parentAd = $newAdByEasa["F-$($finalInfo.Base)"]
            }
        }
    }

    if ($null -ne $parentAd) {
        $supObj = Build-AeroAdFromAmos $supEntry $null
        $supItem = [pscustomobject][ordered]@{
            adNumber            = $supObj.adNumber
            officialFaaAd       = $supObj.officialFaaAd
            easaAdNumber        = $supObj.easaAdNumber
            easaUrl             = $supObj.easaUrl
            authority           = $supObj.authority
            issuedDate          = $supObj.issuedDate
            effectiveDate       = $supObj.effectiveDate
            subject             = $supObj.subject
            summary             = $supObj.summary
            applicabilityStatus = "Superseded"
            complianceStatus    = "Superseded"
            supersededBy        = $parentAd.adNumber
            sourceUrl           = $supObj.sourceUrl
            pdfUrl              = $supObj.pdfUrl
        }
        $existingSups = @($parentAd.supersededAds)
        $alreadyHas = $false
        foreach ($es in $existingSups) {
            if ($es.adNumber -eq $supItem.adNumber) { $alreadyHas = $true; break }
        }
        if (-not $alreadyHas) {
            $existingSups += $supItem
            $parentAd.supersededAds = $existingSups
            $attachedSupCount++
        }
    } else {
        # Fallback: add as standalone if superseding target isn't found
        $newObj = Build-AeroAdFromAmos $supEntry $null
        $newAdRecords.Add($newObj)
    }
}

Write-Host "  -> Skipped existing in DB:       $skippedExistingCount base ADs"
Write-Host "  -> Enriched existing DB pairs:   $enrichedDbCount records"
Write-Host "  -> Newly merged FAA+EASA pairs:  $newMergedPairsCount records"
Write-Host "  -> Attached SUPERSEDED BY items: $attachedSupCount records"
Write-Host "  -> Total net-new ADs added:      $($newAdRecords.Count) records"

Write-Host "[6/6] Merging and saving updated db\aeroad-database.json..." -ForegroundColor Cyan
$combinedAds = New-Object System.Collections.Generic.List[object]
foreach ($a in $db.ads) { $combinedAds.Add($a) }
foreach ($na in $newAdRecords) { $combinedAds.Add($na) }

# Sort by effectiveDate descending
$sortedAds = @($combinedAds | Sort-Object -Property @{Expression = { [string]$_.effectiveDate }; Descending = $true })

$totalSupCnt = 0
$supGroupCnt = 0
$appCnt = 0
$notAppCnt = 0
foreach ($a in $sortedAds) {
    if ($a.applicabilityStatus -eq "Applicable") { $appCnt++ } else { $notAppCnt++ }
    if ($a.supersededAds -and $a.supersededAds.Count -gt 0) {
        $supGroupCnt++
        $totalSupCnt += $a.supersededAds.Count
    }
}

$nowStr = (Get-Date).ToString("dd/MM/yyyy HH:mm:ss")
$db | Add-Member -NotePropertyName "lastSyncedAt" -NotePropertyValue $nowStr -Force
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

Write-Host "DONE! Database now has $($sortedAds.Count) active ADs + $totalSupCnt superseded ADs = $($sortedAds.Count + $totalSupCnt) total ADs." -ForegroundColor Green
