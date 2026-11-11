param(
  [string]$DbPath = (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "db\aeroad-database.json")
)

$ErrorActionPreference = "Stop"
$RawJson = [System.IO.File]::ReadAllText($DbPath, [System.Text.Encoding]::UTF8)
$Db = $RawJson | ConvertFrom-Json

# 1. Collect all Active ADs AND Superseded ADs that don't have an EASA AD number yet (or missing FAA AD)
$Targets = @()
for ($i = 0; $i -lt $Db.ads.Count; $i++) {
  $ad = $Db.ads[$i]
  $needScan = (-not $ad.easaAdNumber -or $ad.easaAdNumber -eq "" -or -not $ad.officialFaaAd -or $ad.officialFaaAd -eq "")
  if ($needScan -and $ad.fullTextHtmlUrl -like "https://www.govinfo.gov/*") {
    $Targets += [PSCustomObject]@{
      IsSup  = $false
      AdIdx  = $i
      SupIdx = -1
      HtmUrl = [string]$ad.fullTextHtmlUrl
    }
  }
  if ($ad.supersededAds) {
    for ($j = 0; $j -lt $ad.supersededAds.Count; $j++) {
      $s = $ad.supersededAds[$j]
      if ($s.adNumber -notmatch 'EASA AD|DGAC AD' -and $s.fullTextHtmlUrl -like "https://www.govinfo.gov/*") {
        $Targets += [PSCustomObject]@{
          IsSup  = $true
          AdIdx  = $i
          SupIdx = $j
          HtmUrl = [string]$s.fullTextHtmlUrl
        }
      }
    }
  }
}

Write-Host "Scanning $($Targets.Count) remaining GovInfo Full-Text AD documents in parallel (30 threads) for exact EASA/DGAC & FAA AD numbers..." -ForegroundColor Cyan

$Pool = [runspacefactory]::CreateRunspacePool(1, 30)
$Pool.Open()

