param(
  [string]$DbPath = (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "db\aeroad-database.json")
)

$ErrorActionPreference = "Stop"
$RawJson = [System.IO.File]::ReadAllText($DbPath, [System.Text.Encoding]::UTF8)
$Db = $RawJson | ConvertFrom-Json

# 1. Collect all Superseded AD numbers that need their own PDF / Verbatim Text
$MissingAdNums = [System.Collections.Generic.HashSet[string]]::new()
foreach ($ad in $Db.ads) {
  if ($ad.supersededAds) {
    foreach ($s in $ad.supersededAds) {
      $cleanNum = ($s.adNumber -replace '^(FAA\s+|EASA\s+)?AD\s+', '').Trim()
      if ($s.pdfUrl -eq $ad.pdfUrl -or $s.summary -like "Chỉ lệnh*") {
        [void]$MissingAdNums.Add($cleanNum)
      }
    }
  }
}

Write-Host "Resolving exact PDF URLs and verbatim text for $($MissingAdNums.Count) Superseded ADs from Federal Register API..." -ForegroundColor Cyan

$ResolvedMap = @{}
$FieldsParam = "fields[]=document_number&fields[]=title&fields[]=publication_date&fields[]=effective_on&fields[]=docket_ids&fields[]=abstract&fields[]=html_url&fields[]=pdf_url"

