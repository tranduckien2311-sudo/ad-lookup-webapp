param(
  [string]$Root = (Split-Path -Parent $MyInvocation.MyCommand.Path)
)

[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
$DbPath = Join-Path $Root "db\aeroad-database.json"
$ArchiveHtmlPath = Join-Path $Root "db\easa-archive-page.html"

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$db = [System.IO.File]::ReadAllText($DbPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json

# Build lookup of VJC fleet models & engines for accurate applicability check
$vjcModels = @($db.fleet | ForEach-Object { $_.model } | Select-Object -Unique)
$vjcEngines = @($db.fleet | ForEach-Object { $_.engineModel } | Where-Object { $_ } | Select-Object -Unique)

# Parse EASA Archive JSON
$html = [System.IO.File]::ReadAllText($ArchiveHtmlPath, [System.Text.Encoding]::UTF8)
$m = [regex]::Match($html, '<script type="application/json" data-drupal-selector="drupal-settings-json">(.*?)</script>', [System.Text.RegularExpressions.RegexOptions]::Singleline)
if (-not $m.Success) { throw "Cannot parse easa-archive-page.html" }
$archiveData = ($m.Groups[1].Value | ConvertFrom-Json).easa_datasets.data
$easaMap = @{}
foreach ($r in $archiveData) {
  $cls = [string]$r[0]
  $num = [string]$r[1]
  $url = if ($r[2] -match 'href="([^"]+)"') { "https://www.easa.europa.eu" + $matches[1] } else { "" }
  $key = "$cls|$num"
  $easaMap[$num] = @{
    cls = $cls; num = $num; url = $url;
    issued = ([string]$r[3]).Trim();
    subject = (([string]$r[4]) -replace '\s+', ' ').Trim();
    models = (([string]$r[5]) -replace '\s+', ' ').Trim();
    eff = ([string]$r[6]).Trim()
  }
}

function ConvertTo-IsoDate([string]$d) {
  if ([string]::IsNullOrWhiteSpace($d)) { return "" }
  if ($d -match '^(\d{4})-(\d{2})-(\d{2})') { return $d.Substring(0,10) }
  if ($d -match '^(\d{2})/(\d{2})/(\d{4})$') { return "$($matches[3])-$($matches[1])-$($matches[2])" }
  return $d
}

function Find-FaaFrRecord([string]$adNum) {
  $escNum = [regex]::Escape($adNum)
  foreach ($term in @("`"AD $adNum`"", "`"$adNum`"")) {
    $q = [System.Uri]::EscapeDataString($term)
    $apiUrl = "https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=federal-aviation-administration&conditions[type][]=RULE&conditions[term]=$q&per_page=20&order=oldest&fields[]=document_number&fields[]=title&fields[]=publication_date&fields[]=effective_on&fields[]=pdf_url&fields[]=html_url&fields[]=body_html_url&fields[]=abstract"
    try {
      $resp = Invoke-RestMethod -Uri $apiUrl -TimeoutSec 20
      foreach ($doc in ($resp.results)) {
        if ($doc.body_html_url) {
          try {
            $b = Invoke-RestMethod -Uri $doc.body_html_url -TimeoutSec 15
            $head = if ($b.Length -gt 4500) { $b.Substring(0, 4500) } else { $b }
            if ($head -match ("Amendment\s+39-\d+;\s*AD\s+" + $escNum + "\b")) {
              return $doc
            }
          } catch {}
        }
      }
    } catch {
      Write-Warning "FR lookup failed for ${adNum}: $_"
    }
  }
  return $null
}

$adsList = [System.Collections.ArrayList]@($db.ads)
$addedStandalone = @()
$addedSuperseded = @()

# Helper to check if an AD number already exists in top-level or superseded
function Has-TopLevel([string]$pattern) {
  foreach ($a in $adsList) {
    if ($a.adNumber -match $pattern -or $a.easaAdNumber -match $pattern -or $a.officialFaaAd -match $pattern) { return $true }
  }
  return $false
}

# 1. Alias updates on AMOS-EASA-2015-0135 & AUTO-2017-14469 -> include unpadded 2015-135R3 / 2016-176
foreach ($a in $adsList) {
  if ($a.id -eq "AMOS-EASA-2015-0135" -or $a.adNumber -like "*2015-0135R3*") {
    if ($a.adNumber -notlike "*2015-135R3*") {
      $a.adNumber = "$($a.adNumber) / 2015-135R3"
      Write-Host "Updated alias on $($a.id): $($a.adNumber)"
    }
  }
  if ($a.id -eq "AUTO-2017-14469" -and $a.adNumber -notlike "*2016-176*") {
    $a.adNumber = "$($a.adNumber) (2016-176)"
    Write-Host "Updated alias on $($a.id): $($a.adNumber)"
  }
}

# 2. Add missing standalone EASA entries from Archive
$standaloneEasa = @(
  @{
    key = "26-113"; id = "EASA-ARC-PAD-26-113"; adNum = "EASA PAD 26-113";
    isPad = $true; status = "Applicable";
    matched = @($db.fleet | Where-Object { $_.engine -like "CFM56-5B*" })
  },
  @{
    key = "2025-0238"; id = "EASA-ARC-2025-0238"; adNum = "EASA AD 2025-0238";
    isPad = $false; status = "Not Applicable"; matched = @()
  },
  @{
    key = "2022-0159-CN"; id = "EASA-ARC-2022-0159-CN"; adNum = "EASA AD 2022-0159-CN";
    isPad = $false; status = "Not Applicable"; matched = @()
  },
  @{
    key = "2016-0210"; id = "EASA-ARC-2016-0210"; adNum = "EASA AD 2016-0210";
    isPad = $false; status = "Applicable";
    matched = @($db.fleet | Where-Object { $_.type -like "A320*" -or $_.type -like "A321*" })
  }
)

foreach ($se in $standaloneEasa) {
  $existingItem = $adsList | Where-Object { $_.id -eq $se.id } | Select-Object -First 1
  if ($existingItem) {
    if ($se.status -eq "Applicable" -and ($existingItem.affectedCount -eq 0 -or -not $existingItem.affectedFleet)) {
      $effIso = $existingItem.effectiveDate
      $affArr = @()
      foreach ($f in $se.matched) {
        $affArr += [PSCustomObject]@{
          reg = $f.reg; msn = $f.msn; model = $f.type;
          engineModel = $f.engine; effectiveDate = $effIso
        }
      }
      $existingItem.affectedFleet = $affArr
      $existingItem.affectedCount = $affArr.Count
      $existingItem.adMsnScope = "Sàng lọc trên đội tàu VJC theo cấu hình áp dụng ($($affArr.Count)/$($db.fleet.Count) tàu)"
      $existingItem.vjcMatchedSummary = "Khớp $($affArr.Count) tàu VJC (CFM56 / A320-A321)"
      Write-Host "Updated fleet match on $($se.id): $($affArr.Count) aircraft"
    } else {
      Write-Host "Already top-level: $($se.key)"
    }
    continue
  }
  if (Has-TopLevel ([regex]::Escape($se.key))) {
    Write-Host "Already top-level: $($se.key)"
    continue
  }
  $info = $easaMap[$se.key]
  if (-not $info) {
    Write-Warning "Not found in EASA archive: $($se.key)"
    continue
  }
  $issIso = ConvertTo-IsoDate $info.issued
  $effIso = if ($info.eff) { ConvertTo-IsoDate $info.eff } else { "Pending (PAD)" }
  $affArr = @()
  foreach ($f in $se.matched) {
    $affArr += [PSCustomObject]@{
      reg = $f.reg; msn = $f.msn; model = $f.type;
      engineModel = $f.engine; effectiveDate = $effIso
    }
  }
  $noteStatus = if ($se.isPad) { "Proposed AD (PAD) — Pending Final AD" } elseif ($se.key -like "*-CN") { "Cancelled (CN)" } elseif ($se.status -eq "Applicable") { "Pending / Verify" } else { "Not Applicable" }
  $newObj = [PSCustomObject]@{
    id = $se.id
    adNumber = $se.adNum
    authority = "EASA"
    authorityDual = "EASA"
    officialFaaAd = ""
    easaAdNumber = $se.adNum
    easaUrl = $info.url
    pdfUrl = $info.url
    sourceUrl = "https://www.easa.europa.eu/en/domains/aircraft-products/airworthiness-directives-ad/archive-airworthiness-directives"
    issuedDate = $issIso
    issueDate = $issIso
    effectiveDate = $effIso
    easaIssuedDate = $issIso
    easaEffectiveDate = $effIso
    ata = if ($se.key -eq "26-113") { "ATA 72 (Engine)" } elseif ($se.key -eq "2025-0238") { "ATA 24 (Electrical Power)" } elseif ($se.key -eq "2022-0159-CN") { "ATA 23 (Communications)" } else { "ATA 25 (Equipment / Furnishings)" }
    subject = $info.subject
    easaSubject = $info.subject
    summary = "[$($se.adNum) | Issued: $issIso | Effective: $effIso] $($info.subject). Applies to: $($info.models)"
    easaSummary = "[$($se.adNum) | Issued: $issIso | Effective: $effIso] $($info.subject). Applies to: $($info.models)"
    targetModel = $info.models
    adExtractedModels = $info.models
    easaModels = $info.models
    adExtractedEngines = if ($se.key -eq "26-113") { "CFM56-5B / CFM56-7B" } else { "" }
    adMsnScope = if ($se.status -eq "Applicable") { "Sàng lọc trên đội tàu VJC theo cấu hình áp dụng ($($affArr.Count)/$($db.fleet.Count) tàu)" } else { "Không thuộc cấu hình đội bay Vietjet Air" }
    applicabilityStatus = $se.status
    complianceStatus = $noteStatus
    complianceTime = if ($se.isPad) { "Proposed AD — Theo dõi bình luận trước khi ban hành chính thức" } elseif ($se.key -like "*-CN") { "Cancelled" } else { "Theo compliance time trong EASA AD" }
    repetitiveInterval = "Theo văn bản AD gốc"
    vjcMatchedSummary = if ($affArr.Count -gt 0) { "Khớp $($affArr.Count) tàu VJC (CFM56 / A320-A321)" } else { "Không áp dụng cho đội bay VJC" }
    affectedCount = $affArr.Count
    affectedFleet = $affArr
    isSuperseded = $false
    supersededAds = @()
  }
  [void]$adsList.Add($newObj)
  $addedStandalone += $se.adNum
  Write-Host "Added standalone EASA: $($se.adNum)"
}

# 3. Add standalone FAA AD 2024-03-08 (Bombardier BD-700, FR 2024-06626) if not top-level
if (-not (Has-TopLevel "2024-03-08")) {
  $fr = Find-FaaFrRecord "2024-03-08"
  if ($fr) {
    $newFaa = [PSCustomObject]@{
      id = "AUTO-$($fr.document_number)"
      adNumber = "FAA AD 2024-03-08"
      authority = "FAA"
      authorityDual = "FAA"
      officialFaaAd = "2024-03-08"
      easaAdNumber = ""
      easaUrl = ""
      pdfUrl = $fr.pdf_url
      fullTextHtmlUrl = "https://www.govinfo.gov/content/pkg/FR-$($fr.publication_date)/html/$($fr.document_number).htm"
      sourceUrl = $fr.html_url
      issuedDate = $fr.publication_date
      issueDate = $fr.publication_date
      effectiveDate = $fr.effective_on
      ata = "ATA 36 (Pneumatic)"
      subject = "Bombardier, Inc., Airplanes (Model BD-700-1A10 & BD-700-1A11) — Bleed Air Leak Detection System"
      summary = $fr.abstract
      targetModel = "Bombardier BD-700-1A10, BD-700-1A11 (Global Express)"
      adExtractedModels = "Bombardier BD-700-1A10, BD-700-1A11"
      adExtractedEngines = ""
      adMsnScope = "Không áp dụng cho đội bay Vietjet Air (VJC không khai thác Bombardier BD-700)"
      applicabilityStatus = "Not Applicable"
      complianceStatus = "Not Applicable"
      complianceTime = "N/A (Not Applicable to VJC Fleet)"
      repetitiveInterval = "N/A"
      vjcMatchedSummary = "Không áp dụng (Model ngoài đội bay VJC)"
      affectedCount = 0
      affectedFleet = @()
      isSuperseded = $false
      supersededAds = @()
    }
    [void]$adsList.Add($newFaa)
    $addedStandalone += "FAA AD 2024-03-08"
    Write-Host "Added standalone FAA: FAA AD 2024-03-08 (FR $($fr.document_number))"
  }
}

# 4. Materialize 2nd-generation / grandparent superseded ADs into their active parent's supersededAds
$supMappings = @(
  @{ parentPattern = "2026-09-03"; faa = "2024-04-03"; easa = "" },
  @{ parentPattern = "2026-09-03"; faa = "2023-13-10"; easa = "2023-0151" },
  @{ parentPattern = "2026-09-03"; faa = "2017-22-03"; easa = "" },
  @{ parentPattern = "2026-03-10"; faa = "2024-04-07"; easa = "" },
  @{ parentPattern = "2026-03-10"; faa = "2023-04-06"; easa = "" },
  @{ parentPattern = "2025-19-04"; faa = "2023-21-02"; easa = "2023-0015" },
  @{ parentPattern = "2026-20-15"; faa = "2023-11-08"; easa = "2022-0227" },
  @{ parentPattern = "2026-03-07"; faa = "2022-16-07"; easa = "2021-0248R1" },
  @{ parentPattern = "2024-24-10"; faa = "2022-07-08"; easa = "" },
  @{ parentPattern = "2024-24-10"; faa = "2020-21-10"; easa = "" },
  @{ parentPattern = "2025-02-04"; faa = "2020-21-11"; easa = "" },
  @{ parentPattern = "2023-20-12"; faa = "2019-26-11"; easa = "2019-0106" },
  @{ parentPattern = "2022-24-13"; faa = "2019-21-10"; easa = "2019-0012" },
  @{ parentPattern = "2026-12-02"; faa = "2019-20-10"; easa = "" },
  @{ parentPattern = "2026-09-17"; faa = "2019-14-04"; easa = "" },
  @{ parentPattern = "2026-09-17"; faa = "2018-17-21"; easa = "" },
  @{ parentPattern = "2026-09-17"; faa = "2016-20-12"; easa = "" },
  @{ parentPattern = "2022-12-05"; faa = "2019-03-18"; easa = "" },
  @{ parentPattern = "2024-12-01"; faa = "2018-13-08"; easa = "" },
  @{ parentPattern = "2020-22-16"; faa = "2017-19-24"; easa = "" },
  @{ parentPattern = "2023-23-11"; faa = "2017-01-11"; easa = "" },
  @{ parentPattern = "2023-23-08"; faa = "2016-19-14"; easa = "" }
)

foreach ($map in $supMappings) {
  $parent = $adsList | Where-Object { $_.adNumber -match [regex]::Escape($map.parentPattern) } | Select-Object -First 1
  if (-not $parent) {
    Write-Warning "Parent not found for $($map.parentPattern) -> $($map.faa)"
    continue
  }
  $existingObj = $null
  foreach ($s in ($parent.supersededAds)) {
    if ($s.adNumber -match [regex]::Escape($map.faa)) { $existingObj = $s; break }
  }
  if ($existingObj -and $existingObj.pdfUrl -like "https://www.govinfo.gov/*" -and $existingObj.summary.Length -gt 60) {
    continue
  }

  $fr = Find-FaaFrRecord $map.faa
  $eInfo = if ($map.easa -and $easaMap.ContainsKey($map.easa)) { $easaMap[$map.easa] } else { $null }
  $adLabel = if ($eInfo) { "FAA AD $($map.faa) / EASA AD $($map.easa)" } else { "FAA AD $($map.faa)" }
  $faaTitle = if ($fr -and $fr.title) { $fr.title } else { $parent.subject }
  $faaSummary = if ($fr -and $fr.abstract) { $fr.abstract } else { "$adLabel (Superseded chain under $($parent.adNumber))" }
  $faaPub = if ($fr -and $fr.publication_date) { $fr.publication_date } else { "" }
  $faaEff = if ($fr -and $fr.effective_on) { $fr.effective_on } else { $faaPub }
  $faaPdf = if ($fr -and $fr.pdf_url) { $fr.pdf_url } else { "" }
  $faaSrc = if ($fr -and $fr.html_url) { $fr.html_url } else { "" }

  if ($existingObj) {
    $existingObj.subject = $faaTitle
    $existingObj.summary = $faaSummary
    $existingObj.issuedDate = $faaPub
    $existingObj.effectiveDate = $faaEff
    $existingObj.pdfUrl = $faaPdf
    $existingObj.sourceUrl = $faaSrc
    Write-Host "Refreshed superseded FR metadata: $adLabel -> FR $(if ($fr) { $fr.document_number } else { 'none' })"
    continue
  }

  $supObj = [PSCustomObject]@{
    adNumber = $adLabel
    officialFaaAd = $map.faa
    authority = if ($eInfo) { "EASA" } else { "FAA" }
    authorityDual = if ($eInfo) { "EASA / FAA" } else { "FAA" }
    issuedDate = $faaPub
    effectiveDate = $faaEff
    subject = $faaTitle
    summary = $faaSummary
    pdfUrl = $faaPdf
    sourceUrl = $faaSrc
    targetModel = $parent.targetModel
    complianceTime = "Superseded"
    repetitiveInterval = "N/A"
    complianceStatus = "Superseded"
    applicabilityStatus = "Superseded"
    supersededBy = $parent.adNumber
  }
  if ($eInfo) {
    $supObj | Add-Member -MemberType NoteProperty -Name "easaAdNumber" -Value "EASA AD $($map.easa)" -Force
    $supObj | Add-Member -MemberType NoteProperty -Name "easaUrl" -Value $eInfo.url -Force
    $supObj | Add-Member -MemberType NoteProperty -Name "easaIssuedDate" -Value (ConvertTo-IsoDate $eInfo.issued) -Force
    $supObj | Add-Member -MemberType NoteProperty -Name "easaEffectiveDate" -Value (ConvertTo-IsoDate $eInfo.eff) -Force
    $supObj | Add-Member -MemberType NoteProperty -Name "easaSubject" -Value $eInfo.subject -Force
  }
  $newSups = @($parent.supersededAds) + @($supObj)
  $parent.supersededAds = $newSups
  $addedSuperseded += "$adLabel -> under $($parent.adNumber)"
  Write-Host "Added superseded: $adLabel under $($parent.adNumber) (FR: $(if ($fr) { $fr.document_number } else { 'none' }))"
}

$db.ads = @($adsList)
$outJson = $db | ConvertTo-Json -Depth 12 -Compress
[System.IO.File]::WriteAllText($DbPath, $outJson, $Utf8NoBom)

Write-Host "`nDONE!"
Write-Host "Standalone added ($($addedStandalone.Count)): $($addedStandalone -join ', ')"
Write-Host "Superseded chain added ($($addedSuperseded.Count)): $($addedSuperseded.Count)"