$ScriptBlock = {
  param($IsSup, $AdIdx, $SupIdx, $HtmUrl)
  $faaAd = ""
  $easaAd = ""
  $easaCodeOnly = ""
  try {
    $req = [System.Net.WebRequest]::Create($HtmUrl)
    $req.Timeout = 12000
    $resp = $req.GetResponse()
    $stream = $resp.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
    $raw = $reader.ReadToEnd()
    $reader.Close()
    $resp.Close()

    $norm = $raw -replace '-\s+([0-9A-Z])', '-$1'
    $norm = $norm -replace '\s+', ' '

    # 1. Exact FAA AD number
    $mFaa = [regex]::Match($norm, '(?:Amendment\s+39-[0-9]+;\s*AD\s+|;\s*AD\s+)([0-9]{4}-[0-9]{2}-[0-9]{2}[A-Z0-9\-]*)')
    if ($mFaa.Success) {
      $faaAd = $mFaa.Groups[1].Value.Trim().TrimEnd('.', ',')
    }

    # 2. Exact EASA AD number (or DGAC France AD for older Airbus ADs)
    $mEasaPri = [regex]::Match($norm, '(?:Exceptions to|prompted by|specified in|accordance with|referred to as|issued)\s+(?:European Union Aviation Safety Agency\s*\(EASA\)\s*|EASA\s*)(?:Emergency\s+)?AD\s+(?:No\.\s*)?([0-9]{4}-[0-9]{4}[A-Z0-9\-]*|[0-9]{4}-[0-9]{3}[A-Z0-9\-]*)', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($mEasaPri.Success) {
      $easaCodeOnly = $mEasaPri.Groups[1].Value.Trim().TrimEnd('.', ',')
      $easaAd = "EASA AD $easaCodeOnly"
    } else {
      $mEasaAny = [regex]::Match($norm, '(?:EASA|European Union Aviation Safety Agency\s*\(EASA\)|European Aviation Safety Agency\s*\(EASA\))\s+(?:Emergency\s+)?AD\s+(?:No\.\s*)?([0-9]{4}-[0-9]{4}[A-Z0-9\-]*|[0-9]{4}-[0-9]{3}[A-Z0-9\-]*)', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
      if ($mEasaAny.Success) {
        $easaCodeOnly = $mEasaAny.Groups[1].Value.Trim().TrimEnd('.', ',')
        $easaAd = "EASA AD $easaCodeOnly"
      } else {
        # Check for French DGAC AD on pre-2006 Airbus ADs (e.g., "French airworthiness directive F-2004-089" or "2002-342(B)")
        $mDgac = [regex]::Match($norm, '(?:French|DGAC)\s+airworthiness\s+directive\s+(?:No\.\s*)?([F\-]*[0-9]{4}-[0-9]{3}[A-Z0-9\(\)\-]*)', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
        if ($mDgac.Success) {
          $dgacCode = $mDgac.Groups[1].Value.Trim().TrimEnd('.', ',')
          $easaAd = "DGAC AD $dgacCode"
        }
      }
    }
  } catch {}

  return [PSCustomObject]@{
    IsSup    = $IsSup
    AdIdx    = $AdIdx
    SupIdx   = $SupIdx
    FaaAd    = $faaAd
    EasaAd   = $easaAd
    EasaCode = $easaCodeOnly
  }
}

$Jobs = @()
foreach ($t in $Targets) {
  $ps = [powershell]::Create().AddScript($ScriptBlock).AddArgument($t.IsSup).AddArgument($t.AdIdx).AddArgument($t.SupIdx).AddArgument($t.HtmUrl)
  $ps.RunspacePool = $Pool
  $Jobs += [PSCustomObject]@{
    Pipe   = $ps
    Handle = $ps.BeginInvoke()
  }
}

$Results = @()
foreach ($j in $Jobs) {
  $res = $j.Pipe.EndInvoke($j.Handle)
  $j.Pipe.Dispose()
  if ($res) { $Results += $res }
}
$Pool.Close()
$Pool.Dispose()

$NewEasaFound = 0
$NewSupEasaFound = 0
$FaaToEasaMap = @{}

foreach ($r in $Results) {
  if (-not $r.IsSup) {
    $ad = $Db.ads[$r.AdIdx]
    if ($r.FaaAd -and (-not $ad.officialFaaAd -or $ad.officialFaaAd -eq "")) {
      $ad | Add-Member -NotePropertyName "officialFaaAd" -NotePropertyValue $r.FaaAd -Force
    }
    if ($r.EasaAd -and (-not $ad.easaAdNumber -or $ad.easaAdNumber -eq "")) {
      $ad | Add-Member -NotePropertyName "easaAdNumber" -NotePropertyValue $r.EasaAd -Force
      if ($r.EasaCode) {
        $ad | Add-Member -NotePropertyName "easaUrl" -NotePropertyValue "https://ad.easa.europa.eu/ad/$($r.EasaCode)" -Force
      }
      $NewEasaFound++
    }
  } else {
    $s = $Db.ads[$r.AdIdx].supersededAds[$r.SupIdx]
    if ($r.EasaAd) {
      $mSupFaa = [regex]::Match([string]$s.adNumber, '\b([0-9]{4}-[0-9]{2}-[0-9]{2}[A-Z0-9]*)\b')
      if ($mSupFaa.Success) {
        $s.adNumber = "FAA AD $($mSupFaa.Groups[1].Value) / $($r.EasaAd)"
      } else {
        $s.adNumber = $r.EasaAd
      }
      if ($r.EasaCode) {
        $s | Add-Member -NotePropertyName "easaUrl" -NotePropertyValue "https://ad.easa.europa.eu/ad/$($r.EasaCode)" -Force
      }
      $NewSupEasaFound++
    }
  }
}

# Re-standardize all adNumber fields and populate FaaToEasaMap
foreach ($ad in $Db.ads) {
  $faaCode = ([string]$ad.officialFaaAd).Trim()
  $easaStr = ([string]$ad.easaAdNumber).Trim()
  if ($faaCode -and $easaStr) {
    $FaaToEasaMap[$faaCode] = $easaStr
  }
  if ($ad.authority -eq "CAAV") {
    continue
  } elseif ($faaCode -and $easaStr) {
    $ad | Add-Member -NotePropertyName "adNumber" -NotePropertyValue "FAA AD $faaCode / $easaStr" -Force
    $ad | Add-Member -NotePropertyName "authority" -NotePropertyValue "EASA" -Force
    $ad | Add-Member -NotePropertyName "authorityDual" -NotePropertyValue "EASA / FAA" -Force
  } elseif ($faaCode) {
    $ad | Add-Member -NotePropertyName "adNumber" -NotePropertyValue "FAA AD $faaCode" -Force
    $ad | Add-Member -NotePropertyName "authority" -NotePropertyValue "FAA" -Force
    $ad | Add-Member -NotePropertyName "authorityDual" -NotePropertyValue "FAA" -Force
  } elseif ($easaStr) {
    $ad | Add-Member -NotePropertyName "adNumber" -NotePropertyValue $easaStr -Force
    $ad | Add-Member -NotePropertyName "authority" -NotePropertyValue "EASA" -Force
    $ad | Add-Member -NotePropertyName "authorityDual" -NotePropertyValue "EASA" -Force
  }
}

# Propagate FaaToEasaMap to any Superseded ADs
foreach ($ad in $Db.ads) {
  if ($ad.supersededAds) {
    foreach ($s in $ad.supersededAds) {
      $s.supersededBy = $ad.adNumber
      if ($s.adNumber -notmatch 'EASA AD|DGAC AD') {
        $mSupFaa = [regex]::Match([string]$s.adNumber, '\b([0-9]{4}-[0-9]{2}-[0-9]{2}[A-Z0-9]*)\b')
        if ($mSupFaa.Success -and $FaaToEasaMap.ContainsKey($mSupFaa.Groups[1].Value)) {
          $fCode = $mSupFaa.Groups[1].Value
          $s.adNumber = "FAA AD $fCode / $($FaaToEasaMap[$fCode])"
        }
      }
    }
  }
}

# Deduplicate any identical adNumber entries if a correction notice and original rule collided
$SeenAdIds = @{}
$UniqueAds = @()
foreach ($ad in $Db.ads) {
  $key = [string]$ad.adNumber
  if (-not $SeenAdIds.ContainsKey($key)) {
    $SeenAdIds[$key] = $true
    $UniqueAds += $ad
  }
}
$Db | Add-Member -NotePropertyName "ads" -NotePropertyValue $UniqueAds -Force

$OutJson = $Db | ConvertTo-Json -Depth 12 -Compress
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($DbPath, $OutJson, $Utf8NoBom)
Write-Host "Extracted $NewEasaFound additional Active EASA/DGAC ADs and $NewSupEasaFound Superseded EASA/DGAC ADs! Total unique Active ADs: $($UniqueAds.Count)" -ForegroundColor Green