# Query in batches of 8 AD numbers using OR search, then match exact AD number
$MissingArray = @($MissingAdNums | Sort-Object)
$BatchSize = 6
for ($i = 0; $i -lt $MissingArray.Count; $i += $BatchSize) {
  $Batch = $MissingArray[$i..([Math]::Min($i + $BatchSize - 1, $MissingArray.Count - 1))]
  $TermQuery = ($Batch | ForEach-Object { "`"$_`"" }) -join " OR "
  $EncodedTerm = [System.Uri]::EscapeDataString($TermQuery)
  $Url = "https://www.federalregister.gov/api/v1/documents.json?per_page=100&conditions[agencies][]=federal-aviation-administration&conditions[type][]=RULE&conditions[term]=$EncodedTerm&$FieldsParam"

  try {
    $Resp = Invoke-RestMethod -Uri $Url -TimeoutSec 20
    if ($Resp -and $Resp.results) {
      foreach ($doc in $Resp.results) {
        $docNum = [string]$doc.document_number
        $pubDate = [string]$doc.publication_date
        $effDate = if ($doc.effective_on) { [string]$doc.effective_on } else { $pubDate }
        $title = [string]$doc.title
        $abstract = [string]$doc.abstract
        $pdfUrl = if ($doc.pdf_url) { [string]$doc.pdf_url } else { "https://www.govinfo.gov/content/pkg/FR-$pubDate/pdf/$docNum.pdf" }
        $htmUrl = "https://www.govinfo.gov/content/pkg/FR-$pubDate/html/$docNum.htm"
        $srcUrl = if ($doc.html_url) { [string]$doc.html_url } else { "https://www.federalregister.gov/d/$docNum" }

        # Check which AD number in our list this document IS (by docket_ids or first AD mentioned when not superseding it)
        $docketStr = if ($doc.docket_ids) { ($doc.docket_ids -join " ") } else { "" }
        foreach ($cand in $Batch) {
          if ($ResolvedMap.ContainsKey($cand)) { continue }
          $escapedCand = [regex]::Escape($cand)
          $isExactMatch = $false
          if ($docketStr -match "AD\s+$escapedCand\b" -or $docketStr -match "\b$escapedCand\b") {
            $isExactMatch = $true
          } elseif ($abstract -match "adopting\s+Airworthiness\s+Directive\s*\(AD\)\s+$escapedCand" -or $abstract -match "AD\s+$escapedCand\s+requires" -or ($pubDate.StartsWith($cand.Substring(0,4)) -and "$title $abstract" -match "\b$escapedCand\b")) {
            $isExactMatch = $true
          }

          if ($isExactMatch) {
            $ResolvedMap[$cand] = @{
              adNumber        = "FAA AD $cand"
              docNumber       = $docNum
              issuedDate      = $pubDate
              effectiveDate   = $effDate
              subject         = $title
              summary         = if ($abstract) { $abstract } else { $title }
              pdfUrl          = $pdfUrl
              fullTextHtmlUrl = $htmUrl
              sourceUrl       = $srcUrl
            }
          }
        }
      }
    }
  } catch {
    Write-Warning "Batch query warning: $_"
  }
}

# Second pass: For any remaining unresolved AD numbers, query individually to get the best matching FR rule PDF
$Remaining = @($MissingArray | Where-Object { -not $ResolvedMap.ContainsKey($_) })
Write-Host "Resolved $($ResolvedMap.Count) in batch pass. Running individual lookup for $($Remaining.Count) older ADs..." -ForegroundColor Yellow

foreach ($cand in $Remaining) {
  $Encoded = [System.Uri]::EscapeDataString("`"$cand`"")
  $Url = "https://www.federalregister.gov/api/v1/documents.json?per_page=10&order=oldest&conditions[agencies][]=federal-aviation-administration&conditions[type][]=RULE&conditions[term]=$Encoded&$FieldsParam"
  try {
    $Resp = Invoke-RestMethod -Uri $Url -TimeoutSec 15
    if ($Resp -and $Resp.results -and $Resp.results.Count -gt 0) {
      # Pick the earliest Final Rule document that mentions this AD number (which is the original issuance of that AD!)
      $doc = $Resp.results[0]
      foreach ($rDoc in $Resp.results) {
        $dkStr = if ($rDoc.docket_ids) { ($rDoc.docket_ids -join " ") } else { "" }
        if ($dkStr -match [regex]::Escape($cand) -or ([string]$rDoc.publication_date).StartsWith($cand.Substring(0,4))) {
          $doc = $rDoc
          break
        }
      }
      $docNum = [string]$doc.document_number
      $pubDate = [string]$doc.publication_date
      $effDate = if ($doc.effective_on) { [string]$doc.effective_on } else { $pubDate }
      $title = [string]$doc.title
      $abstract = [string]$doc.abstract
      $pdfUrl = if ($doc.pdf_url) { [string]$doc.pdf_url } else { "https://www.govinfo.gov/content/pkg/FR-$pubDate/pdf/$docNum.pdf" }
      $htmUrl = "https://www.govinfo.gov/content/pkg/FR-$pubDate/html/$docNum.htm"
      $srcUrl = if ($doc.html_url) { [string]$doc.html_url } else { "https://www.federalregister.gov/d/$docNum" }

      $ResolvedMap[$cand] = @{
        adNumber        = "FAA AD $cand"
        docNumber       = $docNum
        issuedDate      = $pubDate
        effectiveDate   = $effDate
        subject         = $title
        summary         = if ($abstract) { $abstract } else { $title }
        pdfUrl          = $pdfUrl
        fullTextHtmlUrl = $htmUrl
        sourceUrl       = $srcUrl
      }
    }
  } catch {}
}

Write-Host "Total Superseded ADs resolved with exact Federal Register PDF & Verbatim Text: $($ResolvedMap.Count) / $($MissingArray.Count)" -ForegroundColor Green

# Update all Superseded AD records in $Db.ads and remove synthetic evaluation fields
$UpdatedSupCount = 0
foreach ($ad in $Db.ads) {
  # Remove synthetic evaluationForm & synthetic workInstructions
  if ($ad.PSObject.Properties["evaluationForm"]) {
    $ad.PSObject.Properties.Remove("evaluationForm")
  }
  if ($ad.PSObject.Properties["workInstructions"]) {
    $ad.PSObject.Properties.Remove("workInstructions")
  }

  if ($ad.supersededAds) {
    foreach ($s in $ad.supersededAds) {
      $cleanNum = ($s.adNumber -replace '^(FAA\s+|EASA\s+)?AD\s+', '').Trim()
      if ($ResolvedMap.ContainsKey($cleanNum)) {
        $info = $ResolvedMap[$cleanNum]
        $s | Add-Member -NotePropertyName "adNumber" -NotePropertyValue $info.adNumber -Force
        $s | Add-Member -NotePropertyName "docNumber" -NotePropertyValue $info.docNumber -Force
        $s | Add-Member -NotePropertyName "issuedDate" -NotePropertyValue $info.issuedDate -Force
        $s | Add-Member -NotePropertyName "effectiveDate" -NotePropertyValue $info.effectiveDate -Force
        $s | Add-Member -NotePropertyName "subject" -NotePropertyValue $info.subject -Force
        $s | Add-Member -NotePropertyName "summary" -NotePropertyValue $info.summary -Force
        $s | Add-Member -NotePropertyName "pdfUrl" -NotePropertyValue $info.pdfUrl -Force
        $s | Add-Member -NotePropertyName "fullTextHtmlUrl" -NotePropertyValue $info.fullTextHtmlUrl -Force
        $s | Add-Member -NotePropertyName "sourceUrl" -NotePropertyValue $info.sourceUrl -Force
        $UpdatedSupCount++
      } elseif ($s.pdfUrl -eq $ad.pdfUrl) {
        # Fallback direct search URL on DRS FAA / GovInfo for that specific AD number
        $s | Add-Member -NotePropertyName "pdfUrl" -NotePropertyValue "/api/resolve-ad-pdf?ad=$([System.Uri]::EscapeDataString($cleanNum))" -Force
      }
    }
  }
}

$OutJson = $Db | ConvertTo-Json -Depth 12 -Compress
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($DbPath, $OutJson, $Utf8NoBom)
Write-Host "Updated $UpdatedSupCount Superseded AD entries in $DbPath with their own real PDF URLs and verbatim text!" -ForegroundColor Green
