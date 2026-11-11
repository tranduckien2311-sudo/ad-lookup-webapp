param(
  [int]$Port = 8085
)

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DbPath = Join-Path $Root "db\aeroad-database.json"
$SyncScript = Join-Path $Root "sync-engine.ps1"
$SyncBiweeklyScript = Join-Path $Root "sync-biweekly.ps1"
$RescanFleetScript = Join-Path $Root "rescan-fleet.ps1"
$EasaCacheDir = Join-Path $Root "db\easa-pdf-cache"
if (!(Test-Path $EasaCacheDir)) { New-Item -ItemType Directory -Path $EasaCacheDir -Force | Out-Null }

[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
$PdfPigLoaded = $false
$PdfPigLibDir = Join-Path $Root "tools\pdfpig\lib\net471"
if (Test-Path $PdfPigLibDir) {
  foreach ($dll in (Get-ChildItem $PdfPigLibDir -Filter "*.dll")) {
    try { [System.Reflection.Assembly]::LoadFrom($dll.FullName) | Out-Null } catch {}
  }
  if ($null -ne ("UglyToad.PdfPig.PdfDocument" -as [type])) {
    $PdfPigLoaded = $true
  }
}

function Format-EasaVerbatimText([string]$RawText) {
  if ([string]::IsNullOrWhiteSpace($RawText)) { return "" }
  $t = $RawText -replace '\s+', ' '
  $headers = @(
    "Airworthiness Directive",
    "AD No\.?:",
    "PAD No\.?:",
    "Issued:",
    "Note:",
    "Type Approval Holder",
    "Type/Model designation",
    "Effective Date:",
    "Supersedure:",
    "Foreign AD:",
    "Supplementation:",
    "ATA \d{2}",
    "Manufacturer\(s\):",
    "Applicability:",
    "Definitions:",
    "Reason:",
    "Required Action\(s\) and Compliance Time\(s\):",
    "Ref\. Publications:",
    "Remarks:"
  )
  foreach ($h in $headers) {
    $t = [regex]::Replace($t, "\s+($h)", "`r`n`r`n`$1")
  }
  return $t.Trim()
}

function Extract-PdfFileText([string]$LocalPdfPath, [string]$TxtCachePath) {
  if ([string]::IsNullOrWhiteSpace($LocalPdfPath) -or -not (Test-Path $LocalPdfPath)) { return "" }
  if ($TxtCachePath -and (Test-Path $TxtCachePath)) {
    $cached = [System.IO.File]::ReadAllText($TxtCachePath, [System.Text.Encoding]::UTF8)
    if ($cached.Length -gt 80) { return $cached }
  }
  if (-not $PdfPigLoaded) { return "" }
  $opts = New-Object UglyToad.PdfPig.ParsingOptions
  $opts.UseLenientParsing = $true
  $doc = [UglyToad.PdfPig.PdfDocument]::Open($LocalPdfPath, $opts)
  try {
    $sb = New-Object System.Text.StringBuilder
    $pIdx = 0
    foreach ($page in $doc.GetPages()) {
      $pIdx++
      $words = ($page.GetWords() | ForEach-Object { $_.Text }) -join " "
      if (-not [string]::IsNullOrWhiteSpace($words)) {
        [void]$sb.AppendLine("--- PAGE $pIdx ---")
        [void]$sb.AppendLine((Format-EasaVerbatimText $words))
        [void]$sb.AppendLine("")
      }
    }
    $out = $sb.ToString().Trim()
    if ($TxtCachePath -and $out.Length -gt 80) {
      [System.IO.File]::WriteAllText($TxtCachePath, $out, (New-Object System.Text.UTF8Encoding($false)))
    }
    return $out
  } finally {
    $doc.Dispose()
  }
}

function Get-EasaPdfFullText([string]$TargetUrl) {
  if ([string]::IsNullOrWhiteSpace($TargetUrl)) { return "" }
  if ($TargetUrl -like "/db/uploaded-pdfs/*") {
    $relFile = [System.IO.Path]::GetFileName(($TargetUrl -split '\?')[0])
    $localFile = Join-Path $Root ("db\uploaded-pdfs\" + $relFile)
    $localTxt = $localFile -replace '\.pdf$', '.txt'
    return Extract-PdfFileText $localFile $localTxt
  }
  $safeName = ([System.IO.Path]::GetFileName(($TargetUrl -split '\?')[0])) -replace '[^A-Za-z0-9_.\-]', '_'
  if ([string]::IsNullOrWhiteSpace($safeName) -or ($safeName -notmatch '\.(pdf|zip)$')) {
    $safeName = "easa_" + ([Math]::Abs($TargetUrl.GetHashCode())) + ".pdf"
  }
  $txtCachePath = Join-Path $EasaCacheDir ($safeName -replace '\.(pdf|zip)$', '.txt')
  if (Test-Path $txtCachePath) {
    $cached = [System.IO.File]::ReadAllText($txtCachePath, [System.Text.Encoding]::UTF8)
    if ($cached.Length -gt 80) { return $cached }
  }
  $dlCachePath = Join-Path $EasaCacheDir $safeName
  $isValidCachedDl = $false
  if ((Test-Path $dlCachePath) -and (Get-Item $dlCachePath).Length -ge 1024) {
    if ($safeName.EndsWith(".zip", [System.StringComparison]::OrdinalIgnoreCase)) {
      $isValidCachedDl = $true
    } else {
      try {
        $tailLen = [Math]::Min(1024, (Get-Item $dlCachePath).Length)
        $fsTail = [System.IO.File]::OpenRead($dlCachePath)
        try {
          $fsTail.Seek(-$tailLen, [System.IO.SeekOrigin]::End) | Out-Null
          $buf = New-Object byte[] $tailLen
          [void]$fsTail.Read($buf, 0, $tailLen)
          $tailStr = [System.Text.Encoding]::ASCII.GetString($buf)
          if ($tailStr -match '%%EOF') { $isValidCachedDl = $true }
        } finally { $fsTail.Dispose() }
      } catch {}
    }
  }
  if (-not $isValidCachedDl) {
    $tmpDl = "$dlCachePath.tmp"
    $wc = New-Object System.Net.WebClient
    $wc.Headers.Add("User-Agent", "Mozilla/5.0 AeroAD-Portal/1.0")
    $wc.DownloadFile($TargetUrl, $tmpDl)
    Move-Item -Path $tmpDl -Destination $dlCachePath -Force
  }
  $pdfCachePath = $dlCachePath
  if ($safeName.EndsWith(".zip", [System.StringComparison]::OrdinalIgnoreCase)) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    $extractPdf = Join-Path $EasaCacheDir ($safeName -replace '\.zip$', '.pdf')
    if (-not (Test-Path $extractPdf)) {
      $zip = [System.IO.Compression.ZipFile]::OpenRead($dlCachePath)
      try {
        $entry = $zip.Entries | Where-Object { $_.Name -match '\.pdf$' } | Select-Object -First 1
        if ($entry) {
          [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $extractPdf, $true)
        }
      } finally { $zip.Dispose() }
    }
    $pdfCachePath = $extractPdf
  }
  return Extract-PdfFileText $pdfCachePath $txtCachePath
}

if (!(Test-Path $DbPath)) {
  Write-Host "Initializing AeroAD Database via Auto-Sync Engine..." -ForegroundColor Yellow
  & $SyncScript -DbPath $DbPath
}

$Listener = New-Object System.Net.HttpListener
$Prefix = "http://localhost:$Port/"
$Listener.Prefixes.Add($Prefix)
$Listener.Start()

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " AeroAD Continuing Airworthiness Portal (MME 2.4)" -ForegroundColor Green
Write-Host " Local URL: $Prefix" -ForegroundColor Yellow
Write-Host " Database : $DbPath" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Cyan

$MimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".ico"         = "image/x-icon"
  ".pdf"         = "application/pdf"
  ".webmanifest" = "application/manifest+json; charset=utf-8"
}

