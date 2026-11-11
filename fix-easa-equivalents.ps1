param(
  [string]$DbPath = (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "db\aeroad-database.json")
)

$ErrorActionPreference = "Stop"
$RawJson = [System.IO.File]::ReadAllText($DbPath, [System.Text.Encoding]::UTF8)
$Db = $RawJson | ConvertFrom-Json

# Collect all Active ADs and Superseded ADs that have a GovInfo fullTextHtmlUrl and relate to EASA / Airbus / European TC holders
$Targets = @()
for ($i = 0; $i -lt $Db.ads.Count; $i++) {
  $ad = $Db.ads[$i]
  if ($ad.fullTextHtmlUrl -like "https://www.govinfo.gov/*" -and ($ad.authority -eq "EASA" -or $ad.easaAdNumber -or "$($ad.subject) $($ad.summary)" -match '(?i)EASA|Airbus|Rolls-Royce|Trent|Safran|ATR|Fokker|Dassault|Pilatus')) {
    $Targets += [PSCustomObject]@{
      IsSup  = $false
      AdIdx  = $i
      SupIdx = -1
      HtmUrl = [string]$ad.fullTextHtmlUrl
      OldNum = [string]$ad.adNumber
    }
  }
  if ($ad.supersededAds) {
    for ($j = 0; $j -lt $ad.supersededAds.Count; $j++) {
      $s = $ad.supersededAds[$j]
      if ($s.fullTextHtmlUrl -like "https://www.govinfo.gov/*" -and ("$($s.adNumber) $($s.subject) $($s.summary)" -match '(?i)EASA|Airbus|Rolls-Royce|Trent|Safran')) {
        $Targets += [PSCustomObject]@{
          IsSup  = $true
          AdIdx  = $i
          SupIdx = $j
          HtmUrl = [string]$s.fullTextHtmlUrl
          OldNum = [string]$s.adNumber
        }
      }
    }
  }
}

Write-Host "Re-scanning $($Targets.Count) GovInfo Full-Text AD documents with Regulatory-Section Priority to get 100% accurate EASA AD equivalents..." -ForegroundColor Cyan

$Pool = [runspacefactory]::CreateRunspacePool(1, 30)
$Pool.Open()

