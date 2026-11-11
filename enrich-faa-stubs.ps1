param(
  [string]$Root = (Split-Path -Parent $MyInvocation.MyCommand.Path)
)

[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
$DbPath = Join-Path $Root "db\aeroad-database.json"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$db = [System.IO.File]::ReadAllText($DbPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json

function Find-ExactFrDoc([string]$adNum) {
  $escNum = [regex]::Escape($adNum)
  foreach ($term in @("`"AD $adNum`"", "`"$adNum`"")) {
    $q = [System.Uri]::EscapeDataString($term)
    $apiUrl = "https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=federal-aviation-administration&conditions[type][]=RULE&conditions[term]=$q&per_page=15&order=oldest&fields[]=document_number&fields[]=title&fields[]=publication_date&fields[]=effective_on&fields[]=pdf_url&fields[]=html_url&fields[]=body_html_url&fields[]=abstract"
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
    } catch {}
  }
  return $null
}

$targets = @($db.ads | Where-Object {
  $_.applicabilityStatus -eq "Applicable" -and
  $_.officialFaaAd -and
  ($_.summary -match "^\[|Imported from AMOS" -or $_.summary.Length -lt 100)
})

Write-Host "Enriching $($targets.Count) FAA Applicable AMOS stub summaries from Federal Register..." -ForegroundColor Cyan
$ok = 0
foreach ($a in $targets) {
  $faaNum = [string]$a.officialFaaAd
  if ($faaNum -notmatch '^\d{4}-\d{2}-\d{2}$') { continue }
  $fr = Find-ExactFrDoc $faaNum
  if ($fr -and $fr.abstract) {
    $a.summary = $fr.abstract
    if (-not $a.pdfUrl -or $a.pdfUrl -notlike "*govinfo.gov*") {
      if ($fr.pdf_url) {
        $a.pdfUrl = $fr.pdf_url
        if (-not $a.PSObject.Properties["fullTextHtmlUrl"]) {
          $a | Add-Member -MemberType NoteProperty -Name "fullTextHtmlUrl" -Value "https://www.govinfo.gov/content/pkg/FR-$($fr.publication_date)/html/$($fr.document_number).htm" -Force
        } else {
          $a.fullTextHtmlUrl = "https://www.govinfo.gov/content/pkg/FR-$($fr.publication_date)/html/$($fr.document_number).htm"
        }
      }
    }
    if (-not $a.effectiveDate -and $fr.effective_on) { $a.effectiveDate = $fr.effective_on }
    if ($fr.html_url -and ($a.sourceUrl -notlike "*federalregister.gov*")) { $a.sourceUrl = $fr.html_url }
    $ok++
    Write-Host "  [FR $($fr.document_number)] Updated FAA AD $faaNum"
  }
}

$outJson = $db | ConvertTo-Json -Depth 12 -Compress
[System.IO.File]::WriteAllText($DbPath, $outJson, $Utf8NoBom)
Write-Host "Done! Updated $ok / $($targets.Count) FAA ADs with verbatim Federal Register abstracts." -ForegroundColor Green
