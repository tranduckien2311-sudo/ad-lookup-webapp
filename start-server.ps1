param(
  [int]$Port = 8085
)

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DbPath = Join-Path $Root "db\aeroad-database.json"
$IpcFleetPath = Join-Path $Root "db\vjc-ipc-fleet.json"
$IpcCatalogPath = Join-Path $Root "db\vjc-ipc-catalog.json"
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

Add-Type -ReferencedAssemblies "System.Web.Extensions" -TypeDefinition @"
using System;
using System.IO;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Linq;

public class IpcSearchItem {
    public string pn;
    public string ipcRef;
    public List<string> ipcRefs;
    public string desc;
    public string mfr;
    public bool installed;
    public List<string> families;
    public int lineItems;
    public int planeCount;
    public List<string> samplePlanes;
    public List<string> planes;
    [ScriptIgnore]
    public HashSet<string> planeSet;
    public int interchangeCount;
    public List<Dictionary<string, object>> interchanges;
    public int adCount;
    public List<Dictionary<string, object>> matchedAds;
}

public class IpcSearchEngine {
    private static List<IpcSearchItem> _items = new List<IpcSearchItem>();
    private static object _lock = new object();
    private static bool _loaded = false;

    public static bool IsLoaded { get { return _loaded; } }

    public static void Load(string jsonPath) {
        if (_loaded) return;
        lock (_lock) {
            if (_loaded) return;
            if (!File.Exists(jsonPath)) return;
            string json = File.ReadAllText(jsonPath, System.Text.Encoding.UTF8);
            var ser = new JavaScriptSerializer();
            ser.MaxJsonLength = int.MaxValue;
            var root = ser.Deserialize<Dictionary<string, object>>(json);
            var parts = root["parts"] as System.Collections.ArrayList;
            if (parts == null) return;

            var list = new List<IpcSearchItem>(parts.Count);
            foreach (Dictionary<string, object> p in parts) {
                var item = new IpcSearchItem();
                item.pn = p.ContainsKey("pn") && p["pn"] != null ? p["pn"].ToString() : "";
                item.ipcRef = p.ContainsKey("ipcRef") && p["ipcRef"] != null ? p["ipcRef"].ToString() : "";
                var irList = p.ContainsKey("ipcRefs") ? p["ipcRefs"] as System.Collections.ArrayList : null;
                if (irList != null) {
                    item.ipcRefs = irList.Cast<string>().ToList();
                } else {
                    item.ipcRefs = new List<string>();
                }
                item.desc = p.ContainsKey("desc") && p["desc"] != null ? p["desc"].ToString() : "";
                item.mfr = p.ContainsKey("mfr") && p["mfr"] != null ? p["mfr"].ToString() : "";
                item.installed = p.ContainsKey("installed") && (bool)p["installed"];
                item.lineItems = p.ContainsKey("lineItems") ? Convert.ToInt32(p["lineItems"]) : 0;
                item.planeCount = p.ContainsKey("planeCount") ? Convert.ToInt32(p["planeCount"]) : 0;
                item.interchangeCount = p.ContainsKey("interchangeCount") ? Convert.ToInt32(p["interchangeCount"]) : 0;
                item.adCount = p.ContainsKey("adCount") ? Convert.ToInt32(p["adCount"]) : 0;

                var famList = p.ContainsKey("families") ? p["families"] as System.Collections.ArrayList : null;
                if (famList != null) {
                    item.families = famList.Cast<string>().ToList();
                } else {
                    item.families = new List<string>();
                }

                var spList = p.ContainsKey("samplePlanes") ? p["samplePlanes"] as System.Collections.ArrayList : null;
                if (spList != null) {
                    item.samplePlanes = spList.Cast<string>().ToList();
                } else {
                    item.samplePlanes = new List<string>();
                }

                var plList = p.ContainsKey("planes") ? p["planes"] as System.Collections.ArrayList : null;
                if (plList != null) {
                    item.planes = plList.Cast<string>().ToList();
                    item.planeSet = new HashSet<string>(item.planes, StringComparer.OrdinalIgnoreCase);
                } else {
                    item.planes = new List<string>();
                    item.planeSet = new HashSet<string>(item.samplePlanes, StringComparer.OrdinalIgnoreCase);
                }

                var icList = p.ContainsKey("interchanges") ? p["interchanges"] as System.Collections.ArrayList : null;
                if (icList != null) {
                    item.interchanges = icList.Cast<Dictionary<string, object>>().ToList();
                } else {
                    item.interchanges = new List<Dictionary<string, object>>();
                }

                var adList = p.ContainsKey("matchedAds") ? p["matchedAds"] as System.Collections.ArrayList : null;
                if (adList != null) {
                    item.matchedAds = adList.Cast<Dictionary<string, object>>().ToList();
                } else {
                    item.matchedAds = new List<Dictionary<string, object>>();
                }

                list.Add(item);
            }
            _items = list;
            _loaded = true;
        }
    }