$ScriptBlock = {
  param($IsSup, $AdIdx, $SupIdx, $HtmUrl)
  $easaAd = ""
  $easaCodeOnly = ""
  $supFaaToEasaPairs = @{}

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

    # Extract any explicit historical mapping in Background: "AD 2024-25-06 ... was prompted by EASA AD 2024-0216"
    $histMatches = [regex]::Matches($norm, '\bAD\s+([0-9]{4}-[0-9]{2}-[0-9]{2})\b[^.]{0,120}?was\s+prompted\s+by\s+(?:European Union Aviation Safety Agency\s*\(EASA\)\s*|EASA\s*)(?:Emergency\s+)?AD\s+(?:No\.\s*)?([0-9]{4}-[0-9]{4}[A-Z0-9\-]*)', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    foreach ($hm in $histMatches) {
      $oldFaa = $hm.Groups[1].Value.Trim()
      $oldEasa = $hm.Groups[2].Value.Trim().TrimEnd('.', ',')
      $supFaaToEasaPairs[$oldFaa] = $oldEasa
    }

    # Priority 1: "(h) Exceptions to EASA AD <NUMBER>" or "Exceptions to EASA AD <NUMBER>" (100% guaranteed to be the CURRENT EASA AD!)
    $mExc = [regex]::Match($norm, 'Exceptions\s+to\s+(?:European Union Aviation Safety Agency\s*\(EASA\)\s*|EASA\s*)(?:Emergency\s+)?AD\s+(?:No\.\s*)?([0-9]{4}-[0-9]{4}[A-Z0-9\-]*|[0-9]{4}-[0-9]{3}[A-Z0-9\-]*)', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($mExc.Success) {
      $easaCodeOnly = $mExc.Groups[1].Value.Trim().TrimEnd('.', ',')
    }

    # Priority 2: "accordance with, European Union Aviation Safety Agency (EASA) AD <NUMBER>" or "specified in EASA AD <NUMBER>" in Required Actions / IBR
    if (-not $easaCodeOnly) {
      $mIbr = [regex]::Match($norm, '(?:accordance\s+with,?\s+|incorporates\s+by\s+reference\s+)(?:European Union Aviation Safety Agency\s*\(EASA\)\s*|EASA\s*)(?:Emergency\s+)?AD\s+(?:No\.\s*)?([0-9]{4}-[0-9]{4}[A-Z0-9\-]*|[0-9]{4}-[0-9]{3}[A-Z0-9\-]*)', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
      if ($mIbr.Success) {
        $easaCodeOnly = $mIbr.Groups[1].Value.Trim().TrimEnd('.', ',')
      }
    }

    # Priority 3: "(?:This AD|The SNPRM|The NPRM) was prompted by ... EASA AD <NUMBER>" (and if followed by "revised by EASA AD <REV>", take that!)
    if (-not $easaCodeOnly) {
      $mPrm = [regex]::Match($norm, '(?:This\s+AD|The\s+SNPRM|The\s+NPRM)\s+was\s+prompted\s+by\s+(?:European Union Aviation Safety Agency\s*\(EASA\)\s*|EASA\s*)(?:Emergency\s+)?AD\s+(?:No\.\s*)?([0-9]{4}-[0-9]{4}[A-Z0-9\-]*|[0-9]{4}-[0-9]{3}[A-Z0-9\-]*)(?:[^.]{0,120}?revised\s+by\s+EASA\s+AD\s+([0-9]{4}-[0-9]{4}[A-Z0-9\-]*))?', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
      if ($mPrm.Success) {
        if ($mPrm.Groups[2].Success -and $mPrm.Groups[2].Value) {
          $easaCodeOnly = $mPrm.Groups[2].Value.Trim().TrimEnd('.', ',')
        } else {
          $easaCodeOnly = $mPrm.Groups[1].Value.Trim().TrimEnd('.', ',')
        }
      }
    }

    # Priority 4: Split at Regulatory Text ("14 CFR part 39 is amended as follows" or "(g) Required Actions") and search inside the Regulatory Text first
    if (-not $easaCodeOnly) {
      $regPart = $norm
      $splitIdx = $norm.IndexOf("14 CFR part 39 is amended")
      if ($splitIdx -gt 0) {
        $regPart = $norm.Substring($splitIdx)
      }
      $mRegEasa = [regex]::Match($regPart, '(?:EASA|European Union Aviation Safety Agency\s*\(EASA\)|European Aviation Safety Agency\s*\(EASA\))\s+(?:Emergency\s+)?AD\s+(?:No\.\s*)?([0-9]{4}-[0-9]{4}[A-Z0-9\-]*|[0-9]{4}-[0-9]{3}[A-Z0-9\-]*)', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
      if ($mRegEasa.Success) {
        $easaCodeOnly = $mRegEasa.Groups[1].Value.Trim().TrimEnd('.', ',')
      }
    }

    # Priority 5: Last EASA AD mentioned in the preamble (excluding any old EASA AD tied to "AD 20XX-XX-XX was prompted by")
    if (-not $easaCodeOnly) {
      $allM = [regex]::Matches($norm, '(?:EASA|European Union Aviation Safety Agency\s*\(EASA\)|European Aviation Safety Agency\s*\(EASA\))\s+(?:Emergency\s+)?AD\s+(?:No\.\s*)?([0-9]{4}-[0-9]{4}[A-Z0-9\-]*|[0-9]{4}-[0-9]{3}[A-Z0-9\-]*)', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
      $oldEasaSet = @($supFaaToEasaPairs.Values)
      foreach ($m in $allM) {
        $cand = $m.Groups[1].Value.Trim().TrimEnd('.', ',')
        if ($cand -notin $oldEasaSet) {
          $easaCodeOnly = $cand
          break
        }
      }
      if (-not $easaCodeOnly -and $allM.Count -gt 0) {
        $easaCodeOnly = $allM[$allM.Count - 1].Groups[1].Value.Trim().TrimEnd('.', ',')
      }
    }

    if ($easaCodeOnly) {
      $easaAd = "EASA AD $easaCodeOnly"
    }
  } catch {}

  return [PSCustomObject]@{
    IsSup             = $IsSup
    AdIdx             = $AdIdx
    SupIdx            = $SupIdx
    EasaAd            = $easaAd
    EasaCode          = $easaCodeOnly
    SupFaaToEasaPairs = $supFaaToEasaPairs
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

$ChangedCount = 0
$GlobalHistMap = @{}

foreach ($r in $Results) {
  if ($r.SupFaaToEasaPairs) {
    foreach ($k in $r.SupFaaToEasaPairs.Keys) {
      $GlobalHistMap[$k] = "EASA AD $($r.SupFaaToEasaPairs[$k])"
    }
  }

  if (-not $r.IsSup -and $r.EasaCode) {
    $ad = $Db.ads[$r.AdIdx]
    $faaCode = ([string]$ad.officialFaaAd).Trim()
    $baseCode = $r.EasaCode -replace 'R[0-9]+$', ''
    $displayEasa = if ($r.EasaCode -ne $baseCode) {
      "EASA AD $($r.EasaCode) ($baseCode)"
    } else {
      "EASA AD $($r.EasaCode)"
    }
    $newAdNum = if ($faaCode) { "FAA AD $faaCode / $displayEasa" } else { $displayEasa }
    if ($ad.adNumber -ne $newAdNum) {
      $ChangedCount++
    }
    $ad | Add-Member -NotePropertyName "easaAdNumber" -NotePropertyValue $displayEasa -Force
    $ad | Add-Member -NotePropertyName "easaUrl" -NotePropertyValue "https://ad.easa.europa.eu/ad/$($r.EasaCode)" -Force
    $ad | Add-Member -NotePropertyName "adNumber" -NotePropertyValue $newAdNum -Force
  } elseif ($r.IsSup -and $r.EasaCode) {
    $s = $Db.ads[$r.AdIdx].supersededAds[$r.SupIdx]
    $mSupFaa = [regex]::Match([string]$s.adNumber, '\b([0-9]{4}-[0-9]{2}-[0-9]{2}[A-Z0-9]*)\b')
    $baseCode = $r.EasaCode -replace 'R[0-9]+$', ''
    $displayEasa = if ($r.EasaCode -ne $baseCode) {
      "EASA AD $($r.EasaCode) ($baseCode)"
    } else {
      "EASA AD $($r.EasaCode)"
    }
    if ($mSupFaa.Success) {
      $s.adNumber = "FAA AD $($mSupFaa.Groups[1].Value) / $displayEasa"
      $s | Add-Member -NotePropertyName "officialFaaAd" -NotePropertyValue $mSupFaa.Groups[1].Value -Force
    } else {
      $s.adNumber = $displayEasa
    }
    $s | Add-Member -NotePropertyName "easaAdNumber" -NotePropertyValue $displayEasa -Force
    $s | Add-Member -NotePropertyName "easaUrl" -NotePropertyValue "https://ad.easa.europa.eu/ad/$($r.EasaCode)" -Force
  }
}

# Also apply GlobalHistMap to any Superseded ADs mentioned in Background ("AD 2024-25-06 was prompted by EASA AD 2024-0216")
foreach ($ad in $Db.ads) {
  if ($ad.supersededAds) {
    foreach ($s in $ad.supersededAds) {
      $s.supersededBy = $ad.adNumber
      $mSupFaa = [regex]::Match([string]$s.adNumber, '\b([0-9]{4}-[0-9]{2}-[0-9]{2}[A-Z0-9]*)\b')
      if ($mSupFaa.Success) {
        $fCode = $mSupFaa.Groups[1].Value
        $s | Add-Member -NotePropertyName "officialFaaAd" -NotePropertyValue $fCode -Force
        if ($GlobalHistMap.ContainsKey($fCode)) {
          $s.adNumber = "FAA AD $fCode / $($GlobalHistMap[$fCode])"
          $s | Add-Member -NotePropertyName "easaAdNumber" -NotePropertyValue $GlobalHistMap[$fCode] -Force
        }
      }
      $mSupEasa = [regex]::Match([string]$s.adNumber, '(EASA\s+AD\s+[0-9]{4}-[0-9]{3,4}[A-Z0-9\-\s\(\)]*)')
      if ($mSupEasa.Success) {
        $s | Add-Member -NotePropertyName "easaAdNumber" -NotePropertyValue $mSupEasa.Groups[1].Value.Trim() -Force
      }
    }
  }
}

$OutJson = $Db | ConvertTo-Json -Depth 12 -Compress
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($DbPath, $OutJson, $Utf8NoBom)
Write-Host "Corrected $ChangedCount EASA/FAA AD pairs using Regulatory Text priority!" -ForegroundColor Green
