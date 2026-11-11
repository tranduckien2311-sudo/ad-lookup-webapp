param(
  [string]$DbPath = (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "db\aeroad-database.json"),
  [string]$CertRoot = "G:\My Drive\VJC Certificate\VJC Aircraft",
  [string]$NewAircraftJson = ""
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $DbPath)) {
  throw "Database file not found: $DbPath"
}

$RawDbJson = [System.IO.File]::ReadAllText($DbPath, [System.Text.Encoding]::UTF8)
$Db = $RawDbJson | ConvertFrom-Json

# Convert existing fleet to hashtable keyed by Registration (VN-Axxx)
$FleetMap = [ordered]@{}
foreach ($ac in $Db.fleet) {
  $FleetMap[$ac.reg.ToUpper()] = [ordered]@{
    reg        = [string]$ac.reg.ToUpper()
    msn        = [string]$ac.msn
    type       = [string]$ac.type
    family     = [string]$ac.family
    engine     = [string]$ac.engine
    fh         = [int]$ac.fh
    fc         = [int]$ac.fc
    base       = [string]$ac.base
    status     = [string]$ac.status
    certSource = [string]$ac.certSource
  }
}

$InitialCount = $FleetMap.Count
$NewlyDiscovered = @()
$UpdatedRegs = @()
$ScannedFoldersCount = 0

# Known exact overrides from verified CAAV Noise Certificates inside folders
$VerifiedNoiseOverrides = @{
  "VN-A698" = @{ type = "A321-211"; family = "A321"; engine = "CFM56-5B3/3" }
  "VN-A533" = @{ type = "A321-271NX"; family = "A321"; engine = "PW1133G-JM" }
}

