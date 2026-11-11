param(
  [string]$Root = (Split-Path -Parent $MyInvocation.MyCommand.Path),
  [int]$MaxThreads = 12,
  [switch]$OnlyApplicable = $true
)

[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
[System.Net.ServicePointManager]::DefaultConnectionLimit = 24
$DbPath = Join-Path $Root "db\aeroad-database.json"
$CacheDir = Join-Path $Root "db\easa-pdf-cache"
if (!(Test-Path $CacheDir)) { New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null }

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$db = [System.IO.File]::ReadAllText($DbPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json

# Collect unique EASA PDF URLs for VJC Applicable ADs + User-requested EASA ADs + PAD/CN items
$userEasaRegex = '26-113|2025-0238|2025-0037|2025-0030|2024-0216|2023-0151|2023-0094|2023-0015|2022-0227|2022-0030|2022-0026|2021-0248|2022-0159-CN|2021-0256|2021-0241|2021-0227|2021-0183|2021-0172|2018-0289|2020-0044|2019-0316|2019-0173|2019-0106|2019-0067|2019-0012|2018-0233|2018-0218|2015-0135|2018-0007|2016-0210|2016-176|2018-0019'
$urlSet = New-Object System.Collections.Generic.HashSet[string]
foreach ($a in $db.ads) {
  $shouldDo = (-not $OnlyApplicable) -or ($a.applicabilityStatus -eq "Applicable") -or ($a.adNumber -match $userEasaRegex)
  if ($shouldDo) {
    foreach ($u in @($a.easaUrl, $a.pdfUrl)) {
      if ($u -and $u -like "https://www.easa.europa.eu/download/AD-tmp-storage/*.pdf") {
        [void]$urlSet.Add($u)
      }
    }
  }
  foreach ($s in ($a.supersededAds)) {
    if ($s.easaUrl -and $s.easaUrl -like "https://www.easa.europa.eu/download/AD-tmp-storage/*.pdf") {
      if ($a.applicabilityStatus -eq "Applicable" -or $s.adNumber -match $userEasaRegex) {
        [void]$urlSet.Add($s.easaUrl)
      }
    }
  }
}

$urls = @($urlSet)
Write-Host "Enriching $($urls.Count) EASA PDFs using $MaxThreads threads..." -ForegroundColor Cyan

$PdfPigLibDir = Join-Path $Root "tools\pdfpig\lib\net471"
$dllPaths = @(Get-ChildItem $PdfPigLibDir -Filter "*.dll" | ForEach-Object { $_.FullName })

$iss = [System.Management.Automation.Runspaces.InitialSessionState]::CreateDefault()
$pool = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspacePool(1, $MaxThreads, $iss, $Host)
$pool.Open()

$workerScript = {
  param($Url, $CacheDir, $DllPaths)
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
  [System.Net.ServicePointManager]::DefaultConnectionLimit = 24
  if ($null -eq ("UglyToad.PdfPig.PdfDocument" -as [type])) {
    foreach ($d in $DllPaths) {
      try { [System.Reflection.Assembly]::LoadFrom($d) | Out-Null } catch {}
    }
  }

  $safeName = ([System.IO.Path]::GetFileName(($Url -split '\?')[0])) -replace '[^A-Za-z0-9_.\-]', '_'
  $pdfPath = Join-Path $CacheDir $safeName
  $txtPath = Join-Path $CacheDir ($safeName -replace '\.pdf$', '.txt')

  try {
    if (-not ((Test-Path $txtPath) -and (Get-Item $txtPath).Length -gt 80)) {
      if (-not (Test-Path $pdfPath) -or (Get-Item $pdfPath).Length -lt 1024) {
        $req = [System.Net.HttpWebRequest]::Create($Url)
        $req.Timeout = 12000
        $req.ReadWriteTimeout = 12000
        $req.UserAgent = "Mozilla/5.0 AeroAD-Portal/1.0"
        $resp = $req.GetResponse()
        $stream = $resp.GetResponseStream()
        $fs = [System.IO.File]::Create($pdfPath)
        try { $stream.CopyTo($fs) } finally { $fs.Dispose(); $stream.Dispose(); $resp.Close() }
      }
    }

    $fullText = ""
    if ((Test-Path $txtPath) -and (Get-Item $txtPath).Length -gt 80) {
      $fullText = [System.IO.File]::ReadAllText($txtPath, [System.Text.Encoding]::UTF8)
    } else {
      $doc = [UglyToad.PdfPig.PdfDocument]::Open($pdfPath)
      try {
        $sb = New-Object System.Text.StringBuilder
        $pIdx = 0
        foreach ($page in $doc.GetPages()) {
          $pIdx++
          $words = ($page.GetWords() | ForEach-Object { $_.Text }) -join " "
          if (-not [string]::IsNullOrWhiteSpace($words)) {
            $t = $words -replace '\s+', ' '
            foreach ($h in @("Airworthiness Directive","AD No\.?:","PAD No\.?:","Issued:","Effective Date:","Supersedure:","ATA \d{2}","Manufacturer\(s\):","Applicability:","Definitions:","Reason:","Required Action\(s\) and Compliance Time\(s\):","Ref\. Publications:","Remarks:")) {
              $t = [regex]::Replace($t, "\s+($h)", "`r`n`r`n`$1")
            }
            [void]$sb.AppendLine("--- PAGE $pIdx ---")
            [void]$sb.AppendLine($t.Trim())
            [void]$sb.AppendLine("")
          }
        }
        $fullText = $sb.ToString().Trim()
        if ($fullText.Length -gt 80) {
          [System.IO.File]::WriteAllText($txtPath, $fullText, (New-Object System.Text.UTF8Encoding($false)))
        }
      } finally {
        $doc.Dispose()
      }
    }

    # Flatten whitespace across pages while removing page headers/footers like "TE.CAP.00110-006 ... Page 1 of 3"
    $clean = $fullText -replace '--- PAGE \d+ ---', ' '
    $clean = $clean -replace 'TE\.CAP\.\d+-\d+[^R]*?Page \d+ of \d+', ' '
    $clean = $clean -replace 'An agency of the European Union\s+Page \d+ of \d+', ' '
    $clean = ($clean -replace '\s+', ' ').Trim()

    $reason = ""
    $mReason = [regex]::Match($clean, 'Reason:\s*(.+?)(?=\s*Required Action\(s\) and Compliance Time\(s\):|\s*Ref\. Publications:|\s*Remarks:|$)')
    if ($mReason.Success) {
      $reason = $mReason.Groups[1].Value.Trim()
    }

    $actions = ""
    $mAct = [regex]::Match($clean, 'Required Action\(s\) and Compliance Time\(s\):\s*(.+?)(?=\s*Ref\. Publications:|\s*Remarks:|$)')
    if ($mAct.Success) {
      $actions = $mAct.Groups[1].Value.Trim()
      if ($actions.Length -gt 650) {
        $actions = $actions.Substring(0, 650) -replace '\s+\S*$', '...'
      }
    }

    $summary = ""
    if ($reason -and $actions) {
      $summary = "Reason: $reason`nRequired Action(s): $actions"
    } elseif ($reason) {
      $summary = "Reason: $reason"
    } elseif ($actions) {
      $summary = "Required Action(s): $actions"
    }

    return [PSCustomObject]@{ Url = $Url; Ok = $true; Summary = $summary }
  } catch {
    return [PSCustomObject]@{ Url = $Url; Ok = $false; Summary = ""; Error = "$_" }
  }
}

$jobs = @()
foreach ($u in $urls) {
  $ps = [powershell]::Create()
  $ps.RunspacePool = $pool
  [void]$ps.AddScript($workerScript).AddArgument($u).AddArgument($CacheDir).AddArgument($dllPaths)
  $jobs += [PSCustomObject]@{ Pipe = $ps; Handle = $ps.BeginInvoke() }
}

$summaryByUrl = @{}
$okCount = 0; $errCount = 0
foreach ($j in $jobs) {
  $res = $j.Pipe.EndInvoke($j.Handle)
  $j.Pipe.Dispose()
  if ($res -and $res.Ok -and $res.Summary.Length -gt 40) {
    $summaryByUrl[$res.Url] = $res.Summary
    $okCount++
  } else {
    $errCount++
  }
}
$pool.Close()
$pool.Dispose()

Write-Host "Extracted rich EASA PDF summaries: $okCount OK, $errCount skipped/empty" -ForegroundColor Green

$updatedAds = 0
foreach ($a in $db.ads) {
  if ($a.easaUrl -and $summaryByUrl.ContainsKey($a.easaUrl)) {
    $rich = $summaryByUrl[$a.easaUrl]
    $a.easaSummary = $rich
    if ($a.authority -eq "EASA" -or [string]::IsNullOrWhiteSpace($a.summary) -or $a.summary -match '^\[(EASA|AMOS|FAA)') {
      $a.summary = $rich
    }
    $updatedAds++
  } elseif ($a.pdfUrl -and $summaryByUrl.ContainsKey($a.pdfUrl)) {
    $rich = $summaryByUrl[$a.pdfUrl]
    if ($a.authority -eq "EASA" -or $a.summary -match '^\[EASA') {
      $a.summary = $rich
    }
    $updatedAds++
  }
  foreach ($s in ($a.supersededAds)) {
    if ($s.easaUrl -and $summaryByUrl.ContainsKey($s.easaUrl)) {
      if (-not $s.PSObject.Properties["easaSummary"]) {
        $s | Add-Member -MemberType NoteProperty -Name "easaSummary" -Value $summaryByUrl[$s.easaUrl] -Force
      } else {
        $s.easaSummary = $summaryByUrl[$s.easaUrl]
      }
      if ([string]::IsNullOrWhiteSpace($s.summary) -or $s.summary -match '^\[(EASA|FAA AD \d)') {
        $s.summary = $summaryByUrl[$s.easaUrl]
      }
    }
  }
}

$outJson = $db | ConvertTo-Json -Depth 12 -Compress
[System.IO.File]::WriteAllText($DbPath, $outJson, $Utf8NoBom)
Write-Host "Updated $updatedAds AD records in aeroad-database.json." -ForegroundColor Cyan