try {
  while ($Listener.IsListening) {
    $Context = $Listener.GetContext()
    try {
      $Req = $Context.Request
      $Res = $Context.Response
      $Res.AddHeader("Access-Control-Allow-Origin", "*")
      $Res.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
      $Res.AddHeader("Access-Control-Allow-Headers", "Content-Type")

    $Path = $Req.Url.LocalPath

    if ($Req.HttpMethod -eq "OPTIONS") {
      $Res.StatusCode = 200
      $Res.OutputStream.Close()
      continue
    }

    if ($Path -eq "/api/db" -and $Req.HttpMethod -eq "GET") {
      if (Test-Path $DbPath) {
        $Bytes = [System.IO.File]::ReadAllBytes($DbPath)
        $Res.ContentType = "application/json; charset=utf-8"
        $Res.ContentLength64 = $Bytes.Length
        $Res.StatusCode = 200
        $Res.OutputStream.Write($Bytes, 0, $Bytes.Length)
      } else {
        $Res.StatusCode = 404
      }
      $Res.OutputStream.Close()
      continue
    }

    if ($Path -eq "/api/db" -and $Req.HttpMethod -eq "POST") {
      $Reader = New-Object System.IO.StreamReader($Req.InputStream, [System.Text.Encoding]::UTF8)
      $Body = $Reader.ReadToEnd()
      $Reader.Close()
      $DbDir = Split-Path -Parent $DbPath
      if (!(Test-Path $DbDir)) { New-Item -ItemType Directory -Path $DbDir -Force | Out-Null }
      $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
      [System.IO.File]::WriteAllText($DbPath, $Body, $Utf8NoBom)

      $RespBytes = [System.Text.Encoding]::UTF8.GetBytes('{"status":"saved"}')
      $Res.ContentType = "application/json; charset=utf-8"
      $Res.ContentLength64 = $RespBytes.Length
      $Res.StatusCode = 200
      $Res.OutputStream.Write($RespBytes, 0, $RespBytes.Length)
      $Res.OutputStream.Close()
      continue
    }

    if ($Path -eq "/api/auto-sync") {
      & $SyncScript -DbPath $DbPath
      $Bytes = [System.IO.File]::ReadAllBytes($DbPath)
      $Res.ContentType = "application/json; charset=utf-8"
      $Res.ContentLength64 = $Bytes.Length
      $Res.StatusCode = 200
      $Res.OutputStream.Write($Bytes, 0, $Bytes.Length)
      $Res.OutputStream.Close()
      continue
    }

    if ($Path -eq "/api/sync-biweekly") {
      try {
        & $SyncBiweeklyScript -DbPath $DbPath
      } catch {
        Write-Warning "Biweekly sync warning: $_"
      }
      $Bytes = [System.IO.File]::ReadAllBytes($DbPath)
      $Res.ContentType = "application/json; charset=utf-8"
      $Res.ContentLength64 = $Bytes.Length
      $Res.StatusCode = 200
      $Res.OutputStream.Write($Bytes, 0, $Bytes.Length)
      $Res.OutputStream.Close()
      continue
    }

    if ($Path -eq "/api/rescan-fleet") {
      $Body = ""
      if ($Req.HttpMethod -eq "POST" -and $Req.HasEntityBody) {
        $Reader = New-Object System.IO.StreamReader($Req.InputStream, [System.Text.Encoding]::UTF8)
        $Body = $Reader.ReadToEnd()
        $Reader.Close()
      }
      try {
        & $RescanFleetScript -DbPath $DbPath -NewAircraftJson $Body
      } catch {
        Write-Warning "Rescan fleet warning: $_"
      }
      $Bytes = [System.IO.File]::ReadAllBytes($DbPath)
      $Res.ContentType = "application/json; charset=utf-8"
      $Res.ContentLength64 = $Bytes.Length
      $Res.StatusCode = 200
      $Res.OutputStream.Write($Bytes, 0, $Bytes.Length)
      $Res.OutputStream.Close()
      continue
    }

    if ($Path -eq "/api/resolve-ad-pdf") {
      $AdQuery = $Req.QueryString["ad"]
      $RedirectPdf = "https://drs.faa.gov/"
      if ($AdQuery) {
        $CleanAd = ($AdQuery -replace '^(FAA\s+|EASA\s+)?AD\s+', '').Trim()
        try {
          $Enc = [System.Uri]::EscapeDataString($CleanAd)
          $FrUrl = "https://www.federalregister.gov/api/v1/documents.json?per_page=5&order=oldest&conditions%5Bagencies%5D%5B%5D=federal-aviation-administration&conditions%5Btype%5D%5B%5D=RULE&conditions%5Bterm%5D=$Enc&fields%5B%5D=document_number&fields%5B%5D=publication_date&fields%5B%5D=pdf_url"
          $FrResp = Invoke-RestMethod -Uri $FrUrl -TimeoutSec 10
          if ($FrResp -and $FrResp.results -and $FrResp.results.Count -gt 0) {
            $Doc = $FrResp.results[0]
            if ($Doc.pdf_url) {
              $RedirectPdf = [string]$Doc.pdf_url
            } elseif ($Doc.publication_date -and $Doc.document_number) {
              $RedirectPdf = "https://www.govinfo.gov/content/pkg/FR-$($Doc.publication_date)/pdf/$($Doc.document_number).pdf"
            }
          }
        } catch {}
      }
      $Res.StatusCode = 302
      $Res.RedirectLocation = $RedirectPdf
      $Res.OutputStream.Close()
      continue
    }

    if ($Path -eq "/api/ad-fulltext") {
      $TargetUrl = $Req.QueryString["url"]
      $AdQuery = $Req.QueryString["ad"]
      $OutText = ""
      if ((-not $TargetUrl -or $TargetUrl -notlike "https://www.govinfo.gov/*") -and $AdQuery) {
        $CleanAd = ($AdQuery -replace '^(FAA\s+)?AD\s+', '').Trim()
        try {
          $Enc = [System.Uri]::EscapeDataString($CleanAd)
          $FrUrl = "https://www.federalregister.gov/api/v1/documents.json?per_page=3&order=oldest&conditions%5Bagencies%5D%5B%5D=federal-aviation-administration&conditions%5Btype%5D%5B%5D=RULE&conditions%5Bterm%5D=$Enc&fields%5B%5D=document_number&fields%5B%5D=publication_date&fields%5B%5D=body_html_url"
          $FrResp = Invoke-RestMethod -Uri $FrUrl -TimeoutSec 12
          if ($FrResp -and $FrResp.results -and $FrResp.results.Count -gt 0) {
            $Doc = $FrResp.results[0]
            if ($Doc.publication_date -and $Doc.document_number) {
              $TargetUrl = "https://www.govinfo.gov/content/pkg/FR-$($Doc.publication_date)/html/$($Doc.document_number).htm"
            } elseif ($Doc.body_html_url) {
              $TargetUrl = [string]$Doc.body_html_url
            }
          }
        } catch {}
      }
      if ($TargetUrl -and ($TargetUrl -like "https://www.govinfo.gov/*" -or $TargetUrl -like "https://www.federalregister.gov/*")) {
        try {
          $HtmResp = Invoke-WebRequest -Uri $TargetUrl -UseBasicParsing -TimeoutSec 15
          $RawStr = if ($HtmResp.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($HtmResp.Content) } else { [string]$HtmResp.Content }
          $CleanPre = if ($RawStr -match '(?s)<pre>') {
            $RawStr -replace '(?s)^.*?<pre>', '' -replace '(?s)</pre>(?![\s\S]*<pre>).*$', ''
          } else {
            $RawStr
          }
          $CleanPre = [System.Net.WebUtility]::HtmlDecode(($CleanPre -replace '<[^>]+>', ''))
          $OutText = $CleanPre.Trim()
        } catch {
          $OutText = "Không thể tải văn bản gốc từ GovInfo: $_"
        }
      }
      $RespObj = @{ fullText = $OutText } | ConvertTo-Json -Compress
      $RespBytes = [System.Text.Encoding]::UTF8.GetBytes($RespObj)
      $Res.ContentType = "application/json; charset=utf-8"
      $Res.ContentLength64 = $RespBytes.Length
      $Res.StatusCode = 200
      $Res.OutputStream.Write($RespBytes, 0, $RespBytes.Length)
      $Res.OutputStream.Close()
      continue
    }

    if ($Path -eq "/api/easa-fulltext") {
      $TargetUrl = $Req.QueryString["url"]
      $OutText = ""
      if ($TargetUrl -and ($TargetUrl -like "https://www.easa.europa.eu/download/*" -or $TargetUrl -like "/db/uploaded-pdfs/*")) {
        try {
          $OutText = Get-EasaPdfFullText $TargetUrl
        } catch {
          $OutText = "Không thể tải hoặc giải mã PDF: $_"
        }
      }
      $RespObj = @{ fullText = $OutText } | ConvertTo-Json -Compress
      $RespBytes = [System.Text.Encoding]::UTF8.GetBytes($RespObj)
      $Res.ContentType = "application/json; charset=utf-8"
      $Res.ContentLength64 = $RespBytes.Length
      $Res.StatusCode = 200
      $Res.OutputStream.Write($RespBytes, 0, $RespBytes.Length)
      $Res.OutputStream.Close()
      continue
    }

    if ($Path -eq "/api/upload-ad-pdf" -and $Req.HttpMethod -eq "POST") {
      try {
        $AdId = [string]$Req.QueryString["adId"]
        $SupIdxStr = [string]$Req.QueryString["supIdx"]
        $Side = [string]$Req.QueryString["side"]
        $OrigName = [string]$Req.QueryString["fileName"]
        if ([string]::IsNullOrWhiteSpace($OrigName)) { $OrigName = "document.pdf" }

        $UploadDir = Join-Path $Root "db\uploaded-pdfs"
        if (!(Test-Path $UploadDir)) { New-Item -ItemType Directory -Path $UploadDir -Force | Out-Null }

        $SafeAd = ($AdId -replace '[^A-Za-z0-9_\-]', '_')
        $SafeBase = ([System.IO.Path]::GetFileName($OrigName)) -replace '[^A-Za-z0-9_.\-]', '_'
        if (-not $SafeBase.EndsWith(".pdf", [System.StringComparison]::OrdinalIgnoreCase)) { $SafeBase += ".pdf" }
        $SideTag = if ($Side -eq "easa") { "_easa" } else { "" }
        $SupTag = if ($SupIdxStr -match '^\d+$') { "_sup$SupIdxStr" } else { "" }
        $SavedName = "${SafeAd}${SupTag}${SideTag}_${SafeBase}"
        $DestPath = Join-Path $UploadDir $SavedName

        $Fs = [System.IO.File]::Create($DestPath)
        try { $Req.InputStream.CopyTo($Fs) } finally { $Fs.Dispose() }

        $NewUrl = "/db/uploaded-pdfs/$SavedName"
        $TxtOut = Extract-PdfFileText $DestPath ($DestPath -replace '\.pdf$', '.txt')

        $DbObj = [System.IO.File]::ReadAllText($DbPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
        $TargetAd = $DbObj.ads | Where-Object { $_.id -eq $AdId } | Select-Object -First 1
        if ($TargetAd) {
          if ($SupIdxStr -match '^\d+$' -and $TargetAd.supersededAds) {
            $sIdx = [int]$SupIdxStr
            if ($sIdx -ge 0 -and $sIdx -lt $TargetAd.supersededAds.Count) {
              $sObj = $TargetAd.supersededAds[$sIdx]
              if ($Side -eq "easa") {
                $sObj | Add-Member -MemberType NoteProperty -Name "easaUrl" -Value $NewUrl -Force
              } else {
                $sObj | Add-Member -MemberType NoteProperty -Name "pdfUrl" -Value $NewUrl -Force
              }
              $sObj | Add-Member -MemberType NoteProperty -Name "attachedPdfName" -Value $OrigName -Force
            }
          } else {
            if ($Side -eq "easa") {
              $TargetAd | Add-Member -MemberType NoteProperty -Name "easaUrl" -Value $NewUrl -Force
              if ($TargetAd.authority -eq "EASA") {
                $TargetAd | Add-Member -MemberType NoteProperty -Name "pdfUrl" -Value $NewUrl -Force
              }
            } else {
              $TargetAd | Add-Member -MemberType NoteProperty -Name "pdfUrl" -Value $NewUrl -Force
            }
            $TargetAd | Add-Member -MemberType NoteProperty -Name "attachedPdfName" -Value $OrigName -Force
          }
          $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
          [System.IO.File]::WriteAllText($DbPath, ($DbObj | ConvertTo-Json -Depth 12 -Compress), $Utf8NoBom)
        }

        $RespObj = @{ status = "ok"; pdfUrl = $NewUrl; fileName = $OrigName; savedName = $SavedName; extractedText = $TxtOut } | ConvertTo-Json -Compress
        $RespBytes = [System.Text.Encoding]::UTF8.GetBytes($RespObj)
        $Res.ContentType = "application/json; charset=utf-8"
        $Res.ContentLength64 = $RespBytes.Length
        $Res.StatusCode = 200
        $Res.OutputStream.Write($RespBytes, 0, $RespBytes.Length)
      } catch {
        $ErrObj = @{ status = "error"; message = "$_" } | ConvertTo-Json -Compress
        $ErrBytes = [System.Text.Encoding]::UTF8.GetBytes($ErrObj)
        $Res.ContentType = "application/json; charset=utf-8"
        $Res.ContentLength64 = $ErrBytes.Length
        $Res.StatusCode = 500
        $Res.OutputStream.Write($ErrBytes, 0, $ErrBytes.Length)
      }
      $Res.OutputStream.Close()
      continue
    }

    $RelPath = $Path.TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($RelPath)) {
      $RelPath = "index.html"
    }

    $FilePath = Join-Path $Root $RelPath
    if (-not (Test-Path $FilePath -PathType Leaf) -and $RelPath -like "local-pdf/*") {
      $ParentPdf = Join-Path (Split-Path -Parent $Root) ($RelPath.Substring("local-pdf/".Length))
      if (Test-Path $ParentPdf -PathType Leaf) { $FilePath = $ParentPdf }
    }
    if (Test-Path $FilePath -PathType Leaf) {
      $Ext = [System.IO.Path]::GetExtension($FilePath).ToLower()
      $Res.ContentType = if ($MimeTypes.ContainsKey($Ext)) { $MimeTypes[$Ext] } else { "application/octet-stream" }
      if ($Ext -in @(".html", ".js", ".css", ".webmanifest")) {
        $Res.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
      }
      $Bytes = [System.IO.File]::ReadAllBytes($FilePath)
      $Res.ContentLength64 = $Bytes.Length
      $Res.StatusCode = 200
      $Res.OutputStream.Write($Bytes, 0, $Bytes.Length)
    } else {
      $Res.StatusCode = 404
    }
    $Res.OutputStream.Close()
    } catch {
      Write-Warning "HTTP request error: $_"
      try { $Context.Response.Close() } catch {}
    }
  }
} finally {
  $Listener.Stop()
}