# 1. Scan official CAAV Certificate Directory if accessible
if (Test-Path $CertRoot) {
  $Dirs = Get-ChildItem -Path $CertRoot -Directory
  $ScannedFoldersCount = $Dirs.Count

  foreach ($d in $Dirs) {
    $FolderName = $d.Name.Trim()
    $RegMatch = [regex]::Match($FolderName, '(VN-A[0-9]{3})', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $MsnMatch = [regex]::Match($FolderName, 'MSN\s*0*([0-9]{3,5})', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)

    if ($RegMatch.Success -and $MsnMatch.Success) {
      $Reg = $RegMatch.Groups[1].Value.ToUpper()
      $MsnRaw = $MsnMatch.Groups[1].Value
      $MsnInt = [int]$MsnRaw
      $MsnFormatted = if ($MsnInt -lt 1000) { $MsnInt.ToString("0000") } else { $MsnInt.ToString() }

      # Determine exact aircraft variant & engine model
      $AcType = "A321-211"
      $AcFamily = "A321"
      $AcEngine = "CFM56-5B3/3"

      if ($VerifiedNoiseOverrides.ContainsKey($Reg)) {
        $AcType = $VerifiedNoiseOverrides[$Reg].type
        $AcFamily = $VerifiedNoiseOverrides[$Reg].family
        $AcEngine = $VerifiedNoiseOverrides[$Reg].engine
      } elseif ($FolderName -match 'A330' -or $Reg -like 'VN-A8*') {
        $AcType = "A330-343"
        $AcFamily = "A330"
        $AcEngine = "Trent 772B-60"
      } elseif ($FolderName -match 'A321\s*NEO|A32NEO' -or $MsnInt -ge 8900) {
        $AcFamily = "A321"
        $AcEngine = "PW1133G-JM"
        if ($MsnInt -ge 8900) {
          $AcType = "A321-271NX"
        } else {
          $AcType = "A321-271N"
        }
      } elseif ($FolderName -match '\(A321\)') {
        $AcFamily = "A321"
        $AcType = "A321-211"
        $AcEngine = if ($MsnInt -lt 5500) { "CFM56-5B3/P" } else { "CFM56-5B3/3" }
      } else {
        $AcFamily = "A320"
        $AcType = "A320-214"
        $AcEngine = if ($MsnInt -lt 4500) { "CFM56-5B4/P" } else { "CFM56-5B4/3" }
      }

      if (-not $FleetMap.Contains($Reg)) {
        $FhEst = [Math]::Max(800, 36000 - ($MsnInt * 2))
        $FcEst = [Math]::Max(450, [int]($FhEst * 0.6))
        $FleetMap[$Reg] = [ordered]@{
          reg        = $Reg
          msn        = $MsnFormatted
          type       = $AcType
          family     = $AcFamily
          engine     = $AcEngine
          fh         = $FhEst
          fc         = $FcEst
          base       = "SGN"
          status     = "Active"
          certSource = "CAAV Certificate ($FolderName)"
        }
        $NewlyDiscovered += "$Reg (MSN $MsnFormatted • $AcType • $AcEngine)"
      } else {
        $Existing = $FleetMap[$Reg]
        if ($Existing.msn -ne $MsnFormatted -or $Existing.type -ne $AcType -or $Existing.engine -ne $AcEngine) {
          $Existing.msn = $MsnFormatted
          $Existing.type = $AcType
          $Existing.family = $AcFamily
          $Existing.engine = $AcEngine
          $Existing.certSource = "CAAV Certificate ($FolderName)"
          $UpdatedRegs += "$Reg (MSN $MsnFormatted • $AcType)"
        }
      }
    }
  }
}

# 2. If a new/updated aircraft was submitted via JSON payload, add/update it as well
if (-not [string]::IsNullOrWhiteSpace($NewAircraftJson)) {
  try {
    $NewAc = $NewAircraftJson | ConvertFrom-Json
    if ($NewAc.reg -and $NewAc.msn -and $NewAc.type) {
      $Reg = ([string]$NewAc.reg).Trim().ToUpper()
      $Msn = ([string]$NewAc.msn).Trim()
      $Type = ([string]$NewAc.type).Trim()
      $Family = if ($Type -match '^A330') { "A330" } elseif ($Type -match '^A321') { "A321" } else { "A320" }
      $Engine = if ($NewAc.engine) { ([string]$NewAc.engine).Trim() } elseif ($Type -match '271N') { "PW1133G-JM" } elseif ($Type -match '343') { "Trent 772B-60" } elseif ($Type -match '211') { "CFM56-5B3/3" } else { "CFM56-5B4/3" }
      $Fh = if ($NewAc.fh) { [int]$NewAc.fh } else { 1200 }
      $Fc = if ($NewAc.fc) { [int]$NewAc.fc } else { 700 }
      $Base = if ($NewAc.base) { ([string]$NewAc.base).Trim().ToUpper() } else { "SGN" }

      $IsNew = -not $FleetMap.Contains($Reg)
      $FleetMap[$Reg] = [ordered]@{
        reg        = $Reg
        msn        = $Msn
        type       = $Type
        family     = $Family
        engine     = $Engine
        fh         = $Fh
        fc         = $Fc
        base       = $Base
        status     = "Active"
        certSource = "CAAV Registry / Manual Update"
      }
      if ($IsNew) {
        $NewlyDiscovered += "$Reg (MSN $Msn • $Type • $Engine)"
      } else {
        $UpdatedRegs += "$Reg (MSN $Msn • $Type • $Engine)"
      }
    }
  } catch {}
}

$UpdatedFleetList = @($FleetMap.Values)
$TotalFleetCount = $UpdatedFleetList.Count

# Count aircraft per variant
$CountByType = @{}
foreach ($t in @("A320-214", "A321-211", "A321-271N", "A321-271NX", "A330-343")) {
  $CountByType[$t] = @($UpdatedFleetList | Where-Object { $_.type -eq $t }).Count
}

# Re-calculate affectedCount & vjcMatchedSummary across all ADs in DB
foreach ($ad in $Db.ads) {
  if ($ad.applicabilityStatus -eq "Applicable" -and $ad.matchedTypes) {
    $cnt = 0
    $labels = @()
    foreach ($mt in $ad.matchedTypes) {
      $c = if ($CountByType.ContainsKey($mt)) { $CountByType[$mt] } else { 0 }
      $cnt += $c
      if ($mt -eq "A320-214") { $labels += "A320-214 ($c tàu • CFM56-5B4)" }
      elseif ($mt -eq "A321-211") { $labels += "A321-211 CEO ($c tàu • CFM56-5B3)" }
      elseif ($mt -eq "A321-271N") { $labels += "A321-271N NEO ($c tàu • PW1133G-JM)" }
      elseif ($mt -eq "A321-271NX") { $labels += "A321-271NX NEO ACF ($c tàu • PW1133G-JM)" }
      elseif ($mt -eq "A330-343") { $labels += "A330-343 ($c tàu • Trent 772B-60)" }
    }
    $ad | Add-Member -NotePropertyName "affectedCount" -NotePropertyValue $cnt -Force
    if ($labels.Count -gt 0) {
      $ad | Add-Member -NotePropertyName "vjcMatchedSummary" -NotePropertyValue ($labels -join " + ") -Force
    }
  }
}

$NowStr = (Get-Date).ToString("dd/MM/yyyy HH:mm:ss")
$Db | Add-Member -NotePropertyName "lastSyncedAt" -NotePropertyValue $NowStr -Force
$Db | Add-Member -NotePropertyName "fleetCount" -NotePropertyValue $TotalFleetCount -Force
$Db | Add-Member -NotePropertyName "fleet" -NotePropertyValue $UpdatedFleetList -Force

# Add scan summary metadata to response
$ScanReport = [ordered]@{
  scannedAt           = $NowStr
  certFolderScanned   = $CertRoot
  scannedFoldersCount = $ScannedFoldersCount
  previousFleetCount  = $InitialCount
  currentFleetCount   = $TotalFleetCount
  newlyDiscovered     = $NewlyDiscovered
  updatedAircraft     = $UpdatedRegs
  variantBreakdown    = $CountByType
}
$Db | Add-Member -NotePropertyName "lastFleetScanReport" -NotePropertyValue $ScanReport -Force

$JsonOut = $Db | ConvertTo-Json -Depth 12 -Compress
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($DbPath, $JsonOut, $Utf8NoBom)
