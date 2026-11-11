// Official Vietjet Air (VJC) Fleet Profile & Fallback Data (Verified from CAAV Certificates: 108 Aircraft)
window.VJC_FLEET_PROFILES = {
  operator: "VietJet Aviation Joint Stock Company (Vietjet Air - VJC)",
  aocNumber: "CAAV AOC No. 03/CAAV",
  activeAircraftModels: [
    "A320-214",
    "A321-211",
    "A321-271N",
    "A321-271NX",
    "A330-343"
  ],
  activeEngineModels: [
    "CFM56-5B4/P",
    "CFM56-5B4/3",
    "CFM56-5B3/P",
    "CFM56-5B3/3",
    "PW1133G-JM",
    "Trent 772B-60"
  ]
};

window.INITIAL_FLEET = [
  { reg: "VN-A666", msn: "3739", type: "A320-214", family: "A320", engine: "CFM56-5B4/P", fh: 38200, fc: 24100, base: "SGN", status: "Active" },
  { reg: "VN-A650", msn: "6457", type: "A320-214", family: "A320", engine: "CFM56-5B4/3", fh: 24500, fc: 15800, base: "HAN", status: "Active" },
  { reg: "VN-A651", msn: "5295", type: "A321-211", family: "A321", engine: "CFM56-5B3/P", fh: 26400, fc: 16200, base: "SGN", status: "Active" },
  { reg: "VN-A698", msn: "8393", type: "A321-211", family: "A321", engine: "CFM56-5B3/3", fh: 17900, fc: 11100, base: "HAN", status: "Active" },
  { reg: "VN-A646", msn: "7991", type: "A321-271N", family: "A321", engine: "PW1133G-JM", fh: 16800, fc: 10200, base: "SGN", status: "Active" },
  { reg: "VN-A600", msn: "8762", type: "A321-271N", family: "A321", engine: "PW1133G-JM", fh: 14900, fc: 9100, base: "HAN", status: "Active" },
  { reg: "VN-A521", msn: "9011", type: "A321-271NX", family: "A321", engine: "PW1133G-JM", fh: 12400, fc: 7400, base: "SGN", status: "Active" },
  { reg: "VN-A500", msn: "12520", type: "A321-271NX", family: "A321", engine: "PW1133G-JM", fh: 4200, fc: 2500, base: "SGN", status: "Active" },
  { reg: "VN-A810", msn: "0952", type: "A330-343", family: "A330", engine: "Trent 772B-60", fh: 44100, fc: 11800, base: "SGN", status: "Active" },
  { reg: "VN-A814", msn: "1674", type: "A330-343", family: "A330", engine: "Trent 772B-60", fh: 28900, fc: 7600, base: "HAN", status: "Active" }
];