    public static string GetStats() {
        if (!_loaded) return "{}";
        int installedCount = 0;
        int withAdCount = 0;
        int totalIc = 0;
        for (int i = 0; i < _items.Count; i++) {
            if (_items[i].installed) installedCount++;
            if (_items[i].adCount > 0) withAdCount++;
            totalIc += _items[i].interchangeCount;
        }
        var stat = new {
            totalParts = _items.Count,
            installedCount = installedCount,
            withAdCount = withAdCount,
            totalInterchanges = totalIc
        };
        var ser = new JavaScriptSerializer();
        return ser.Serialize(stat);
    }

    public static string GetPartDetail(string pn) {
        if (!_loaded || string.IsNullOrWhiteSpace(pn)) return "null";
        string pUpper = pn.Trim().ToUpperInvariant();
        for (int i = 0; i < _items.Count; i++) {
            if (_items[i].pn.ToUpperInvariant() == pUpper) {
                var ser = new JavaScriptSerializer();
                ser.MaxJsonLength = int.MaxValue;
                return ser.Serialize(_items[i]);
            }
        }
        return "null";
    }

    public static string SearchJson(string q, string family, string plane, string relation, string installed, string hasAd, string ata, int page, int pageSize) {
        if (!_loaded) return "{\"total\":0,\"page\":1,\"pageSize\":50,\"items\":[]}";
        if (page < 1) page = 1;
        if (pageSize < 1 || pageSize > 200) pageSize = 50;

        string qUpper = string.IsNullOrWhiteSpace(q) ? null : q.Trim().ToUpperInvariant();
        string famUpper = string.IsNullOrWhiteSpace(family) || family == "ALL" ? null : family.Trim().ToUpperInvariant();
        string planeUpper = string.IsNullOrWhiteSpace(plane) || plane == "ALL" ? null : plane.Trim().ToUpperInvariant();
        string relUpper = string.IsNullOrWhiteSpace(relation) || relation == "ALL" ? null : relation.Trim().ToUpperInvariant();
        string ataUpper = string.IsNullOrWhiteSpace(ata) || ata == "ALL" ? null : ata.Trim().ToUpperInvariant();
        bool? filterInstalled = null;
        if (installed == "YES") filterInstalled = true;
        else if (installed == "NO") filterInstalled = false;

        bool? filterHasAd = null;
        if (hasAd == "YES") filterHasAd = true;
        else if (hasAd == "NO") filterHasAd = false;

        var sw = System.Diagnostics.Stopwatch.StartNew();
        var results = new List<IpcSearchItem>();

        for (int i = 0; i < _items.Count; i++) {
            var item = _items[i];
            if (famUpper != null) {
                bool famMatch = false;
                for (int f = 0; f < item.families.Count; f++) {
                    if (item.families[f].ToUpperInvariant().IndexOf(famUpper) >= 0) { famMatch = true; break; }
                }
                if (!famMatch) continue;
            }

            if (planeUpper != null) {
                if (item.planeSet == null || !item.planeSet.Contains(planeUpper)) continue;
            }

            if (filterInstalled.HasValue && item.installed != filterInstalled.Value) continue;
            if (filterHasAd.HasValue) {
                if (filterHasAd.Value && item.adCount == 0) continue;
                if (!filterHasAd.Value && item.adCount > 0) continue;
            }

            if (ataUpper != null) {
                bool ataMatch = false;
                if (!string.IsNullOrEmpty(item.ipcRef) && (item.ipcRef.StartsWith(ataUpper + "-") || item.ipcRef.StartsWith(ataUpper))) {
                    ataMatch = true;
                }
                if (!ataMatch && item.ipcRefs != null) {
                    for (int ir = 0; ir < item.ipcRefs.Count; ir++) {
                        if (!string.IsNullOrEmpty(item.ipcRefs[ir]) && (item.ipcRefs[ir].StartsWith(ataUpper + "-") || item.ipcRefs[ir].StartsWith(ataUpper))) {
                            ataMatch = true;
                            break;
                        }
                    }
                }
                if (!ataMatch) continue;
            }

            if (relUpper != null) {
                if (relUpper == "NONE" || relUpper == "NO" || relUpper == "NO_INTERCHANGE") {
                    if (item.interchanges.Count > 0) continue;
                } else if (relUpper == "HAS_INTERCHANGE" || relUpper == "YES") {
                    if (item.interchanges.Count == 0) continue;
                } else if (relUpper == "2WAY" || relUpper == "2-WAY") {
                    bool hit2Way = false;
                    for (int r = 0; r < item.interchanges.Count; r++) {
                        var ic = item.interchanges[r];
                        var reason = ic.ContainsKey("reason") && ic["reason"] != null ? ic["reason"].ToString().ToUpperInvariant() : "";
                        bool has2WaySignal = reason.IndexOf("TWO WAY") >= 0 || reason.IndexOf("2-WAY") >= 0 || reason.IndexOf("2 WAY") >= 0 || reason.IndexOf("BUT IF") >= 0 || reason.IndexOf("ONLY IF") >= 0 || (reason.IndexOf("CAN REPLACE") >= 0 && reason.IndexOf(" IF ") >= 0);
                        bool isStrict1Way = !has2WaySignal && (reason.IndexOf("ONE WAY") >= 0 || reason.IndexOf("1-WAY") >= 0 || reason.IndexOf("1 WAY") >= 0 || reason.IndexOf("CANNOT REPLACE") >= 0 || reason.IndexOf("NOT INTERCHANGEABLE") >= 0);
                        if (!isStrict1Way) {
                            hit2Way = true;
                            break;
                        }
                    }
                    if (!hit2Way) continue;
                } else if (relUpper == "1WAY" || relUpper == "1-WAY") {
                    bool hit1Way = false;
                    for (int r = 0; r < item.interchanges.Count; r++) {
                        var ic = item.interchanges[r];
                        var reason = ic.ContainsKey("reason") && ic["reason"] != null ? ic["reason"].ToString().ToUpperInvariant() : "";
                        bool has2WaySignal = reason.IndexOf("TWO WAY") >= 0 || reason.IndexOf("2-WAY") >= 0 || reason.IndexOf("2 WAY") >= 0 || reason.IndexOf("BUT IF") >= 0 || reason.IndexOf("ONLY IF") >= 0 || (reason.IndexOf("CAN REPLACE") >= 0 && reason.IndexOf(" IF ") >= 0);
                        bool isStrict1Way = !has2WaySignal && (reason.IndexOf("ONE WAY") >= 0 || reason.IndexOf("1-WAY") >= 0 || reason.IndexOf("1 WAY") >= 0 || reason.IndexOf("CANNOT REPLACE") >= 0 || reason.IndexOf("NOT INTERCHANGEABLE") >= 0);
                        if (isStrict1Way) {
                            hit1Way = true;
                            break;
                        }
                    }
                    if (!hit1Way) continue;
                } else {
                    bool relMatch = false;
                    for (int r = 0; r < item.interchanges.Count; r++) {
                        var relVal = item.interchanges[r].ContainsKey("rel") && item.interchanges[r]["rel"] != null ? item.interchanges[r]["rel"].ToString().ToUpperInvariant() : "";
                        if (relVal.IndexOf(relUpper) >= 0) { relMatch = true; break; }
                    }
                    if (!relMatch) continue;
                }
            }

            if (qUpper != null) {
                bool hit = item.pn.ToUpperInvariant().IndexOf(qUpper) >= 0 ||
                           item.desc.ToUpperInvariant().IndexOf(qUpper) >= 0 ||
                           item.mfr.ToUpperInvariant().IndexOf(qUpper) >= 0 ||
                           (!string.IsNullOrEmpty(item.ipcRef) && item.ipcRef.ToUpperInvariant().IndexOf(qUpper) >= 0);

                if (!hit && item.ipcRefs != null) {
                    for (int ir = 0; ir < item.ipcRefs.Count; ir++) {
                        if (item.ipcRefs[ir].ToUpperInvariant().IndexOf(qUpper) >= 0) { hit = true; break; }
                    }
                }

                if (!hit) {
                    for (int r = 0; r < item.interchanges.Count; r++) {
                        var icPn = item.interchanges[r].ContainsKey("icPn") && item.interchanges[r]["icPn"] != null ? item.interchanges[r]["icPn"].ToString().ToUpperInvariant() : "";
                        var icDesc = item.interchanges[r].ContainsKey("icDesc") && item.interchanges[r]["icDesc"] != null ? item.interchanges[r]["icDesc"].ToString().ToUpperInvariant() : "";
                        if (icPn.IndexOf(qUpper) >= 0 || icDesc.IndexOf(qUpper) >= 0) { hit = true; break; }
                    }
                }
                if (!hit) {
                    for (int a = 0; a < item.matchedAds.Count; a++) {
                        var num = item.matchedAds[a].ContainsKey("num") && item.matchedAds[a]["num"] != null ? item.matchedAds[a]["num"].ToString().ToUpperInvariant() : "";
                        if (num.IndexOf(qUpper) >= 0) { hit = true; break; }
                    }
                }
                if (!hit) continue;
            }

            results.Add(item);
        }

        int total = results.Count;
        int skip = (page - 1) * pageSize;
        var pagedItems = results.Skip(skip).Take(pageSize).ToList();

        var outObj = new {
            total = total,
            page = page,
            pageSize = pageSize,
            elapsedMs = sw.ElapsedMilliseconds,
            items = pagedItems
        };

        var outSer = new JavaScriptSerializer();
        outSer.MaxJsonLength = int.MaxValue;
        return outSer.Serialize(outObj);
    }
}
"@

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
try { $Listener.Prefixes.Add("http://127.0.0.1:$Port/") } catch {}
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

    if ($Path -eq "/api/ipc/fleet") {
      if (Test-Path $IpcFleetPath) {
        $Bytes = [System.IO.File]::ReadAllBytes($IpcFleetPath)
      } else {
        $Bytes = [System.Text.Encoding]::UTF8.GetBytes("[]")
      }
      $Res.ContentType = "application/json; charset=utf-8"
      $Res.ContentLength64 = $Bytes.Length
      $Res.StatusCode = 200
      $Res.OutputStream.Write($Bytes, 0, $Bytes.Length)
      $Res.OutputStream.Close()
      continue
    }

    if ($Path -eq "/api/ipc/stats") {
      if (-not [IpcSearchEngine]::IsLoaded) {
        [IpcSearchEngine]::Load($IpcCatalogPath)
      }
      $StatsJson = [IpcSearchEngine]::GetStats()
      $Bytes = [System.Text.Encoding]::UTF8.GetBytes($StatsJson)
      $Res.ContentType = "application/json; charset=utf-8"
      $Res.ContentLength64 = $Bytes.Length
      $Res.StatusCode = 200
      $Res.OutputStream.Write($Bytes, 0, $Bytes.Length)
      $Res.OutputStream.Close()
      continue
    }

    if ($Path -eq "/api/ipc/search") {
      if (-not [IpcSearchEngine]::IsLoaded) {
        [IpcSearchEngine]::Load($IpcCatalogPath)
      }
      $Q = [string]$Req.QueryString["q"]
      $Family = [string]$Req.QueryString["family"]
      $Plane = [string]$Req.QueryString["plane"]
      $Relation = [string]$Req.QueryString["relation"]
      $Installed = [string]$Req.QueryString["installed"]
      $HasAd = [string]$Req.QueryString["hasAd"]
      $Ata = [string]$Req.QueryString["ata"]
      $Page = 1
      if ($Req.QueryString["page"] -match '^\d+$') { $Page = [int]$Req.QueryString["page"] }
      $PageSize = 50
      if ($Req.QueryString["pageSize"] -match '^\d+$') { $PageSize = [int]$Req.QueryString["pageSize"] }

      $ResJson = [IpcSearchEngine]::SearchJson($Q, $Family, $Plane, $Relation, $Installed, $HasAd, $Ata, $Page, $PageSize)
      $Bytes = [System.Text.Encoding]::UTF8.GetBytes($ResJson)
      $Res.ContentType = "application/json; charset=utf-8"
      $Res.ContentLength64 = $Bytes.Length
      $Res.StatusCode = 200
      $Res.OutputStream.Write($Bytes, 0, $Bytes.Length)
      $Res.OutputStream.Close()
      continue
    }

    if ($Path -eq "/api/ipc/part-detail") {
      if (-not [IpcSearchEngine]::IsLoaded) {
        [IpcSearchEngine]::Load($IpcCatalogPath)
      }
      $Pn = [string]$Req.QueryString["pn"]
      $ResJson = [IpcSearchEngine]::GetPartDetail($Pn)
      $Bytes = [System.Text.Encoding]::UTF8.GetBytes($ResJson)
      $Res.ContentType = "application/json; charset=utf-8"
      $Res.ContentLength64 = $Bytes.Length
      $Res.StatusCode = 200
      $Res.OutputStream.Write($Bytes, 0, $Bytes.Length)
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
