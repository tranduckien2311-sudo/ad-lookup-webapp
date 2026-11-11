param(
  [string]$Root = (Split-Path -Parent $MyInvocation.MyCommand.Path)
)

$DbPath = Join-Path $Root "db\aeroad-database.json"
$CacheDir = Join-Path $Root "db\easa-pdf-cache"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$db = [System.IO.File]::ReadAllText($DbPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json

function Clean-EasaPagesText([string]$raw) {
  if ([string]::IsNullOrWhiteSpace($raw)) { return "" }
  $t = $raw -replace '--- PAGE \d+ ---', ' '
  # Remove footer blocks in both orders (TE.CAP...Page X...An agency OR Page X...TE.CAP...An agency)
  $t = [regex]::Replace($t, 'Page \d+ of \d+\s+TE\.CAP\.\d+-\d+.*?An agency of the European Union', ' ', [System.Text.RegularExpressions.RegexOptions]::Singleline)
  $t = [regex]::Replace($t, 'TE\.CAP\.\d+-\d+.*?An agency of the European Union', ' ', [System.Text.RegularExpressions.RegexOptions]::Singleline)
  $t = [regex]::Replace($t, 'An agency of the European Union\s+Page \d+ of \d+', ' ')
  $t = [regex]::Replace($t, '\bEASA\s+(?:AD|PAD|EAD)\s+No\.?:\s*[0-9A-Za-z\-]+', ' ')
  $t = [regex]::Replace($t, '\b(?:AD|PAD)\s+No\.?:\s*[0-9A-Za-z\-]+', ' ')
  $t = ($t -replace '\s+', ' ').Trim()
  return $t
}

function Parse-EasaTxtFile([string]$txtPath) {
  if (-not (Test-Path $txtPath)) { return $null }
  $raw = [System.IO.File]::ReadAllText($txtPath, [System.Text.Encoding]::UTF8)
  $clean = Clean-EasaPagesText $raw

  # Extract Type/Model designation(s) from Page 1
  $typeModel = ""
  $mTm = [regex]::Match($raw, 'Type/Model designation\(s\):\s*(.+?)(?=\s*(?:Effective Date:|ETSO Authorization:|TCDS|STCH|Foreign AD:))', [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if ($mTm.Success) {
    $typeModel = ($mTm.Groups[1].Value -replace '\s+', ' ').Trim()
  }

  # Extract ATA subject line from Page 1
  $ataSubj = ""
  $mAta = [regex]::Match($raw, 'ATA\s+\d{2}(?:\s*/\s*\d{2})?\s*[–\-]\s*(.+?)(?=\s*(?:Manufacturer\(s\):|Applicability:|Definitions:|Reason:))', [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if ($mAta.Success) {
    $ataSubj = ($mAta.Groups[1].Value -replace '\s+', ' ').Trim()
  }

  # Extract Applicability section cleanly
  $applicability = ""
  $mApp = [regex]::Match($clean, 'Applicability:\s*(.+?)(?=\s*(?:Definitions:|Reason:|Required Action\(s\)|Ref\. Publications:|Remarks:))')
  if ($mApp.Success) {
    $applicability = $mApp.Groups[1].Value.Trim()
  }

  # Extract Reason section cleanly (without footer artifacts or Required Actions)
  $reason = ""
  $mR = [regex]::Match($clean, 'Reason:\s*(.+?)(?=\s*(?:Required Action\(s\) and Compliance Time\(s\):|Required Action\(s\):|Ref\. Publications:|Remarks:|Note\s*:?\s*If requested))')
  if ($mR.Success) {
    $reason = $mR.Groups[1].Value.Trim()
  }

  return [PSCustomObject]@{
    typeModel     = $typeModel
    ataSubj       = $ataSubj
    applicability = $applicability
    reason        = $reason
  }
}

$parsedByUrl = @{}
foreach ($a in $db.ads) {
  foreach ($u in @($a.easaUrl, $a.pdfUrl)) {
    if ($u -and $u -like "https://www.easa.europa.eu/download/AD-tmp-storage/*.pdf" -and -not $parsedByUrl.ContainsKey($u)) {
      $safeName = ([System.IO.Path]::GetFileName(($u -split '\?')[0])) -replace '[^A-Za-z0-9_.\-]', '_'
      $txtPath = Join-Path $CacheDir ($safeName -replace '\.pdf$', '.txt')
      if (Test-Path $txtPath) {
        $parsedByUrl[$u] = Parse-EasaTxtFile $txtPath
      }
    }
  }
}

$updatedSummary = 0
$updatedTitle = 0
$cleanedEngine = 0

foreach ($a in $db.ads) {
  # 1. Update EASA Reason-only summary & accurate Title / Type-Model
  $eUrl = if ($a.easaUrl -and $parsedByUrl.ContainsKey($a.easaUrl)) { $a.easaUrl } elseif ($a.pdfUrl -and $parsedByUrl.ContainsKey($a.pdfUrl)) { $a.pdfUrl } else { "" }
  if ($eUrl) {
    $info = $parsedByUrl[$eUrl]
    if ($info) {
      $appPart = if ($info.applicability -and $info.applicability.Length -gt 10) { "Applicability: $($info.applicability)" } else { "" }
      $reasonPart = if ($info.reason -and $info.reason.Length -gt 20) { "Reason: $($info.reason)" } else { "" }
      $combined = @($appPart, $reasonPart) | Where-Object { $_ }
      if ($combined.Count -gt 0) {
        $fullBox = $combined -join "`n`n"
        if ($a.PSObject.Properties["easaSummary"]) { $a.easaSummary = $fullBox }
        if ($a.authority -eq "EASA" -or $a.summary -match '^\[(EASA|AMOS)' -or $a.summary -match '^(Reason:|Applicability:)') {
          $a.summary = $fullBox
        }
        $updatedSummary++
      }
      if ($appPart) {
        $a | Add-Member -MemberType NoteProperty -Name "adApplicabilityText" -Value $info.applicability -Force
        if ([string]$a.adMsnScope -match '^Theo |^All MSNs / Theo|^Certain MSNs') {
          $shortApp = if ($info.applicability.Length -gt 220) { $info.applicability.Substring(0, 220) + "..." } else { $info.applicability }
          $a.adMsnScope = "Applicability: $shortApp"
        }
      }
      if ($info.typeModel -and $info.typeModel.Length -gt 3) {
        if ($a.authority -eq "EASA" -or [string]$a.adExtractedModels -match '^APPLIANCES') {
          if ($info.typeModel.Length -le 260) {
            $a.adExtractedModels = $info.typeModel
          }
          if ($a.PSObject.Properties["easaModels"]) {
            $a.easaModels = $info.typeModel
          }
        }
        if ($info.ataSubj) {
          $shortModel = if ($info.typeModel.Length -gt 110) { $info.typeModel.Substring(0, 110) + "..." } else { $info.typeModel }
          $betterTitle = "$shortModel — $($info.ataSubj)"
          if ($a.PSObject.Properties["easaSubject"] -and ($a.easaSubject -match '^SUPERSEDED BY|^ROCKWELL COLLINS:|^AIRBUS|^SAFRAN|^B/E AEROSPACE' -or $a.easaSubject.Length -lt 15)) {
            $a.easaSubject = $betterTitle
          }
          if ($a.authority -eq "EASA" -and ([string]$a.adExtractedModels -match 'GPS-4000S|GLU-2100|APPLIANCES' -or $a.subject -match '^ROCKWELL COLLINS:|SUPERSEDED BY|^Airbus SAS Airplanes$')) {
            $a.subject = $betterTitle
            $updatedTitle++
          } elseif ($a.authority -eq "EASA" -and $shortModel -and $a.subject -notmatch [regex]::Escape($shortModel.Substring(0, [Math]::Min(18, $shortModel.Length)))) {
            $a.subject = $betterTitle
            $updatedTitle++
          }
        }
      }
    }
  }

  # Also trim existing "Required Action(s):" tail if already present inside EASA summary
  if ($a.PSObject.Properties["easaSummary"] -and $a.easaSummary -match '(?s)^Reason:(.+?)\r?\nRequired Action\(s\):') {
    $a.easaSummary = "Reason:" + $matches[1].Trim()
  }
  if ($a.authority -eq "EASA" -and $a.summary -match '(?s)^Reason:(.+?)\r?\nRequired Action\(s\):') {
    $a.summary = "Reason:" + $matches[1].Trim()
  }

  # 2. Remove false fleet-wide engine labels from non-Engine ADs (e.g. GPS receivers, Seats, Galleys, Structures)
  $ata = [string]$a.ata
  $cat = [string]$a.category
  $subjAll = "$($a.subject) $($a.adExtractedModels)"
  $isEngineAd = ($cat -match '^Engine$') -or ($ata -match '^(7[1-9]|80)\b|Engine|Powerplant|Turbine') -or ($subjAll -match '\b(CFM56|PW1100G|PW1133G|Trent\s*7|LEAP-1|V2500|Rolls-Royce.*Engines|Pratt & Whitney.*Engines|Engine Alliance|Turbomeca)\b')
  if (-not $isEngineAd -and $a.adExtractedEngines) {
    $a.adExtractedEngines = ""
    $cleanedEngine++
  }
}

$db.ads = @($db.ads)
[System.IO.File]::WriteAllText($DbPath, ($db | ConvertTo-Json -Depth 12 -Compress), $Utf8NoBom)
Write-Host "Refined DB: $updatedSummary EASA Reason summaries | $updatedTitle exact titles | $cleanedEngine false engine tags cleared."
