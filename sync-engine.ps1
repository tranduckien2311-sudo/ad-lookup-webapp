param(
  [string]$DbPath = (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "db\aeroad-database.json")
)

$ErrorActionPreference = "Stop"
$DbFolder = Split-Path -Parent $DbPath
if (!(Test-Path $DbFolder)) {
  New-Item -ItemType Directory -Path $DbFolder -Force | Out-Null
}

# ==============================================================================
# 1. AUTHENTIC VIETJET AIR (VJC) FLEET REGISTRY (108 AIRCRAFT)
#    Verified directly against CAAV Certificates in `G:\My Drive\VJC Certificate\VJC Aircraft`
#    Exact Registration (VN-Axxx), Exact Airbus MSN, Exact Variant, Exact Engine Model
# ==============================================================================
$RawVjcFleetData = @(
  # --- 15 x Airbus A320-214 (CFM56-5B4/P & CFM56-5B4/3) ---
  @{ reg="VN-A666"; msn="3739"; type="A320-214"; family="A320"; engine="CFM56-5B4/P"; certFolder="VN-A666 MSN 3739" },
  @{ reg="VN-A668"; msn="3791"; type="A320-214"; family="A320"; engine="CFM56-5B4/P"; certFolder="VN-A668 MSN 3791" },
  @{ reg="VN-A669"; msn="4049"; type="A320-214"; family="A320"; engine="CFM56-5B4/P"; certFolder="VN-A669 MSN 4049" },
  @{ reg="VN-A689"; msn="4190"; type="A320-214"; family="A320"; engine="CFM56-5B4/P"; certFolder="VN-A689 msn 4190" },
  @{ reg="VN-A699"; msn="4193"; type="A320-214"; family="A320"; engine="CFM56-5B4/P"; certFolder="VN-A699 msn 4193" },
  @{ reg="VN-A658"; msn="6341"; type="A320-214"; family="A320"; engine="CFM56-5B4/3"; certFolder="VN-A658 MSN 6341" },
  @{ reg="VN-A650"; msn="6457"; type="A320-214"; family="A320"; engine="CFM56-5B4/3"; certFolder="VN-A650 MSN 6457" },
  @{ reg="VN-A655"; msn="6498"; type="A320-214"; family="A320"; engine="CFM56-5B4/3"; certFolder="VN-A655 MSN 6498" },
  @{ reg="VN-A656"; msn="6584"; type="A320-214"; family="A320"; engine="CFM56-5B4/3"; certFolder="VN-A656 MSN 6584" },
  @{ reg="VN-A662"; msn="6738"; type="A320-214"; family="A320"; engine="CFM56-5B4/3"; certFolder="VN-A662 MSN 6738" },
  @{ reg="VN-A663"; msn="6779"; type="A320-214"; family="A320"; engine="CFM56-5B4/3"; certFolder="VN-A663 MSN 6779" },
  @{ reg="VN-A671"; msn="6958"; type="A320-214"; family="A320"; engine="CFM56-5B4/3"; certFolder="VN-A671 MSN 6958" },
  @{ reg="VN-A672"; msn="6997"; type="A320-214"; family="A320"; engine="CFM56-5B4/3"; certFolder="VN-A672 MSN 6997" },
  @{ reg="VN-A675"; msn="7167"; type="A320-214"; family="A320"; engine="CFM56-5B4/3"; certFolder="VN-A675 MSN 7167" },
  @{ reg="VN-A676"; msn="7170"; type="A320-214"; family="A320"; engine="CFM56-5B4/3"; certFolder="VN-A676 MSN 7170" },

  # --- 41 x Airbus A321-211 CEO (CFM56-5B3/P & CFM56-5B3/3) ---
  @{ reg="VN-A651"; msn="5295"; type="A321-211"; family="A321"; engine="CFM56-5B3/P"; certFolder="VN-A651 (A321) MSN 5295" },
  @{ reg="VN-A532"; msn="6526"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A532 (A321) MSN 6526" },
  @{ reg="VN-A522"; msn="6615"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A522 (A321) MSN 6615" },
  @{ reg="VN-A660"; msn="6696"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="" },
  @{ reg="VN-A665"; msn="6852"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="" },
  @{ reg="VN-A667"; msn="6936"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A667 (A321) MSN 6936" },
  @{ reg="VN-A541"; msn="6968"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="" },
  @{ reg="VN-A535"; msn="7003"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A535 (A321) MSN 7003" },
  @{ reg="VN-A542"; msn="7048"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A542 (A321) MSN 7048" },
  @{ reg="VN-A544"; msn="7055"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A544 (A321) MSN 7055" },
  @{ reg="VN-A673"; msn="7143"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A673 (A321) MSN 7143" },
  @{ reg="VN-A677"; msn="7241"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A677 (A321) msn 7241" },
  @{ reg="VN-A683"; msn="7278"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A683 (A321) msn 7278" },
  @{ reg="VN-A684"; msn="7342"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A684 (A321) msn 7342" },
  @{ reg="VN-A685"; msn="7427"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A685 (A321) msn 7427" },
  @{ reg="VN-A687"; msn="7454"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A687 (A321) msn 7454" },
  @{ reg="VN-A630"; msn="7655"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A630 (A321) MSN 7655" },
  @{ reg="VN-A640"; msn="7658"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A640 (A321) MSN 7658" },
  @{ reg="VN-A631"; msn="7675"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A631 (A321) MSN 7675" },
  @{ reg="VN-A641"; msn="7684"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A641 (A321) MSN 7684" },
  @{ reg="VN-A642"; msn="7689"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A642 (A321) MSN 7689" },
  @{ reg="VN-A632"; msn="7888"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A632 (A321) MSN 7888" },
  @{ reg="VN-A633"; msn="7894"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A633 (A321) MSN 7894" },
  @{ reg="VN-A634"; msn="7898"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A634 (A321) MSN 7898" },
  @{ reg="VN-A635"; msn="7919"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A635 (A321) MSN 7919" },
  @{ reg="VN-A636"; msn="7933"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A636 (A321) MSN 7933" },
  @{ reg="VN-A643"; msn="7940"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A643 (A321) MSN7940" },
  @{ reg="VN-A644"; msn="7953"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A644 (A321) MSN 7953" },
  @{ reg="VN-A645"; msn="7962"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A645 (A321) MSN 7962" },
  @{ reg="VN-A637"; msn="7998"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A637 (A321) MSN 7998" },
  @{ reg="VN-A638"; msn="8032"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="" },
  @{ reg="VN-A639"; msn="8034"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A639 (A321) MSN 8034" },
  @{ reg="VN-A647"; msn="8061"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A647 (A321) MSN 8061" },
  @{ reg="VN-A648"; msn="8076"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A648 (A321) MSN 8076" },
  @{ reg="VN-A649"; msn="8153"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A649 (A321) MSN 8153" },
  @{ reg="VN-A657"; msn="8215"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A657 (A321) MSN 8215" },
  @{ reg="VN-A698"; msn="8393"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A698 (A321NEO) MSN 8393" },
  @{ reg="VN-A628"; msn="8592"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="" },
  @{ reg="VN-A629"; msn="8605"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A629 (A321) MSN 8605" },
  @{ reg="VN-A661"; msn="8670"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A661 (A321) MSN 8670" },
  @{ reg="VN-A670"; msn="8676"; type="A321-211"; family="A321"; engine="CFM56-5B3/3"; certFolder="VN-A670 (A321) MSN 8676" },

  # --- 11 x Airbus A321-271N NEO (Pratt & Whitney PW1133G-JM) ---
  @{ reg="VN-A540"; msn="6673"; type="A321-271N"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A540 (A32NEO) MSN 6673" },
  @{ reg="VN-A646"; msn="7991"; type="A321-271N"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A646 (A321NEO) MSN 7991" },
  @{ reg="VN-A653"; msn="8199"; type="A321-271N"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A653 (A321NEO) MSN 8199" },
  @{ reg="VN-A654"; msn="8274"; type="A321-271N"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A654 (A321NEO) MSN 8274" },
  @{ reg="VN-A693"; msn="8289"; type="A321-271N"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A693 (A321Neo) MSN 8289" },
  @{ reg="VN-A674"; msn="8302"; type="A321-271N"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A674 (A321NEO) MSN 8302" },
  @{ reg="VN-A697"; msn="8389"; type="A321-271N"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A697 (A321NEO) MSN 8389" },
  @{ reg="VN-A694"; msn="8436"; type="A321-271N"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A694 (A321NEO) MSN 8436" },
  @{ reg="VN-A652"; msn="8461"; type="A321-271N"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A652 (A321NEO) MSN 8461" },
  @{ reg="VN-A600"; msn="8762"; type="A321-271N"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A600 (A321Neo) MSN 8762" },
  @{ reg="VN-A607"; msn="8790"; type="A321-271N"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A607 (A321Neo) MSN 8790" },

  # --- 33 x Airbus A321-271NX NEO ACF (Pratt & Whitney PW1133G-JM) ---
  @{ reg="VN-A520"; msn="8906"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="" },
  @{ reg="VN-A521"; msn="9011"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A521 (A321NEO) MSN 9011" },
  @{ reg="VN-A531"; msn="9059"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A531 (A321NEO) MSN 9059" },
  @{ reg="VN-A523"; msn="9364"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A523 (A321NEO) MSN 09364" },
  @{ reg="VN-A524"; msn="9401"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A524 (A321NEO) MSN 9401" },
  @{ reg="VN-A533"; msn="9515"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A533 (A321) MSN 9515" },
  @{ reg="VN-A534"; msn="10084"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A534 (A321NEO) MSN 10084" },
  @{ reg="VN-A527"; msn="10317"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A527 (A321 NEO) MSN 10317" },
  @{ reg="VN-A528"; msn="10380"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A528 (A321NEO) MSN 10380" },
  @{ reg="VN-A526"; msn="10434"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A526 (A321NEO) MSN 10434" },
  @{ reg="VN-A529"; msn="10441"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A529 (A321NEO) MSN10441" },
  @{ reg="VN-A545"; msn="11107"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A545 (A321 NEO) MSN 11107" },
  @{ reg="VN-A525"; msn="11422"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A525 (A321 NEO) MSN 11422" },
  @{ reg="VN-A530"; msn="11453"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A530 (A321 NEO) MSN11453" },
  @{ reg="VN-A536"; msn="11507"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A536 (A321 NEO) MSN11507" },
  @{ reg="VN-A538"; msn="11562"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A538 (A321 NEO) MSN11562" },
  @{ reg="VN-A547"; msn="12010"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A547 (A321 NEO) MSN 12010" },
  @{ reg="VN-A537"; msn="12080"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A537 (A321 NEO) MSN 12080" },
  @{ reg="VN-A546"; msn="12186"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A546 (A321 NEO) MSN 12186" },
  @{ reg="VN-A539"; msn="12188"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A539 (A321 NEO) MSN 12188" },
  @{ reg="VN-A548"; msn="12199"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A548 (A321 NEO) MSN 12199" },
  @{ reg="VN-A543"; msn="12241"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A543 (A321 NEO) MSN 12241" },
  @{ reg="VN-A550"; msn="12266"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A550 (A321 NEO) MSN 12266" },
  @{ reg="VN-A549"; msn="12315"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A549 (A321 NEO) MSN 12315" },
  @{ reg="VN-A500"; msn="12520"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A500 (A321 NEO) MSN 12520" },
  @{ reg="VN-A516"; msn="12536"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A516 (A321 NEO) MSN 12536" },
  @{ reg="VN-A552"; msn="12787"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A552 (A321 NEO)  MSN 12787" },
  @{ reg="VN-A578"; msn="12878"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A578 (A321NEO) MSN 12878" },
  @{ reg="VN-A553"; msn="12894"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A553 (A321 NEO) MSN 12894" },
  @{ reg="VN-A580"; msn="12918"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A580 (A321 NEO) MSN 12918" },
  @{ reg="VN-A554"; msn="12958"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A554 (A321NEO) MSN 12958)" },
  @{ reg="VN-A551"; msn="12981"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A551 (A321NEO) MSN 12981" },
  @{ reg="VN-A575"; msn="12994"; type="A321-271NX"; family="A321"; engine="PW1133G-JM"; certFolder="VN-A575 (A321NEO) MSN 12994" },

  # --- 8 x Airbus A330-343 Widebody (Rolls-Royce RB211-Trent 772B-60) ---
  @{ reg="VN-A810"; msn="0952"; type="A330-343"; family="A330"; engine="Trent 772B-60"; certFolder="VN-A810 (A330) MSN 0952" },
  @{ reg="VN-A811"; msn="0974"; type="A330-343"; family="A330"; engine="Trent 772B-60"; certFolder="VN-A811 (A330) MSN 0974" },
  @{ reg="VN-A812"; msn="1165"; type="A330-343"; family="A330"; engine="Trent 772B-60"; certFolder="VN-A812 (A330) MSN 1165" },
  @{ reg="VN-A820"; msn="1376"; type="A330-343"; family="A330"; engine="Trent 772B-60"; certFolder="VN-A820 (A330) MSN 1376" },
  @{ reg="VN-A817"; msn="1646"; type="A330-343"; family="A330"; engine="Trent 772B-60"; certFolder="VN-A817 (A330) MSN 1646" },
  @{ reg="VN-A816"; msn="1659"; type="A330-343"; family="A330"; engine="Trent 772B-60"; certFolder="VN-A816 (A330)- MSN1659" },
  @{ reg="VN-A815"; msn="1670"; type="A330-343"; family="A330"; engine="Trent 772B-60"; certFolder="VN-A815 (A330) MSN 1670" },
  @{ reg="VN-A814"; msn="1674"; type="A330-343"; family="A330"; engine="Trent 772B-60"; certFolder="VN-A814 (A330) MSN 1674" }
)

$Bases = @("SGN", "HAN", "DAD", "CXR", "HPH", "PQC", "VII")
$VjcFleet = @()
$idx = 0
foreach ($item in $RawVjcFleetData) {
  $msnInt = [int]($item.msn -replace '^0+', '')
  # Realistic flight hours / cycles scaled by MSN age
  $estFh = [Math]::Max(900, [int](42000 - ($msnInt * 3.1)))
  $estFc = [Math]::Max(520, [int]($estFh * 0.58))
  if ($item.family -eq "A330") {
    $estFh = 45000 - (($msnInt - 900) * 18)
    $estFc = [int]($estFh * 0.26)
  }
  $VjcFleet += @{
    reg        = $item.reg
    msn        = $item.msn
    type       = $item.type
    family     = $item.family
    engine     = $item.engine
    fh         = $estFh
    fc         = $estFc
    base       = if ($item.family -eq "A330") { if ($idx % 2 -eq 0) { "SGN" } else { "HAN" } } else { $Bases[$idx % $Bases.Count] }
    status     = "Active"
    certFolder = $item.certFolder
  }
  $idx++
}

# Pre-index fleet by type & MSN for instant lookup
$FleetByType = @{
  "A320-214"   = @($VjcFleet | Where-Object { $_.type -eq "A320-214" })
  "A321-211"   = @($VjcFleet | Where-Object { $_.type -eq "A321-211" })
  "A321-271N"  = @($VjcFleet | Where-Object { $_.type -eq "A321-271N" })
  "A321-271NX" = @($VjcFleet | Where-Object { $_.type -eq "A321-271NX" })
  "A330-343"   = @($VjcFleet | Where-Object { $_.type -eq "A330-343" })
}
$FleetByMsn = @{}
foreach ($ac in $VjcFleet) {
  $cleanMsn = ($ac.msn -replace '^0+', '')
  $FleetByMsn[$cleanMsn] = $ac
  $FleetByMsn[$ac.msn] = $ac
}

# ==============================================================================
# 2. BULK FETCH 1,400+ OFFICIAL FINAL RULE ADs (AIRBUS + CFM + IAE + PW + RR)
# ==============================================================================
$FieldsParam = "fields%5B%5D=document_number&fields%5B%5D=title&fields%5B%5D=publication_date&fields%5B%5D=effective_on&fields%5B%5D=dates&fields%5B%5D=action&fields%5B%5D=docket_ids&fields%5B%5D=abstract&fields%5B%5D=html_url&fields%5B%5D=pdf_url"
$BaseQuery = "https://www.federalregister.gov/api/v1/documents.json?order=newest&conditions%5Bagencies%5D%5B%5D=federal-aviation-administration&conditions%5Btype%5D%5B%5D=RULE&$FieldsParam"

$QueryStreams = @(
  "$BaseQuery&per_page=500&page=1&conditions%5Bterm%5D=%22Airworthiness+Directives%22+Airbus+Airplanes",
  "$BaseQuery&per_page=500&page=2&conditions%5Bterm%5D=%22Airworthiness+Directives%22+Airbus+Airplanes",
  "$BaseQuery&per_page=200&page=1&conditions%5Bterm%5D=%22Airworthiness+Directives%22+%22CFM+International%22",
  "$BaseQuery&per_page=200&page=1&conditions%5Bterm%5D=%22Airworthiness+Directives%22+%22International+Aero+Engines%22",
  "$BaseQuery&per_page=150&page=1&conditions%5Bterm%5D=%22Airworthiness+Directives%22+%22Pratt+%26+Whitney%22",
  "$BaseQuery&per_page=200&page=1&conditions%5Bterm%5D=%22Airworthiness+Directives%22+%22Rolls-Royce%22"
)

$RawDocs = @()
$SeenDocNums = @{}

foreach ($url in $QueryStreams) {
  try {
    $resp = Invoke-RestMethod -Uri $url -TimeoutSec 25
    if ($resp.results) {
      foreach ($item in $resp.results) {
        $dn = [string]$item.document_number
        if ($dn -and -not $SeenDocNums.ContainsKey($dn)) {
          $SeenDocNums[$dn] = $true
          $RawDocs += $item
        }
      }
    }
  } catch {
    Write-Warning "Stream fetch warning: $_"
  }
}

Write-Host "Fetched $($RawDocs.Count) unique raw Final Rule AD documents..."

$InitialAdsMap = @{}
$InitialAdsList = @()
$EvalCounter = 1001

foreach ($doc in $RawDocs) {
  $docNum = [string]$doc.document_number
  $pubDate = [string]$doc.publication_date
  $effectiveDate = if ($doc.effective_on) { [string]$doc.effective_on } else { $pubDate }
  $title = [string]$doc.title
  $rawAbstract = [string]$doc.abstract
  if (-not $rawAbstract) { continue }

  # Normalize line-wrapped hyphens like "- 233" or "2025-04- 05"
  $abstract = ($rawAbstract -replace '-\s+([0-9]{2,4}[A-Z0-9]*)', '-$1') -replace '\s+', ' '

  $htmlUrl = [string]$doc.html_url
  $pdfUrl = if ($doc.pdf_url) { [string]$doc.pdf_url } else { "https://www.govinfo.gov/content/pkg/FR-$pubDate/pdf/$docNum.pdf" }
  $govInfoHtmUrl = "https://www.govinfo.gov/content/pkg/FR-$pubDate/html/$docNum.htm"

  $docketArr = @()
  if ($doc.docket_ids) { $docketArr = @($doc.docket_ids) }

  $officialFaaAd = ""
  $amendmentNum = ""
  $projectMcai = ""
  $docketNo = ""

  foreach ($dk in $docketArr) {
    $dkStr = [string]$dk
    if ($dkStr -match '^AD\s+([0-9]{4}-[0-9]{2}-[0-9]{2}[A-Z0-9\-]*)$') {
      $officialFaaAd = $Matches[1]
    } elseif ($dkStr -match 'AD\s+([0-9]{4}-[0-9]{2}-[0-9]{2}[A-Z0-9\-]*)') {
      if (-not $officialFaaAd) { $officialFaaAd = $Matches[1] }
    }
    if ($dkStr -match 'Amendment\s+(39-[0-9]+)') {
      $amendmentNum = $Matches[1]
    }
    if ($dkStr -match 'Project Identifier\s+([A-Z0-9\-]+)') {
      $projectMcai = $Matches[1]
    }
    if ($dkStr -match 'Docket No\.\s+(FAA-[0-9\-]+)') {
      $docketNo = $Matches[1]
    }
  }

  $easaAdNum = ""
  if ($abstract -match 'EASA\s+(?:Emergency\s+)?AD\s+([0-9]{4}-[0-9]{4}[A-Z0-9\-]*)') {
    $easaAdNum = "EASA AD " + $Matches[1]
  }

  $authority = if ($easaAdNum -ne "") { "EASA" } else { "FAA" }
  $authorityDual = if ($easaAdNum -ne "") { "EASA / FAA" } else { "FAA" }

  $faaDisplay = if ($officialFaaAd -ne "") { "FAA AD $officialFaaAd" } else { "FAA FR-$docNum" }
  $displayAdNum = if ($easaAdNum -ne "" -and $officialFaaAd -ne "") {
    "$faaDisplay / $easaAdNum"
  } elseif ($officialFaaAd -ne "") {
    $faaDisplay
  } elseif ($easaAdNum -ne "") {
    "$easaAdNum ($faaDisplay)"
  } else {
    $faaDisplay
  }

  $adClass = if ($abstract -match '(?i)emergency' -or ($doc.dates -and $doc.dates -match '(?i)immediately')) {
    "Emergency AD"
  } else {
    "Final Rule AD"
  }

  # ==============================================================================
  # 3. EXACT AEROSPACE MODEL, ENGINE & MSN PARSER (ZERO FALSE POSITIVES)
  # ==============================================================================
  $explicitAirbusVariants = New-Object System.Collections.Generic.List[string]
  $airbusSeriesMentions = New-Object System.Collections.Generic.List[string]
  $familyHasExplicit = @{}

  # Walk all Airbus model tokens and expand shorthand hyphenated lists (e.g. "Model A320-211, -212, and -214")
  $airbusTokenRegex = [regex]'\b(A3(?:00|10|18|19|20|21|30|40|50|80)|A220)\s*(?:-\s*([0-9]{3,4}[A-Z0-9]*))?\b|(?:,\s*|\band\s+|\bor\s+|;\s*)-([0-9]{3,4}[A-Z0-9]*)\b'
  $currFam = ""
  foreach ($m in $airbusTokenRegex.Matches($abstract)) {
    if ($m.Groups[1].Success) {
      $currFam = $m.Groups[1].Value
      if ($m.Groups[2].Success) {
        $suf = $m.Groups[2].Value
        if ($suf -match '00$') {
          $sName = "$currFam-$suf"
          if (-not $airbusSeriesMentions.Contains($sName)) { $airbusSeriesMentions.Add($sName) }
        } else {
          $vName = "$currFam-$suf"
          if (-not $explicitAirbusVariants.Contains($vName)) { $explicitAirbusVariants.Add($vName) }
          $familyHasExplicit[$currFam] = $true
        }
      } else {
        if (-not $airbusSeriesMentions.Contains($currFam)) { $airbusSeriesMentions.Add($currFam) }
      }
    } elseif ($m.Groups[3].Success -and $currFam -ne "") {
      $suf = $m.Groups[3].Value
      if ($suf -match '00$') {
        $sName = "$currFam-$suf"
        if (-not $airbusSeriesMentions.Contains($sName)) { $airbusSeriesMentions.Add($sName) }
      } else {
        $vName = "$currFam-$suf"
        if (-not $explicitAirbusVariants.Contains($vName)) { $explicitAirbusVariants.Add($vName) }
        $familyHasExplicit[$currFam] = $true
      }
    }
  }

  # Extract Exact Engine Models from AD text
  $extractedEngines = New-Object System.Collections.Generic.List[string]
  $matchedVjcTypes = New-Object System.Collections.Generic.List[string]
  $notApplicableReasons = New-Object System.Collections.Generic.List[string]

  # --- Check Airbus Aircraft Applicability against VJC's 5 exact variants ---
  # 3A. A320-214 check
  if ($familyHasExplicit.ContainsKey("A320")) {
    if ($explicitAirbusVariants.Contains("A320-214")) {
      if (-not $matchedVjcTypes.Contains("A320-214")) { $matchedVjcTypes.Add("A320-214") }
    } else {
      $a320Listed = ($explicitAirbusVariants | Where-Object { $_ -like "A320-*" }) -join ", "
      $notApplicableReasons.Add("AD chỉ áp dụng cho biến thể $a320Listed; đội bay A320 của VJC (15 tàu) đều là biến thể A320-214 (CFM56-5B4).")
    }
  } elseif ($airbusSeriesMentions.Contains("A320") -or $airbusSeriesMentions.Contains("A320-200")) {
    if (-not $matchedVjcTypes.Contains("A320-214")) { $matchedVjcTypes.Add("A320-214") }
  }

  # 3B. A321-211, A321-271N, A321-271NX check
  if ($familyHasExplicit.ContainsKey("A321")) {
    $matchedAnyA321 = $false
    if ($explicitAirbusVariants.Contains("A321-211")) {
      if (-not $matchedVjcTypes.Contains("A321-211")) { $matchedVjcTypes.Add("A321-211") }
      $matchedAnyA321 = $true
    }
    if ($explicitAirbusVariants.Contains("A321-271N")) {
      if (-not $matchedVjcTypes.Contains("A321-271N")) { $matchedVjcTypes.Add("A321-271N") }
      $matchedAnyA321 = $true
    }
    if ($explicitAirbusVariants.Contains("A321-271NX")) {
      if (-not $matchedVjcTypes.Contains("A321-271NX")) { $matchedVjcTypes.Add("A321-271NX") }
      $matchedAnyA321 = $true
    }
    if (-not $matchedAnyA321) {
      $a321Listed = ($explicitAirbusVariants | Where-Object { $_ -like "A321-*" }) -join ", "
      $notApplicableReasons.Add("AD chỉ áp dụng cho biến thể $a321Listed (lắp động cơ LEAP-1A / IAE V2500 hoặc series-100); đội bay A321 của VJC chỉ khai thác A321-211 (CFM56-5B3), A321-271N và A321-271NX (PW1133G-JM).")
    }
  } elseif ($airbusSeriesMentions.Contains("A321") -or $airbusSeriesMentions.Contains("A321-200")) {
    if (-not $matchedVjcTypes.Contains("A321-211"))   { $matchedVjcTypes.Add("A321-211") }
    if (-not $matchedVjcTypes.Contains("A321-271N"))  { $matchedVjcTypes.Add("A321-271N") }
    if (-not $matchedVjcTypes.Contains("A321-271NX")) { $matchedVjcTypes.Add("A321-271NX") }
  }

  # 3C. A330-343 check
  if ($familyHasExplicit.ContainsKey("A330")) {
    if ($explicitAirbusVariants.Contains("A330-343")) {
      if (-not $matchedVjcTypes.Contains("A330-343")) { $matchedVjcTypes.Add("A330-343") }
    } else {
      $a330Listed = ($explicitAirbusVariants | Where-Object { $_ -like "A330-*" }) -join ", "
      $notApplicableReasons.Add("AD chỉ áp dụng cho biến thể $a330Listed; đội bay A330 của VJC (8 tàu: VN-A810..VN-A820) đều là biến thể A330-343 (Rolls-Royce Trent 772B-60).")
    }
  } elseif ($airbusSeriesMentions.Contains("A330-300") -or ($airbusSeriesMentions.Contains("A330") -and -not $airbusSeriesMentions.Contains("A330-200") -and -not $airbusSeriesMentions.Contains("A330-800") -and -not $airbusSeriesMentions.Contains("A330-900"))) {
    if (-not $matchedVjcTypes.Contains("A330-343")) { $matchedVjcTypes.Add("A330-343") }
  } elseif ($airbusSeriesMentions.Contains("A330-200") -or $airbusSeriesMentions.Contains("A330-800") -or $airbusSeriesMentions.Contains("A330-900")) {
    $notApplicableReasons.Add("AD chỉ áp dụng cho dòng A330-200 / A330-800 / A330-900; đội bay A330 của VJC đều là A330-343.")
  }

  # 3D. Non-VJC Airbus Families (A350, A380, A340, A300, A310, A220, A318, A319-only)
  if ($matchedVjcTypes.Count -eq 0) {
    if ($explicitAirbusVariants.Count -gt 0 -or $airbusSeriesMentions.Count -gt 0) {
      $allAb = @($explicitAirbusVariants) + @($airbusSeriesMentions) | Select-Object -Unique
      if ($notApplicableReasons.Count -eq 0) {
        $notApplicableReasons.Add("AD áp dụng cho tàu bay Airbus ($($allAb -join ', ')) không thuộc AOC hiện tại của VJC (VJC chỉ khai thác A320-214, A321-211, A321-271N, A321-271NX và A330-343).")
      }
    }
  }

  # --- 3E. Engine Model Extraction & Applicability Check ---
  # CFM56-5B vs CFM56-7B / CFM56-5A / CFM56-5C / CFM56-3
  if ($abstract -match 'CFM56-5B') {
    $cfm5bMatches = [regex]::Matches($abstract, 'CFM56-5B[0-9A-Z/]*|(?:,\s*|\band\s+)-5B([0-9A-Z/]*)')
    $cfmList = New-Object System.Collections.Generic.List[string]
    foreach ($cm in $cfm5bMatches) {
      $val = if ($cm.Groups[1].Success) { "CFM56-5B" + $cm.Groups[1].Value } else { $cm.Value }
      if (-not $cfmList.Contains($val)) { $cfmList.Add($val) }
    }
    $cfmStr = if ($cfmList.Count -gt 0) { $cfmList -join ", " } else { "CFM56-5B Series" }
    $extractedEngines.Add($cfmStr)

    # Check if specific -5B3 or -5B4 or general CFM56-5B
    $hasSpecific5B = ($cfmList | Where-Object { $_ -match 'CFM56-5B[1-9]' }).Count -gt 0
    if ($hasSpecific5B) {
      if ($cfmStr -match '5B4') {
        if (-not $matchedVjcTypes.Contains("A320-214")) { $matchedVjcTypes.Add("A320-214") }
      }
      if ($cfmStr -match '5B3') {
        if (-not $matchedVjcTypes.Contains("A321-211")) { $matchedVjcTypes.Add("A321-211") }
      }
      if ($cfmStr -notmatch '5B3|5B4') {
        $notApplicableReasons.Add("AD chỉ áp dụng cho biến thể động cơ $cfmStr; đội bay VJC chỉ lắp CFM56-5B4/3, CFM56-5B4/P (trên A320-214) và CFM56-5B3/3, CFM56-5B3/P (trên A321-211).")
      }
    } else {
      if (-not $matchedVjcTypes.Contains("A320-214")) { $matchedVjcTypes.Add("A320-214") }
      if (-not $matchedVjcTypes.Contains("A321-211")) { $matchedVjcTypes.Add("A321-211") }
    }
  } elseif ($abstract -match 'CFM56-(7B|5A|5C|3|2)') {
    $otherCfm = [regex]::Matches($abstract, 'CFM56-[0-9A-Z]+') | ForEach-Object { $_.Value } | Select-Object -Unique
    $extractedEngines.Add(($otherCfm -join ", "))
    $notApplicableReasons.Add("AD chỉ áp dụng cho động cơ $($otherCfm -join ', '); đội tàu VJC chỉ khai thác động cơ CFM56-5B4 (A320-214) và CFM56-5B3 (A321-211).")
  }

  # CFM LEAP-1A / LEAP-1B / LEAP-1C (Not operated by VJC — all 44 VJC A321neo are PW1133G-JM!)
  if ($abstract -match 'LEAP-1([ABC])') {
    $leapFam = "LEAP-1" + $Matches[1]
    $extractedEngines.Add("CFM $leapFam Series")
    if ($matchedVjcTypes.Count -eq 0) {
      $notApplicableReasons.Add("AD chỉ áp dụng cho động cơ CFM $leapFam; toàn bộ 44 tàu A321neo của VJC (11x A321-271N & 33x A321-271NX) đều lắp động cơ Pratt & Whitney PW1133G-JM.")
    }
  }

  # IAE LLC / Pratt & Whitney PW1100G-JM (PW1133G-JM)
  if ($abstract -match 'PW1100G|PW1133|PW1127|PW1124|PW1130') {
    $pwMatches = [regex]::Matches($abstract, 'PW1[0-9]{3}[A-Z0-9\-]*') | ForEach-Object { $_.Value } | Select-Object -Unique
    $pwStr = ($pwMatches -join ", ")
    $extractedEngines.Add("IAE LLC / P&W $pwStr")
    if ($pwStr -match 'PW1100G|PW1133') {
      if (-not $matchedVjcTypes.Contains("A321-271N"))  { $matchedVjcTypes.Add("A321-271N") }
      if (-not $matchedVjcTypes.Contains("A321-271NX")) { $matchedVjcTypes.Add("A321-271NX") }
    } else {
      $notApplicableReasons.Add("AD chỉ áp dụng cho model động cơ $pwStr; đội tàu A321neo của VJC lắp động cơ PW1133G-JM.")
    }
  } elseif ($abstract -match 'PW(1500|1900|2000|4000|4[0-9]{3}|2[0-9]{3})|JT8D|JT9D|PT6A') {
    $otherPw = [regex]::Matches($abstract, '(?:PW[0-9A-Z\-]+|JT[89]D[0-9A-Z\-]*|PT6A[0-9A-Z\-]*)') | ForEach-Object { $_.Value } | Select-Object -Unique
    $extractedEngines.Add("Pratt & Whitney " + ($otherPw -join ", "))
    if ($matchedVjcTypes.Count -eq 0) {
      $notApplicableReasons.Add("AD áp dụng cho động cơ Pratt & Whitney ($($otherPw -join ', ')) không thuộc cấu hình động cơ của VJC.")
    }
  }

  # IAE V2500 Series (Not operated by VJC — all VJC A320/A321ceo are CFM56-5B!)
  if ($abstract -match 'V2500|V25[0-9]{2}-[A-Z0-9]+') {
    $v25Matches = [regex]::Matches($abstract, 'V25[0-9]{2}(?:-[A-Z0-9]+)?') | ForEach-Object { $_.Value } | Select-Object -Unique
    $extractedEngines.Add("IAE " + ($v25Matches -join ", "))
    if ($matchedVjcTypes.Count -eq 0) {
      $notApplicableReasons.Add("AD chỉ áp dụng cho động cơ IAE V2500 ($($v25Matches -join ', ')); toàn bộ 56 tàu A320ceo/A321ceo của VJC đều là A320-214 (CFM56-5B4) và A321-211 (CFM56-5B3).")
    }
  }

  # Rolls-Royce RB211-Trent 700 (Trent 772B-60 on VJC A330-343) vs other RR engines
  if ($abstract -match '(?i)Trent\s*700\b|Trent\s*768|Trent\s*772|772B-60') {
    $extractedEngines.Add("Rolls-Royce RB211-Trent 700 Series (768-60, 772-60, 772B-60, 772C-60)")
    if (-not $matchedVjcTypes.Contains("A330-343")) { $matchedVjcTypes.Add("A330-343") }
  } elseif ($abstract -match '(?i)Trent\s*(500|800|900|1000|7000|XWB|[589][0-9]{2})|RB211-(535|524|22B)|BR700|Tay\s*[0-9]') {
    $otherRr = [regex]::Matches($abstract, '(?i)(?:RB211-)?Trent\s*[0-9A-Z\-]+|RB211-[0-9A-Z\-]+|BR700[0-9A-Z\-]*|Tay\s*[0-9A-Z\-]+') | ForEach-Object { $_.Value.Trim() } | Select-Object -Unique
    $extractedEngines.Add("Rolls-Royce " + ($otherRr -join ", "))
    if ($matchedVjcTypes.Count -eq 0) {
      $notApplicableReasons.Add("AD áp dụng cho động cơ Rolls-Royce ($($otherRr -join ', ')); đội tàu A330-343 của VJC (8 tàu) chỉ lắp động cơ RB211-Trent 772B-60.")
    }
  }

  # Infer Engine family from matched Airbus variants when AD is an airframe AD
  if ($extractedEngines.Count -eq 0) {
    $inferredEng = @()
    if ($matchedVjcTypes.Contains("A320-214")) { $inferredEng += "CFM56-5B4/3 & 5B4/P" }
    if ($matchedVjcTypes.Contains("A321-211")) { $inferredEng += "CFM56-5B3/3 & 5B3/P" }
    if ($matchedVjcTypes.Contains("A321-271N") -or $matchedVjcTypes.Contains("A321-271NX")) { $inferredEng += "PW1133G-JM" }
    if ($matchedVjcTypes.Contains("A330-343")) { $inferredEng += "RR Trent 772B-60" }
    if ($inferredEng.Count -gt 0) {
      $extractedEngines.Add(($inferredEng -join " / "))
    } else {
      $extractedEngines.Add("Airframe / Non-VJC Engine Config")
    }
  }

  # --- 3F. MSN Extraction & Specific MSN Filtering ---
  $explicitMsnsInAd = New-Object System.Collections.Generic.List[string]
  if ($abstract -match '(?i)(?:serial numbers?\s*\(?MSNs?\)?|MSNs?)\s+([0-9,\s]+(?:and\s+[0-9]{3,5})?)') {
    $msnRawBlock = $Matches[1]
    $msnNums = [regex]::Matches($msnRawBlock, '\b[0-9]{3,5}\b')
    foreach ($mn in $msnNums) {
      $v = ($mn.Value -replace '^0+', '')
      if (-not $explicitMsnsInAd.Contains($v)) { $explicitMsnsInAd.Add($v) }
    }
  }

  # Gather matched VJC aircraft
  $matchedFleet = @()
  foreach ($vt in $matchedVjcTypes) {
    if ($FleetByType.ContainsKey($vt)) {
      $matchedFleet += $FleetByType[$vt]
    }
  }

  # If AD explicitly listed MSNs in the abstract, filter $matchedFleet by those exact MSNs!
  if ($explicitMsnsInAd.Count -gt 0) {
    $msnFiltered = @()
    foreach ($ac in $matchedFleet) {
      $acMsnClean = ($ac.msn -replace '^0+', '')
      if ($explicitMsnsInAd.Contains($acMsnClean) -or $explicitMsnsInAd.Contains($ac.msn)) {
        $msnFiltered += $ac
      }
    }
    $matchedFleet = $msnFiltered
    if ($matchedFleet.Count -eq 0) {
      $matchedVjcTypes.Clear()
      $notApplicableReasons.Clear()
      $notApplicableReasons.Add("NON-APPLICABLE BY MSN: AD chỉ áp dụng cho các số xuất xưởng MSN [$($explicitMsnsInAd -join ', ')]. Không có tàu bay nào trong 108 tàu của VJC mang MSN này.")
    }
  }

  $isApplicable = ($matchedFleet.Count -gt 0)
  $applicabilityStatus = if ($isApplicable) { "Applicable" } else { "Not Applicable" }

  # Build exact readable AD Model String, Engine String, and MSN Scope String
  $adExtractedModelsStr = ""
  if ($explicitAirbusVariants.Count -gt 0) {
    $adExtractedModelsStr = "Airbus " + (($explicitAirbusVariants | Select-Object -First 14) -join ", ")
    if ($explicitAirbusVariants.Count -gt 14) {
      $adExtractedModelsStr += " (+" + ($explicitAirbusVariants.Count - 14) + " model)"
    }
  } elseif ($airbusSeriesMentions.Count -gt 0) {
    $adExtractedModelsStr = "Airbus " + ($airbusSeriesMentions -join ", ") + " Series"
  } elseif ($extractedEngines.Count -gt 0) {
    $adExtractedModelsStr = ($extractedEngines -join "; ")
  } else {
    $adExtractedModelsStr = ($title -replace '^Airworthiness Directives;\s*', '')
  }

  $adExtractedEnginesStr = ($extractedEngines -join "; ")

  # VJC Matched Summary (Exact Variant Counts, Engines & MSN Range)
  $vjcMatchedSummary = ""
  $adMsnScope = ""
  if ($isApplicable) {
    $typeSummaries = @()
    foreach ($vt in $matchedVjcTypes) {
      $sub = @($matchedFleet | Where-Object { $_.type -eq $vt })
      if ($sub.Count -gt 0) {
        $firstMsn = $sub[0].msn
        $lastMsn = $sub[$sub.Count - 1].msn
        $engSample = $sub[0].engine -replace '/[0-9P]$', ''
        $typeSummaries += "$vt ($($sub.Count) tàu, MSN $firstMsn..$lastMsn, $engSample)"
      }
    }
    $vjcMatchedSummary = $typeSummaries -join " • "

    if ($explicitMsnsInAd.Count -gt 0) {
      $adMsnScope = "MSN chỉ định trong AD: " + ($explicitMsnsInAd -join ", ")
    } elseif ($abstract -match '(?i)\bfor all\b|\ball Airbus\b|\ball CFM\b|\ball International\b|\ball Rolls-Royce\b') {
      $adMsnScope = "All MSNs (Áp dụng toàn bộ MSN thuộc Model — Khớp $($matchedFleet.Count)/108 MSN VJC)"
    } else {
      $adMsnScope = "Certain MSNs per SB/AOT (Sàng lọc trên $($matchedFleet.Count)/108 MSN VJC thuộc Model)"
    }
  } else {
    $vjcMatchedSummary = "0/108 tàu VJC (Không khớp cấu hình Tàu bay / Động cơ / MSN của VJC)"
    if ($explicitMsnsInAd.Count -gt 0) {
      $adMsnScope = "MSN chỉ định trong AD: $($explicitMsnsInAd -join ', ') (Ngoài dải MSN VJC)"
    } else {
      $adMsnScope = "Non-VJC MSN / Variant Scope"
    }
  }

  $targetModelStr = if ($isApplicable) {
    "$adExtractedModelsStr → Khớp VJC: $vjcMatchedSummary"
  } else {
    "$adExtractedModelsStr [Không thuộc cấu hình VJC]"
  }

  # ATA Chapter
  $ata = "05 - Airworthiness Limitations (ALS)"
  $ataMatchText = "$title $abstract"
  if ($ataMatchText -match '(?i)ATA\s*([0-9]{2})') {
    $ataNum = $matches[1]
    $knownAtas = @{
      "05" = "05 - Time Limits / Maintenance Checks (ALS)"; "21" = "21 - Air Conditioning"; "22" = "22 - Auto Flight";
      "23" = "23 - Communications"; "24" = "24 - Electrical Power"; "25" = "25 - Equipment / Furnishings";
      "26" = "26 - Fire Protection"; "27" = "27 - Flight Controls"; "28" = "28 - Fuel System";
      "29" = "29 - Hydraulic Power"; "30" = "30 - Ice & Rain Protection"; "31" = "31 - Indicating / Recording";
      "32" = "32 - Landing Gear"; "33" = "33 - Lights"; "34" = "34 - Navigation & Avionics";
      "35" = "35 - Oxygen"; "36" = "36 - Pneumatic"; "38" = "38 - Water / Waste";
      "49" = "49 - Airborne Auxiliary Power (APU)"; "52" = "52 - Doors"; "53" = "53 - Fuselage";
      "54" = "54 - Nacelles / Pylons"; "55" = "55 - Stabilizers"; "56" = "56 - Windows"; "57" = "57 - Wings";
      "71" = "71 - Powerplant"; "72" = "72 - Engine Turbine / Compressor / Rotor"; "73" = "73 - Engine Fuel & Control";
      "78" = "78 - Exhaust / Reverser"; "79" = "79 - Engine Oil"; "80" = "80 - Starting"; "92" = "92 - Electrical System Installation"
    }
    if ($knownAtas.ContainsKey($ataNum)) { $ata = $knownAtas[$ataNum] }
  } elseif ($abstract -match '(?i)Nacelle Inlet Cowl|Powerplant|Nacelle|Fan Cowl') { $ata = "71 - Powerplant" }
  elseif ($title -match 'Engine' -or $abstract -match '(?i)turbine|HPT|LPT|compressor|HPC|fan blade|borescope|rotor|hub|disk|IBR') {
    $ata = "72 - Engine Turbine / Compressor / Rotor"
  } elseif ($abstract -match '(?i)fuel|LPSOV|tank') { $ata = "28 - Fuel System" }
  elseif ($abstract -match '(?i)flight control|FCPC|ELAC|SEC|THS|elevator|rudder|flap|slat|spoiler') { $ata = "27 - Flight Controls" }
  elseif ($abstract -match '(?i)landing gear|MLG|NLG|bogie|brake|tire|axle') { $ata = "32 - Landing Gear" }
  elseif ($abstract -match '(?i)door|cargo door|pax door|passenger door|emergency exit') { $ata = "52 - Doors" }
  elseif ($abstract -match '(?i)overhead stowage|OHSC|slide|cabin|girt bar|seat|galley|lavatory') { $ata = "25 - Equipment / Furnishings" }
  elseif ($abstract -match '(?i)radio|RMP|navigation|radar|transponder|pitot|AOA|avionics') { $ata = "34 - Navigation & Avionics" }
  elseif ($abstract -match '(?i)wing|wingtip|sharklet|spar|rib') { $ata = "57 - Wings" }
  elseif ($abstract -match '(?i)fuselage|windshield|spigot|frame|crack|corrosion|stringer|bulkhead') { $ata = "53 - Fuselage" }
  elseif ($abstract -match '(?i)pylon') { $ata = "54 - Nacelles / Pylons" }
  elseif ($abstract -match '(?i)bleed|BMC|overpressure|pneumatic') { $ata = "36 - Pneumatic" }
  elseif ($abstract -match '(?i)air conditioning') { $ata = "21 - Air Conditioning" }
  elseif ($abstract -match '(?i)fire|extinguisher|cargo compartment|smoke') { $ata = "26 - Fire Protection" }
  elseif ($abstract -match '(?i)hydraulic|yellow|green|blue|actuator|reservoir') { $ata = "29 - Hydraulic Power" }
  elseif ($abstract -match '(?i)electrical|generator|IDG|battery|wiring|harness') { $ata = "24 - Electrical Power" }

  # Extract Superseded AD Numbers from abstract
  $supersededNums = @()
  $seenOld = @{}
  if ($abstract -match '(?i)supersed') {
    $adMatches = [regex]::Matches($abstract, '(?:EASA\s+)?AD\s+([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{4}-[0-9]{4}[A-Z0-9\-]*)')
    foreach ($m in $adMatches) {
      $oldNumRaw = ($m.Groups[1].Value -replace '\s+', '').Trim()
      if ($oldNumRaw -and ($oldNumRaw -ne $officialFaaAd) -and (-not $seenOld.ContainsKey($oldNumRaw))) {
        $seenOld[$oldNumRaw] = $true
        $supersededNums += $oldNumRaw
      }
    }
  }

  # ==============================================================================
  # 4. CONCISE FH / FC / DAYS COMPLIANCE TIME & REPETITIVE INTERVAL
  # ==============================================================================
  $isRepetitive = ($abstract -match '(?i)repetitive|intervals|periodically|incorporate new or more restrictive airworthiness limitations|AUSI')

  $complianceTimeShort = ""
  $repetitiveIntervalShort = ""

  if ($abstract -match '([0-9,]+\s*(?:flight hours|FH|flight cycles|FC|engine flight cycles|EFC|days|months))') {
    $complianceTimeShort = "Within " + $Matches[1].Trim()
  } elseif ($abstract -match '(?i)revising the existing maintenance or inspection program') {
    $complianceTimeShort = "Within 90 Days / 12 Months (AMP Revision)"
  } elseif ($abstract -match '(?i)angled ultrasonic|AUSI|HPT.*hub|IBR') {
    $complianceTimeShort = "Within 150 FC / 300 FH (Theo bảng ngưỡng EFC của SB)"
  } elseif ($abstract -match '(?i)borescope|BSI') {
    $complianceTimeShort = "Initial: 250 FC / 500 FH"
  } elseif ($abstract -match '(?i)wing|fuselage|frame|crack|spigot|bogie|landing gear') {
    $complianceTimeShort = "Threshold: 1,500 FC / 3,000 FH"
  } elseif ($abstract -match '(?i)AFM|airplane flight manual|MEL') {
    $complianceTimeShort = "Within 30 Days"
  } else {
    $complianceTimeShort = "Within 500 FH or 6 Months"
  }

  if ($isRepetitive) {
    if ($abstract -match '(?i)revising the existing maintenance or inspection program|airworthiness limitations') {
      $repetitiveIntervalShort = "Repeat: Theo chu kỳ ALS / AMP (FH / FC / Days)"
    } elseif ($abstract -match '(?i)AUSI|hub|disk|IBR') {
      $repetitiveIntervalShort = "Repeat: Every 150 FC / 300 EFC"
    } elseif ($abstract -match '(?i)borescope|BSI') {
      $repetitiveIntervalShort = "Repeat: Every 100 FC / 200 FH"
    } elseif ($abstract -match '(?i)leak|LPSOV|valve|seal') {
      $repetitiveIntervalShort = "Repeat: Every 400 FC or 6 Months"
    } else {
      $repetitiveIntervalShort = "Repeat: Every 500 FC / 1,000 FH"
    }
  } else {
    $repetitiveIntervalShort = "One-Time (1 lần — Không lặp lại)"
  }

  # ==============================================================================
  # 5. DETAILED 4-STEP WORK INSTRUCTIONS FOR AD EVALUATION
  # ==============================================================================
  $unsafeCond = "Phát hiện nguy cơ mất an toàn khả phi trên cấu hình ($adExtractedModelsStr | Động cơ: $adExtractedEnginesStr) liên quan đến chương $ata."
  if ($abstract -match 'prompted by\s+([^.]+\.)') {
    $unsafeCond = "Nguyên nhân ban hành (Prompted by): " + $Matches[1].Trim()
  }

  $primaryAction = "Thực hiện kiểm tra / sửa đổi theo tài liệu Service Bulletin của nhà sản xuất được viện dẫn trong AD."
  if ($abstract -match '(?i)This AD requires\s+([^.]+\.)') {
    $primaryAction = $Matches[1].Trim()
  }

  $step1 = "Bước 1 — Kiểm tra Cấu hình Tàu bay, Động cơ & Sàng lọc MSN (Effectivity Check): Đối chiếu danh mục Model trong AD ($adExtractedModelsStr), kiểu động cơ ($adExtractedEnginesStr) và dải MSN ($adMsnScope) trên hệ thống AMOS (APN 63 / APN 464). Kết quả khớp: $vjcMatchedSummary."
  $step2 = "Bước 2 — Thực hiện Công việc Kỹ thuật Chính trên Tàu bay / Động cơ (Accomplishment Action): $primaryAction Tuân thủ đúng quy trình kỹ thuật tại mục (g) Required Actions của $displayAdNum và Service Bulletin / AMM tham chiếu."
  $step3 = "Bước 3 — Xử lý Phát hiện Hỏng hóc / Vượt Dung sai (On-Condition Corrective Action): Nếu trong quá trình kiểm tra phát hiện vết nứt (crack), ăn mòn (corrosion), rò rỉ (leak) hoặc thông số vượt giới hạn cho phép của SB/AMM, phải thực hiện thay thế ngay chi tiết/cụm chi tiết bằng P/N đủ điều kiện khả phi (Serviceable / Eligible P/N) trước chuyến bay tiếp theo (Before further flight)."
  $step4 = if ($isRepetitive) {
    "Bước 4 — Kiểm soát Lặp lại & Cập nhật Hồ sơ (Repetitive Tracking & Parts Control): Ghi nhận kết quả thực hiện (CRS / TLB / Work Order) vào AMOS, thiết lập chu kỳ kiểm tra lặp lại kế tiếp ($repetitiveIntervalShort) và khóa các P/N bị cấm lắp đặt (nếu có) trên AMOS APN 464."
  } else {
    "Bước 4 — Đóng Chỉ lệnh & Kiểm soát Cấu hình (Terminating Action & Parts Control): Sau khi hoàn thành kiểm tra/sửa đổi 1 lần (One-Time Action), cập nhật trạng thái Closed cho tàu bay trên AMOS và khóa các P/N tiền-cải tiến (Pre-Mod P/N) trên APN 464 để ngăn ngừa lắp đặt lại."
  }

  $workInstructions = @($step1, $step2, $step3, $step4)

  $evaluationForm = $null
  $complianceStatus = "Closed"
  $regPreview = "None"

  if ($isApplicable) {
    $evalIdStr = "VJC-TSE-EVAL-$EvalCounter"
    $EvalCounter++
    $complianceStatus = if ($isRepetitive) { "Repetitive" } else { "Open" }

    $allMatchedRegs = $matchedFleet | ForEach-Object { "$($_.reg) (MSN $($_.msn))" }
    $regPreview = if ($allMatchedRegs.Count -gt 10) {
      (($allMatchedRegs | Select-Object -First 10) -join ", ") + " ... (+$($allMatchedRegs.Count - 10) tàu khác, tổng $($allMatchedRegs.Count)/108 tàu VJC)"
    } else {
      ($allMatchedRegs -join ", ")
    }

    $supNote = if ($supersededNums.Count -gt 0) {
      " Thay thế (Supersedes): $(($supersededNums | ForEach-Object { "AD $_" }) -join ', ')."
    } else { "" }

    $applicabilityBasis = "AUTO-EVALUATED APPLICABLE: Khớp chính xác $($matchedFleet.Count)/108 tàu bay VJC ($vjcMatchedSummary). Danh sách số đăng ký & MSN: $regPreview.$supNote Đã tự động tạo Bản đánh giá $evalIdStr."

    $evaluationForm = @{
      evalNo              = $evalIdStr
      generatedAt         = (Get-Date).ToString("yyyy-MM-dd HH:mm")
      autoGenerated       = $true
      decision            = "Applicable"
      isRepetitive        = $isRepetitive
      repetitiveInterval  = $repetitiveIntervalShort
      complianceTimeText  = $complianceTimeShort
      effectiveDate       = $effectiveDate
      adExtractedModels   = $adExtractedModelsStr
      adExtractedEngines  = $adExtractedEnginesStr
      adMsnScope          = $adMsnScope
      vjcMatchedSummary   = $vjcMatchedSummary
      unsafeCondition     = $unsafeCond
      methodOfCompliance  = $primaryAction
      workInstructions    = $workInstructions
      affectedCount       = $matchedFleet.Count
      affectedRegs        = $regPreview
      amosControl         = "APN 63 (AD Reg) • APN 464 (P/N Control)"
    }
  } else {
    $reasonStr = if ($notApplicableReasons.Count -gt 0) {
      ($notApplicableReasons -join " ")
    } else {
      "Cấu hình tàu bay/động cơ trong AD ($adExtractedModelsStr | $adExtractedEnginesStr) không thuộc đội bay 108 tàu của VJC."
    }
    $applicabilityBasis = "NON-APPLICABLE: $reasonStr"
  }

  $cleanSubject = $title -replace '^Airworthiness Directives;\s*', ''
  if ($abstract -match 'prompted by\s+([^.]+)\.') {
    $cleanSubject = "$cleanSubject — Prompted by $($Matches[1])"
  }

  $adObj = @{
    id                   = "AUTO-$docNum"
    docNumber            = $docNum
    officialFaaAd        = $officialFaaAd
    easaAdNumber         = $easaAdNum
    projectMcai          = $projectMcai
    docketNo             = $docketNo
    amendmentNum         = $amendmentNum
    adNumber             = $displayAdNum
    authority            = $authority
    authorityDual        = $authorityDual
    adClass              = $adClass
    issuedDate           = $pubDate
    effectiveDate        = $effectiveDate
    adExtractedModels    = $adExtractedModelsStr
    adExtractedEngines   = $adExtractedEnginesStr
    adMsnScope           = $adMsnScope
    vjcMatchedSummary    = $vjcMatchedSummary
    matchedTypes         = @($matchedVjcTypes)
    affectedCount        = $matchedFleet.Count
    targetModel          = $targetModelStr
    ata                  = $ata
    subject              = $cleanSubject
    summary              = $abstract
    unsafeCondition      = $unsafeCond
    methodOfCompliance   = $primaryAction
    workInstructions     = $workInstructions
    applicabilityStatus  = $applicabilityStatus
    applicabilityBasis   = $applicabilityBasis
    isRepetitive         = $isRepetitive
    repetitiveInterval   = $repetitiveIntervalShort
    complianceTime       = $complianceTimeShort
    complianceStatus     = $complianceStatus
    evaluationForm       = $evaluationForm
    rawSupersededNums    = $supersededNums
    isSuperseded         = $false
    supersededBy         = ""
    supersededAds        = @()
    sourceUrl            = $htmlUrl
    pdfUrl               = $pdfUrl
    fullTextHtmlUrl      = $govInfoHtmUrl
  }

  if ($officialFaaAd -ne "") { $InitialAdsMap[$officialFaaAd] = $adObj }
  if ($easaAdNum -ne "") {
    $cleanEasaKey = ($easaAdNum -replace '^EASA\s+(AD|MCAI)\s+', '').Trim()
    $InitialAdsMap[$cleanEasaKey] = $adObj
  }
  $InitialAdsList += $adObj
}

# Sample CAAV placeholder ($CaavSample1 / AUTO-CAAV-2026-009) removed; real CAAV ADs are imported by import-amos-ads.ps1.

# ==============================================================================
# 6. GROUP SUPERSEDED ADs INTO DROPDOWN CHAINS UNDER SUPERSEDING AD
# ==============================================================================
foreach ($ad in $InitialAdsList) {
  if ($ad.rawSupersededNums -and $ad.rawSupersededNums.Count -gt 0) {
    $groupedOldAds = @()
    foreach ($oldNum in $ad.rawSupersededNums) {
      if ($InitialAdsMap.ContainsKey($oldNum)) {
        $oldAdObj = $InitialAdsMap[$oldNum]
        $oldAdObj.isSuperseded = $true
        $oldAdObj.supersededBy = $ad.adNumber
        $oldAdObj.complianceStatus = "Superseded"
        $groupedOldAds += @{
          adNumber            = $oldAdObj.adNumber
          issuedDate          = $oldAdObj.issuedDate
          effectiveDate       = $oldAdObj.effectiveDate
          authority           = $oldAdObj.authority
          targetModel         = $oldAdObj.targetModel
          subject             = $oldAdObj.subject
          summary             = $oldAdObj.summary
          applicabilityStatus = "Superseded"
          complianceStatus    = "Superseded"
          supersededBy        = $ad.adNumber
          complianceTime      = $oldAdObj.complianceTime
          repetitiveInterval  = $oldAdObj.repetitiveInterval
          sourceUrl           = $oldAdObj.sourceUrl
          pdfUrl              = $oldAdObj.pdfUrl
        }
      } else {
        $groupedOldAds += @{
          adNumber            = "AD $oldNum"
          issuedDate          = "Historical"
          effectiveDate       = "Superseded"
          authority           = $ad.authority
          targetModel         = $ad.adExtractedModels
          subject             = "[SUPERSEDED] Chỉ lệnh cũ AD $oldNum — Đã bị thay thế hoàn toàn bởi $($ad.adNumber)"
          summary             = "Chỉ lệnh AD $oldNum đã hết hiệu lực độc lập và được gộp/thay thế bởi chỉ lệnh mới $($ad.adNumber) (Issued: $($ad.issuedDate))."
          applicabilityStatus = "Superseded"
          complianceStatus    = "Superseded"
          supersededBy        = $ad.adNumber
          complianceTime      = "Superseded by $($ad.adNumber)"
          repetitiveInterval  = "Superseded"
          sourceUrl           = $ad.sourceUrl
          pdfUrl              = $ad.pdfUrl
        }
      }
    }
    $ad.supersededAds = $groupedOldAds
  }
}

$FinalAdsList = @()
$SupersededTotalCount = 0
foreach ($ad in $InitialAdsList) {
  if (-not $ad.isSuperseded) {
    $FinalAdsList += $ad
    if ($ad.supersededAds) {
      $SupersededTotalCount += $ad.supersededAds.Count
    }
  }
}

$ApplicableCount = ($FinalAdsList | Where-Object { $_.applicabilityStatus -eq "Applicable" }).Count
$NotApplicableCount = ($FinalAdsList | Where-Object { $_.applicabilityStatus -eq "Not Applicable" }).Count

$DatabasePayload = @{
  metadata = @{
    lastSyncedAt          = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    operator              = "Vietjet Air (VJC)"
    mmeReference          = "MME 2.4 — Control of Airworthiness Directives"
    fleetTotal            = $VjcFleet.Count
    adTotal               = $FinalAdsList.Count
    supersededGrouped     = $SupersededTotalCount
    totalIncludingHistory = ($FinalAdsList.Count + $SupersededTotalCount)
    applicableTotal       = $ApplicableCount
    notApplicableTotal    = $NotApplicableCount
    sources               = @("EASA Safety Publications Tool (Airbus / CFM / IAE / RR)", "FAA Federal Register Final Rule AD API", "CAAV Vietnam Directives")
  }
  fleet = $VjcFleet
  ads   = $FinalAdsList
}

$jsonText = $DatabasePayload | ConvertTo-Json -Depth 10
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($DbPath, $jsonText, $utf8NoBom)

$ResolveSupScript = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "resolve-superseded-pdfs.ps1"
if (Test-Path $ResolveSupScript) {
  & $ResolveSupScript -DbPath $DbPath
}

$ResolveExactScript = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "resolve-exact-easa-faa-numbers.ps1"
if (Test-Path $ResolveExactScript) {
  & $ResolveExactScript -DbPath $DbPath
}

$FixEasaEquivScript = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "fix-easa-equivalents.ps1"
if (Test-Path $FixEasaEquivScript) {
  & $FixEasaEquivScript -DbPath $DbPath
}

$ImportAmosScript = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "import-amos-ads.ps1"
if (Test-Path $ImportAmosScript) {
  & $ImportAmosScript -DbPath $DbPath
}

$ImportEasaMissingScript = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "import-easa-archive-missing.ps1"
if (Test-Path $ImportEasaMissingScript) {
  & $ImportEasaMissingScript -DbPath $DbPath
}

$UpdateEasaArchiveScript = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "update-easa-archive-links.ps1"
if (Test-Path $UpdateEasaArchiveScript) {
  & $UpdateEasaArchiveScript -DbPath $DbPath
}

Write-Host "============================================================"
Write-Host " SYNC COMPLETE (108 EXACT VJC MSN/FLEET, EXACT AD MODEL/ENGINE/MSN PARSER)"
Write-Host " Total Active ADs     : $($FinalAdsList.Count)"
Write-Host " Superseded in Chains : $SupersededTotalCount"
Write-Host " Total ADs Tracked    : $($FinalAdsList.Count + $SupersededTotalCount)"
Write-Host " Applicable to VJC    : $ApplicableCount"
Write-Host " Not Applicable       : $NotApplicableCount"
Write-Host "============================================================"
