// AeroAD Control — Verbatim AD Text (Copy Y Chang), Superseded AD PDFs, VJC 108 Fleet Dropdown & Rescan
(function () {
  const STORAGE_KEY = "vjc_aeroad_verbatim_v17_admin_csv_fleet_and_adtype_filter";
  const ADMIN_SESSION_KEY = "vjc_aeroad_admin_authenticated";
  const ADMIN_CREDENTIALS = { user: "admin", pass: "vjc2026" };
  const EASA_ARCHIVE_URL =
    "https://www.easa.europa.eu/en/domains/aircraft-products/airworthiness-directives-ad/archive-airworthiness-directives";
  let fleetList = JSON.parse(JSON.stringify(window.INITIAL_FLEET || []));
  let adList = [];
  let lastSyncedAt = "Chưa đồng bộ";
  let activeAdId = null;
  let activeSupIdx = null; // null = Current AD, 0..N = Superseded AD index in modal
  let activeAdSide = "faa"; // "faa" | "easa" in modal
  let pendingUploadTarget = null; // { adId, supIdx, side }
  let expandAllSuperseded = false;
  let currentPage = 1;
  let pageSize = 150;
  let lastFleetScanReport = null;
  let lastBiweeklyReport = null;

  function showToast(msg) {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function copyTextToClipboard(text, label) {
    const val = String(text ?? "");
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(val);
        showToast(`📋 Đã copy ${label || "nội dung AD"} (${val.length.toLocaleString()} ký tự)!`);
        return true;
      }
    } catch (e) {}
    try {
      const ta = document.createElement("textarea");
      ta.value = val;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      ta.style.fontSize = "12pt";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, val.length);
      const ok = document.execCommand("copy");
      ta.remove();
      if (ok) {
        showToast(`📋 Đã copy ${label || "nội dung AD"} (${val.length.toLocaleString()} ký tự)!`);
        return true;
      }
    } catch (e2) {}
    showToast("⚠️ Trình duyệt chặn tự động copy — hãy bấm giữ/Ctrl+C trong khung văn bản.");
    return false;
  }

  function getAuthorityBadge(ad) {
    const auth = String(ad.authorityDual || ad.authority || "").toUpperCase();
    let badges = "";
    if (auth.includes("EASA")) {
      badges += `<span class="badge badge-easa" style="margin-right:4px;">🇪🇺 EASA</span>`;
    }
    if (auth.includes("FAA")) {
      badges += `<span class="badge badge-faa" style="margin-right:4px;">🇺🇸 FAA</span>`;
    }
    if (auth.includes("CAAV")) {
      badges += `<span class="badge badge-caav" style="margin-right:4px;">🇻🇳 CAAV</span>`;
    }
    return badges || `<span class="badge badge-standard">${escapeHtml(ad.authority)}</span>`;
  }

  // Extract normalized FAA + EASA labels so dual-authority ADs always render as 2 clean lines inside 1 cell
  function getSplitAdParts(ad) {
    let faaLabel = ad && ad.officialFaaAd ? `FAA AD ${String(ad.officialFaaAd).trim()}` : "";
    let easaLabel = ad && ad.easaAdNumber ? String(ad.easaAdNumber).trim() : "";
    const rawNum = String((ad && ad.adNumber) || "").trim();

    if ((!faaLabel || !easaLabel) && rawNum.includes(" / ")) {
      const parts = rawNum.split(/\s+\/\s+/);
      parts.forEach((p) => {
        const up = p.toUpperCase();
        if (!faaLabel && (up.startsWith("FAA") || /^(\d{4}-\d{2}-\d{2})/.test(up))) {
          faaLabel = p.trim();
        } else if (!easaLabel && (up.includes("EASA") || up.includes("DGAC") || up.includes("STATE AD"))) {
          easaLabel = p.trim();
        }
      });
    }
    return { faaLabel, easaLabel, isDual: Boolean(faaLabel && easaLabel), rawNum };
  }

  // Airbus & European aircraft ADs use EASA as Primary State of Design authority -> show EASA first, FAA second
  function isEasaPrimaryDual(ad) {
    if (!ad) return false;
    const oemAndSubject = [
      ad.targetModel,
      ad.adExtractedModels,
      ad.easaModels,
      ad.subject,
      ad.easaSubject,
      ad.adApplicabilityText
    ]
      .filter(Boolean)
      .join(" ");
    const isUsEngineOem = /\b(?:PRATT\s*&\s*WHITNEY|GENERAL ELECTRIC|CFM INTERNATIONAL|INTERNATIONAL AERO ENGINES)\b/i.test(
      oemAndSubject
    );
    const matchedStr = !isUsEngineOem && Array.isArray(ad.matchedTypes) ? ad.matchedTypes.join(" ") : "";
    return /\b(?:AIRBUS|A31[89]|A32[01]|A330|A350|A380|A220|ATR|BD-500)\b/i.test(`${oemAndSubject} ${matchedStr}`);
  }

  function renderAdNumberSplitHtml(ad, compact) {
    const { faaLabel, easaLabel, isDual, rawNum } = getSplitAdParts(ad);
    if (isDual) {
      const fs = compact ? "12px" : "13px";
      const easaFirst = isEasaPrimaryDual(ad);
      const easaLine = `<div style="font-size:${fs};font-weight:700;color:#34d399;">🇪🇺 ${escapeHtml(easaLabel)}</div>`;
      const faaLine = `<div style="font-size:${fs};font-weight:700;color:#93c5fd;">🇺🇸 ${escapeHtml(faaLabel)}</div>`;
      return `
        <div style="display:flex;flex-direction:column;gap:3px;line-height:1.35;">
          ${easaFirst ? easaLine + faaLine : faaLine + easaLine}
        </div>
      `;
    }
    if (easaLabel) {
      return `<span>🇪🇺 ${escapeHtml(rawNum || easaLabel)}</span>`;
    }
    if (faaLabel) {
      return `<span>🇺🇸 ${escapeHtml(rawNum || faaLabel)}</span>`;
    }
    return escapeHtml(rawNum);
  }

  function normalizeRelUrl(u) {
    if (!u) return u;
    return u.startsWith("/db/uploaded-pdfs/") ? `.${u}` : u;
  }

  function getSafeEasaUrl(ad) {
    const u = String((ad && ad.easaUrl) || "");
    if (u && !u.includes("ad.easa.europa.eu")) return normalizeRelUrl(u);
    if ((ad && ad.easaAdNumber) || u.includes("ad.easa.europa.eu")) return EASA_ARCHIVE_URL;
    return "";
  }

  function getSafePdfUrl(ad) {
    const u = String((ad && ad.pdfUrl) || "");
    if (u && !u.includes("ad.easa.europa.eu")) return normalizeRelUrl(u);
    return getSafeEasaUrl(ad) || EASA_ARCHIVE_URL;
  }

  function isRealPdfUrlStr(rawUrl) {
    const u = String(rawUrl || "").trim();
    if (!u || u === "#") return false;
    const low = u.toLowerCase();
    if (
      low.includes("ad.easa.europa.eu") ||
      low.includes("archive-airworthiness-directives") ||
      low === "https://caa.gov.vn/" ||
      low === "https://caa.gov.vn"
    ) {
      return false;
    }
    return /(\.pdf(\?|$)|\.zip(\?|$)|\/api\/resolve-ad-pdf|\/db\/uploaded-pdfs\/|\/local-pdf\/|^blob:|^data:application\/pdf)/i.test(
      u
    );
  }

  function hasDirectPdfFile(doc, side = "main") {
    if (!doc) return false;
    if (side === "easa") {
      return isRealPdfUrlStr(doc.easaUrl) || (doc.authority === "EASA" && isRealPdfUrlStr(doc.pdfUrl));
    }
    if (isRealPdfUrlStr(doc.pdfUrl)) return true;
    if (!doc.officialFaaAd && isRealPdfUrlStr(doc.easaUrl)) return true;
    return false;
  }

  function renderPdfActionHtml(adId, doc, opts = {}) {
    const side = opts.side || "main";
    const supIdx = opts.supIdx !== undefined && opts.supIdx !== null ? opts.supIdx : "";
    const viewLabel = opts.viewLabel || "📎 Xem PDF ↗";
    const uploadLabel = opts.uploadLabel || "📤 Upload PDF";
    const style = opts.style || "";
    const title = opts.title || "";
    const hasPdf = hasDirectPdfFile(doc, side);
    if (hasPdf) {
      const targetHref = side === "easa" ? getSafeEasaUrl(doc) || getSafePdfUrl(doc) : getSafePdfUrl(doc);
      return `<a href="${escapeHtml(
        targetHref
      )}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="${escapeHtml(style)}"${
        title ? ` title="${escapeHtml(title)}"` : ""
      }>${escapeHtml(viewLabel)}</a>`;
    }
    return `<button type="button" class="btn btn-outline btn-sm btn-upload-ad-pdf" data-ad-id="${escapeHtml(
      adId
    )}" data-sup-idx="${escapeHtml(String(supIdx))}" data-ad-side="${escapeHtml(
      side
    )}" style="${escapeHtml(style)}" title="Chưa có file PDF — Nhấn để upload file PDF (.pdf) cho AD này">${escapeHtml(
      uploadLabel
    )}</button>`;
  }

  async function uploadPdfFileForAd(file, adId, supIdx, side) {
    if (!file || !adId) return;
    const ad = adList.find((x) => x.id === adId);
    if (!ad) return;
    const hasSup = supIdx !== null && supIdx !== undefined && supIdx !== "" && !Number.isNaN(Number(supIdx));
    const sIdx = hasSup ? Number(supIdx) : null;

    showToast(`⏳ Đang tải lên "${file.name}" cho ${ad.adNumber}...`);
    let finalUrl = "";
    try {
      const qs = new URLSearchParams({
        adId,
        supIdx: sIdx !== null ? String(sIdx) : "",
        side: side || "main",
        fileName: file.name
      });
      const resp = await fetch(`/api/upload-ad-pdf?${qs.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: file
      });
      if (resp.ok) {
        const res = await resp.json();
        if (res && res.status === "ok" && res.pdfUrl) {
          finalUrl = res.pdfUrl;
        }
      }
    } catch (e) {}

    if (!finalUrl) {
      finalUrl = URL.createObjectURL(file);
    }

    if (sIdx !== null && ad.supersededAds && ad.supersededAds[sIdx]) {
      const sObj = ad.supersededAds[sIdx];
      if (side === "easa") sObj.easaUrl = finalUrl;
      else sObj.pdfUrl = finalUrl;
      sObj.attachedPdfName = file.name;
    } else {
      if (side === "easa") {
        ad.easaUrl = finalUrl;
        if (ad.authority === "EASA") ad.pdfUrl = finalUrl;
      } else {
        ad.pdfUrl = finalUrl;
      }
      ad.attachedPdfName = file.name;
    }

    saveToLocalStorage();
    refreshAllViews();
    if (document.getElementById("adDetailModal").classList.contains("open") && activeAdId === ad.id) {
      openAdModal(ad.id, activeSupIdx, activeAdSide);
    }
    showToast(`✅ Đã upload PDF "${file.name}" — Đã chuyển sang Xem PDF!`);
  }

  function isAdminLoggedIn() {
    try {
      return sessionStorage.getItem(ADMIN_SESSION_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function applyAdminUiState() {
    const authed = isAdminLoggedIn();
    document.body.classList.toggle("is-admin", authed);
    const btnAuth = document.getElementById("btnAdminAuth");
    if (btnAuth) {
      btnAuth.classList.toggle("btn-admin-logged-in", authed);
      btnAuth.textContent = authed ? "🔓" : "⚙";
      btnAuth.title = authed ? "Đang bật Admin — Nhấn để thoát" : "";
    }
  }

  function openAdminLoginModal() {
    const modal = document.getElementById("adminLoginModal");
    const errEl = document.getElementById("adminLoginError");
    const passEl = document.getElementById("adminPassword");
    if (errEl) errEl.style.display = "none";
    if (passEl) passEl.value = "";
    if (modal) {
      modal.classList.add("open");
      if (passEl) setTimeout(() => passEl.focus(), 50);
    }
  }

  function requireAdmin() {
    if (isAdminLoggedIn()) return true;
    showToast("🔐 Chức năng này thuộc Option Admin — Vui lòng đăng nhập Admin!");
    openAdminLoginModal();
    return false;
  }

  function classifyAdBucket(ad) {
    if (!ad) return "AIRCRAFT";
    const cat = String(ad.category || "").trim();
    const ata = String(ad.ata || "").trim();
    const subj = String(ad.subject || "").trim();
    const exModels = String(ad.adExtractedModels || "").trim();
    const appTxt = String(ad.adApplicabilityText || "").trim();
    const engines = String(ad.adExtractedEngines || "").trim();
    const sm = `${exModels} ${subj}`;

    const isHeliOrWingRotor =
      /\b(HELICOPTER|ROTORCRAFT|Main Rotor|Tail Rotor|Spoiler|Bell Textron|Leonardo|MD Helicopters|Airbus Helicopters)\b/i.test(
        sm
      ) && !/\b(Turboshaft|Engine Oil|Turbine)\b/i.test(subj);

    const isAirframeHolder =
      /^(AIRBUS|BOEING|EMBRAER|BOMBARDIER|ATR|COMAC|CESSNA|GULFSTREAM|DASSAULT|FOKKER|PIPER|BEECHCRAFT|TEXTRON|LEONARDO|SIKORSKY|BELL|DE HAVILLAND|SAAB|BAE|PILATUS|DAHER|CIRRUS|SOCATA|PIAGGIO|SCHEMPP|ALLSTAR|MD HELICOPTERS)\b/i.test(
        exModels
      ) ||
      /^(Airbus|The Boeing|Boeing|Embraer|Bombardier|ATR|COMAC|Cessna|Gulfstream|Dassault|Fokker)\b/i.test(subj);

    if (
      !isHeliOrWingRotor &&
      (/^Engine$/i.test(cat) ||
        /^(?:ATA\s*)?(7[1-9]|80)\b/i.test(ata) ||
        /\b(Powerplant|Engine Turbine)\b/i.test(ata) ||
        (!isAirframeHolder &&
          (/\b(CFM56|PW1\d{3}G|PW1100G|PW1133G|Trent\s*7\d*|Trent\s*1000|RB211|LEAP-1|V2500|Rolls-Royce.*Engines|Pratt\s*&\s*Whitney.*Engines|CFM International|International Aero Engines|Engine Alliance|GE Aviation|General Electric Company Engines|Safran Aircraft Engines|Lycoming|Continental|Turbomeca)\b/i.test(
            `${sm} ${appTxt}`
          ) ||
            (/\bengines?\b/i.test(appTxt) && /\b(?:all\s+)?(?:serial numbers|s\/n|ESN)\b/i.test(appTxt)))))
    ) {
      return "COMPONENT";
    }

    if (String(ad.adAffectedPart || "").trim()) {
      return "COMPONENT";
    }

    const isComponentOem =
      /\b(RECARO|ZODIAC|B\/E AEROSPACE|SAFRAN SEATS|SAFRAN ELECTRONICS|AEROSPACE\s*&\s*DEFENSE OXYGEN|THALES|HONEYWELL|GOODRICH|ROCKWELL COLLINS|COLLINS AEROSPACE|HAMILTON SUNDSTRAND|LIEBHERR|MEGGITT|PARKER|KIDDE|EATON|DIEHL|CURTISS|GARMIN|AVIDYNE|AMSAFE|PACIFIC SCIENTIFIC|AIRCRAFT CABIN MODIFICATION|SCHROTH|LANTAL|AVOX)\b/i.test(
        sm
      );

    const isComponentSubject =
      /\b(Receiver|SBAS|Seat|Seats|Oxygen|Breathing Equipment|PBE|Emergency Locator|ELT|Galley|Life Vest|Fire Extinguisher|Smoke Detector|Battery|Transponder|Pallet Net|Seat Energy Absorber|Rotary Buckle|APU|Auxiliary Power Unit)\b/i.test(
        subj + " " + exModels + " " + engines
      );

    if (
      /^APPLIANCES\b/i.test(exModels) ||
      (/\bComponent\b|\bAppliance\b/i.test(cat) && !isAirframeHolder) ||
      isComponentOem ||
      (!isAirframeHolder && (isComponentSubject || (/\b(25|26|34|35|49)\b/.test(ata) && /\bP\/N\b|Part Number/i.test(appTxt))))
    ) {
      return "COMPONENT";
    }

    return "AIRCRAFT";
  }

  function renderAdEngineOrClassHtml(ad) {
    const bucket = classifyAdBucket(ad);
    let classHtml = "";
    if (bucket === "COMPONENT") {
      classHtml = `<div style="font-size:11.5px;color:#fcd34d;margin-bottom:3px;"><strong style="color:#fbbf24;">🧩 Phân loại:</strong> Component / Thiết bị (Appliance)</div>`;
    } else {
      classHtml = `<div style="font-size:11.5px;color:#93c5fd;margin-bottom:3px;"><strong style="color:#60a5fa;">✈️ Phân loại:</strong> Tàu bay (Aircraft / Airframe)</div>`;
    }

    const rawApp = String((ad && ad.adApplicabilityText) || "").trim();
    const msnScope = String((ad && ad.adMsnScope) || "").trim();
    const appHtml = rawApp
      ? `<div style="font-size:11px;color:#fde68a;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.28);border-radius:4px;padding:4px 6px;margin-bottom:4px;line-height:1.4;max-height:78px;overflow-y:auto;"><strong style="color:#fbbf24;">📋 Applicability:</strong> ${escapeHtml(
          rawApp
        )}</div>`
      : msnScope
      ? `<div style="font-size:11px;color:#fcd34d;font-family:monospace;margin-bottom:4px;">📋 ${escapeHtml(
          msnScope
        )}</div>`
      : "";

    const rawAffPart = String((ad && ad.adAffectedPart) || "").trim();
    const affPartHtml = rawAffPart
      ? `<div style="font-size:11px;color:#ddd6fe;background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.32);border-radius:4px;padding:4px 6px;margin-bottom:4px;line-height:1.4;max-height:78px;overflow-y:auto;"><strong style="color:#a78bfa;">🔩 Affected part:</strong> ${escapeHtml(
          rawAffPart
        )}</div>`
      : "";

    return classHtml + appHtml + affPartHtml;
  }

  function getDisplayReasonSummary(rawText) {
    let t = String(rawText || "").trim();
    if (!t) return "";
    // Remove accidental footer noise or Required Action(s) / Ref. Publications / Remarks tail
    t = t
      .replace(/\s*Page \d+ of \d+\s+TE\.CAP\.[\s\S]*?An agency of the European Union(?:\s+EASA AD No\.?:?\s*[0-9A-Za-z\-]+)?/gi, " ")
      .replace(/\r?\n?\s*Required Action\(s\)[\s\S]*$/i, "")
      .replace(/\r?\n?\s*Ref\.\s*Publications:[\s\S]*$/i, "")
      .replace(/\r?\n?\s*Remarks:[\s\S]*$/i, "")
      .trim();
    // Focus strictly on Reason when Applicability / Definitions precede Reason
    if (/\bReason:/i.test(t)) {
      const idxR = t.search(/\bReason:/i);
      if (idxR >= 0) t = t.slice(idxR).trim();
    } else if (/^Applicability:/i.test(t)) {
      t = t.replace(/^Applicability:\s*/i, "").trim();
    }
    // Strip leading "Reason:" label because the box itself renders "📝 Reason:"
    t = t.replace(/^Reason:\s*/i, "").trim();
    return t;
  }

  function renderReasonBoxHtml(rawText) {
    const reasonText = getDisplayReasonSummary(rawText);
    if (!reasonText) return "";
    return `<div class="reason-box-selectable" style="font-size:11px;color:#fde68a;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.28);border-radius:4px;padding:6px 8px;line-height:1.45;max-height:140px;overflow-y:auto;white-space:pre-wrap;user-select:text;cursor:text;"><strong style="color:#fbbf24;">📝 Reason:</strong> ${escapeHtml(
      reasonText
    )}</div>`;
  }

  async function fetchFullVerbatimText(ad, side = "main", activeSupObj = null) {
    const splitInfo = getSplitAdParts(ad);
    const isDualEasaView = !activeSupObj && splitInfo.isDual && side === "easa";
    const cacheKey = `${activeSupObj ? `sup_${activeSupObj.adNumber}` : isDualEasaView ? "easa" : "main"}`;
    if (ad._fullTextCache && ad._fullTextCache[cacheKey]) {
      return ad._fullTextCache[cacheKey];
    }

    const doc = activeSupObj
      ? activeSupObj
      : isDualEasaView
      ? {
          adNumber: splitInfo.easaLabel,
          subject: ad.easaSubject || ad.subject,
          summary: ad.easaSummary || ad.summary,
          issuedDate: ad.easaIssuedDate || ad.issueDate || ad.issuedDate,
          effectiveDate: ad.easaEffectiveDate || ad.effectiveDate,
          pdfUrl: getSafeEasaUrl(ad),
          easaUrl: getSafeEasaUrl(ad),
          fullTextHtmlUrl: ""
        }
      : ad;

    const fallbackText = `${doc.adNumber}\nTitle: ${doc.subject || ad.subject}\nIssued Date: ${
      doc.issuedDate || doc.issueDate || ad.issueDate || "-"
    }\nEffective Date: ${doc.effectiveDate || ad.effectiveDate || "-"}\n\n${doc.summary || ad.summary || ""}`;

    const targetHtmUrl =
      !isDualEasaView &&
      (doc.fullTextHtmlUrl ||
        (doc.pdfUrl && String(doc.pdfUrl).includes("govinfo.gov/content/pkg/")
          ? String(doc.pdfUrl).replace("/pdf/", "/html/").replace(/\.pdf$/i, ".htm")
          : ""));
    const faaNumQuery = !isDualEasaView ? String(doc.officialFaaAd || ad.officialFaaAd || "").trim() : "";

    if (targetHtmUrl || faaNumQuery) {
      if (!isDualEasaView) {
        const faaCacheKeys = [doc.docNumber, faaNumQuery].filter(Boolean);
        for (const fk of faaCacheKeys) {
          try {
            const stFaa = await fetch(`./db/faa-fulltext-cache/${encodeURIComponent(String(fk).trim())}.txt`);
            if (stFaa.ok) {
              const ftTxt = await stFaa.text();
              if (ftTxt && ftTxt.length > 80) {
                const res = { fullText: ftTxt, sourceLabel: "FAA Cache", fallbackText };
                ad._fullTextCache = ad._fullTextCache || {};
                ad._fullTextCache[cacheKey] = res;
                return res;
              }
            }
          } catch (e) {}
        }
      }
      try {
        const qs = [];
        if (targetHtmUrl) qs.push(`url=${encodeURIComponent(targetHtmUrl)}`);
        if (faaNumQuery) qs.push(`ad=${encodeURIComponent(faaNumQuery)}`);
        const resp = await fetch(`/api/ad-fulltext?${qs.join("&")}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.fullText && data.fullText.length > 80) {
            const res = { fullText: data.fullText, sourceLabel: "GovInfo", fallbackText };
            ad._fullTextCache = ad._fullTextCache || {};
            ad._fullTextCache[cacheKey] = res;
            return res;
          }
        }
      } catch (e) {}
    }

    const easaPdfTargetUrl = [doc.pdfUrl, doc.easaUrl, !isDualEasaView ? "" : ad.easaUrl].find(
      (u) =>
        u &&
        (String(u).includes("easa.europa.eu/download/") || String(u).startsWith("/db/uploaded-pdfs/"))
    );
    if (easaPdfTargetUrl) {
      // Static cache fallback first -> works natively on BOTH GitHub Pages & localhost
      if (String(easaPdfTargetUrl).includes("easa.europa.eu/download/")) {
        const rawBase = String(easaPdfTargetUrl).split("?")[0].split("/").pop() || "";
        const safeTxtName = rawBase.replace(/[^A-Za-z0-9_.\-]/g, "_").replace(/\.(pdf|zip)$/i, ".txt");
        if (safeTxtName.endsWith(".txt")) {
          try {
            const stResp = await fetch(`./db/easa-pdf-cache/${encodeURIComponent(safeTxtName)}`);
            if (stResp.ok) {
              const ftTxt = await stResp.text();
              if (ftTxt && ftTxt.length > 80) {
                const res = { fullText: ftTxt, sourceLabel: "EASA PDF", fallbackText };
                ad._fullTextCache = ad._fullTextCache || {};
                ad._fullTextCache[cacheKey] = res;
                return res;
              }
            }
          } catch (e) {}
        }
      }
      try {
        const resp = await fetch(`/api/easa-fulltext?url=${encodeURIComponent(easaPdfTargetUrl)}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.fullText && data.fullText.length > 80) {
            const res = { fullText: data.fullText, sourceLabel: "EASA PDF", fallbackText };
            ad._fullTextCache = ad._fullTextCache || {};
            ad._fullTextCache[cacheKey] = res;
            return res;
          }
        }
      } catch (e) {}
    }

    return { fullText: fallbackText, sourceLabel: "Local", fallbackText };
  }

  function updateFilterHighlights() {
    const controls = [
      { id: "searchKeyword", def: "", type: "text", label: "Từ khóa" },
      { id: "filterAuthority", def: "ALL", type: "select", label: "Cơ quan" },
      { id: "filterApplicability", def: "ALL", type: "select", label: "Kết luận" },
      { id: "filterAdType", def: "ALL", type: "select", label: "Đối tượng AD" },
      { id: "filterSuperseded", def: "ALL", type: "select", label: "Superseded" },
      { id: "filterModel", def: "ALL", type: "select", label: "Tàu/Động cơ" },
      { id: "filterAircraftReg", def: "ALL", type: "select", label: "Tàu bay VJC" },
      { id: "filterAdAta", def: "ALL", type: "select", label: "Chương ATA" },
      { id: "sortSelect", def: "applicableFirst", type: "select", label: "Sắp xếp" },
      { id: "evalFilterAircraftReg", def: "ALL", type: "select", label: "Tàu bay (Tab Nguyên văn)", standalone: true },
      { id: "fleetSelectFilter", def: "ALL", type: "select", label: "Tàu bay (Tab Đội bay)", standalone: true }
    ];

    const activeChips = [];
    let mainActiveCount = 0;

    controls.forEach((cfg) => {
      const el = document.getElementById(cfg.id);
      if (!el) return;
      const val = cfg.type === "text" ? el.value.trim() : el.value;
      const isActive = val !== cfg.def && val !== "";
      el.classList.toggle("filter-active-control", isActive);
      const grp = el.closest(".form-group");
      if (grp) grp.classList.toggle("filter-group-active", isActive);

      if (!cfg.standalone && isActive) {
        mainActiveCount++;
        let valDisplay = val;
        if (cfg.type === "select" && el.selectedIndex >= 0) {
          valDisplay = el.options[el.selectedIndex].text.split("(")[0].trim();
        }
        activeChips.push({ id: cfg.id, def: cfg.def, label: cfg.label, value: valDisplay });
      }
    });

    const resetBtn = document.getElementById("btnResetFilters");
    if (resetBtn) {
      resetBtn.classList.toggle("btn-reset-active", mainActiveCount > 0);
      resetBtn.textContent = mainActiveCount > 0 ? `🔄 Đặt lại (${mainActiveCount})` : "🔄 Đặt lại";
    }

    const bar = document.getElementById("activeFiltersBar");
    if (bar) {
      if (activeChips.length === 0) {
        bar.style.display = "none";
        bar.innerHTML = "";
      } else {
        bar.style.display = "flex";
        bar.innerHTML =
          `<span class="active-filters-label">🔍 Bộ lọc đang bật (${activeChips.length}):</span>` +
          activeChips
            .map(
              (c) =>
                `<button type="button" class="active-filter-chip" data-clear-filter-id="${escapeHtml(
                  c.id
                )}" data-clear-default="${escapeHtml(c.def)}" title="Nhấn để tắt bộ lọc này">${escapeHtml(
                  c.label
                )}: <span>${escapeHtml(c.value)}</span> ✕</button>`
            )
            .join("");
      }
    }

    // Highlight matching KPI card when Applicability / Superseded filter is active
    const appVal = (document.getElementById("filterApplicability") || {}).value || "ALL";
    const supVal = (document.getElementById("filterSuperseded") || {}).value || "ALL";
    document.querySelectorAll(".kpi-card").forEach((card) => {
      const qf = card.getAttribute("data-QuickFilter");
      const match =
        (qf === "APPLICABLE" && appVal === "Applicable") ||
        (qf === "NOT_APPLICABLE" && appVal === "Not Applicable") ||
        (qf === "SUPERSEDED" && supVal === "HAS_SUPERSEDED");
      card.classList.toggle("kpi-filter-active", match);
    });
  }

  // Hydrate compact AD records with VJC affectedFleet & ensure Superseded ADs have distinct PDF URLs
  function hydrateAdsWithFleet() {
    const fleetByType = {};
    fleetList.forEach((ac) => {
      if (!fleetByType[ac.type]) fleetByType[ac.type] = [];
      fleetByType[ac.type].push(ac);
    });
    const activeTypes = Object.keys(fleetByType);

    adList.forEach((ad) => {
      ad.issueDate = ad.issueDate || ad.issuedDate || ad.effectiveDate || "";
      ad.adExtractedModels = ad.adExtractedModels || ad.targetModel || "Tàu bay / Thiết bị";
      ad.adExtractedEngines = ad.adExtractedEngines || "Theo cấu hình TCDS";
      ad.adMsnScope = ad.adMsnScope || "All MSNs / Theo mục (c) Applicability trong AD";
      ad.vjcMatchedSummary =
        ad.vjcMatchedSummary ||
        (ad.applicabilityStatus === "Applicable"
          ? ad.targetModel
          : "Không khớp biến thể tàu bay / động cơ của VJC");

      // Re-check dynamic fleet match (especially when new variants like A330-941 are imported via CSV)
      const checkText = `${ad.adExtractedModels || ""} ${ad.targetModel || ""} ${ad.adExtractedEngines || ""} ${
        ad.vjcMatchedSummary || ""
      } ${ad.subject || ""}`;
      if (fleetByType["A330-941"] && /\bA330-941\b|\bA330neo\b|\bTrent\s*7000/i.test(checkText)) {
        ad.applicabilityStatus = "Applicable";
        const mt = Array.isArray(ad.matchedTypes) ? [...ad.matchedTypes] : [];
        if (!mt.includes("A330-941")) mt.push("A330-941");
        ad.matchedTypes = mt;
      }

      if (ad.applicabilityStatus === "Applicable") {
        let mTypes = Array.isArray(ad.matchedTypes) ? ad.matchedTypes : [];
        if (mTypes.length === 0) {
          const checkStr = `${ad.vjcMatchedSummary} ${ad.targetModel} ${ad.adExtractedModels}`;
          activeTypes.forEach((t) => {
            if (checkStr.includes(t)) mTypes.push(t);
          });
        }
        ad.matchedTypes = mTypes;

        const matchedAc = [];
        mTypes.forEach((t) => {
          if (fleetByType[t]) {
            fleetByType[t].forEach((ac) => {
              matchedAc.push({
                reg: ac.reg,
                msn: ac.msn,
                type: ac.type,
                engine: ac.engine
              });
            });
          }
        });
        ad.affectedFleet = matchedAc;
        ad.affectedCount = ad.affectedFleet.length || ad.affectedCount || 0;
        if (matchedAc.length > 0 && activeTypes.length > 0) {
          const typeCounts = {};
          matchedAc.forEach((m) => (typeCounts[m.type] = (typeCounts[m.type] || 0) + 1));
          const summaryParts = Object.entries(typeCounts).map(([t, cnt]) => `${t} (${cnt} tàu)`);
          if (summaryParts.length > 0 && /Không khớp|Khớp \d+/.test(ad.vjcMatchedSummary)) {
            ad.vjcMatchedSummary = summaryParts.join(" + ");
          }
        }
      } else {
        ad.matchedTypes = [];
        ad.affectedFleet = [];
        ad.affectedCount = 0;
      }

      // Ensure every Superseded AD has its own PDF URL & fullTextHtmlUrl
      if (Array.isArray(ad.supersededAds)) {
        ad.supersededAds.forEach((s) => {
          const cleanOld = String(s.adNumber || "")
            .replace(/^(FAA\s+|EASA\s+)?AD\s+/i, "")
            .trim();
          if (!s.pdfUrl || s.pdfUrl === ad.pdfUrl) {
            s.pdfUrl = `/api/resolve-ad-pdf?ad=${encodeURIComponent(cleanOld)}`;
          }
          if (!s.fullTextHtmlUrl && s.pdfUrl && s.pdfUrl.includes("govinfo.gov/content/pkg/")) {
            s.fullTextHtmlUrl = s.pdfUrl.replace("/pdf/", "/html/").replace(/\.pdf$/i, ".htm");
          }
        });
      }
    });
  }

  // Populate all Aircraft Selection Dropdowns (#filterAircraftReg, #evalFilterAircraftReg, #fleetSelectFilter)
  function populateAircraftDropdowns() {
    const labelMap = {
      "A320-214": "Airbus A320-214 CEO (CFM56-5B4/P & -5B4/3)",
      "A321-211": "Airbus A321-211 CEO (CFM56-5B3/P & -5B3/3)",
      "A321-271N": "Airbus A321-271N NEO (PW1133G-JM)",
      "A321-271NX": "Airbus A321-271NX NEO ACF (PW1133G-JM)",
      "A330-343": "Airbus A330-343 Widebody (RR Trent 772B-60)",
      "A330-941": "Airbus A330-941 NEO (RR Trent 7000-72)"
    };
    const seenTypes = Array.from(new Set(fleetList.map((f) => f.type).filter(Boolean)));
    const orderedBase = ["A320-214", "A321-211", "A321-271N", "A321-271NX", "A330-343", "A330-941"];
    const finalTypes = [
      ...orderedBase.filter((t) => seenTypes.includes(t)),
      ...seenTypes.filter((t) => !orderedBase.includes(t))
    ];
    const groups = finalTypes.map((type) => ({ type, label: labelMap[type] || `Tàu bay ${type}` }));

    const optGroupsHtml = groups
      .map((g) => {
        const acs = fleetList.filter((f) => f.type === g.type);
        if (acs.length === 0) return "";
        const opts = acs
          .map(
            (ac) =>
              `<option value="${escapeHtml(ac.reg)}">✈️ ${escapeHtml(ac.reg)} — MSN ${escapeHtml(
                ac.msn
              )} (${escapeHtml(ac.type)} • ${escapeHtml(ac.engine)})</option>`
          )
          .join("");
        return `<optgroup label="${escapeHtml(g.label)} — ${acs.length} tàu">${opts}</optgroup>`;
      })
      .join("");

    const dropdownConfigs = [
      {
        id: "filterAircraftReg",
        allLabel: `✈️ Tất cả ${fleetList.length} tàu bay VJC (Mọi số ĐK VN-Axxx)`
      },
      {
        id: "evalFilterAircraftReg",
        allLabel: `✈️ Tất cả ${fleetList.length} tàu bay VJC`
      },
      {
        id: "fleetSelectFilter",
        allLabel: `✈️ Tất cả ${fleetList.length} tàu bay VJC (Hiển thị 200 dòng đầu)`
      },
      {
        id: "filterAppliancePlane",
        allLabel: `✈️ Tất cả ${fleetList.length} tàu bay VJC`
      }
    ];

    dropdownConfigs.forEach(({ id, allLabel }) => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const prevVal = sel.value || "ALL";
      sel.innerHTML = `<option value="ALL">${escapeHtml(allLabel)}</option>${optGroupsHtml}`;
      if (prevVal !== "ALL" && fleetList.some((f) => f.reg === prevVal)) {
        sel.value = prevVal;
      } else {
        sel.value = "ALL";
      }
    });
  }

  const ATA_CHAPTER_NAMES = {
    "05": "Time Limits / Maintenance Checks",
    "11": "Placards & Markings (Nhãn & Bảng chỉ dẫn)",
    "21": "Air Conditioning (Điều hòa & Áp suất)",
    "22": "Auto Flight (Lái tự động)",
    "23": "Communications (Liên lạc & Đàm thoại)",
    "24": "Electrical Power (Hệ thống điện)",
    "25": "Equipment / Furnishings (Nội thất & Thiết bị)",
    "26": "Fire Protection (Báo cháy & Dập lửa)",
    "27": "Flight Controls (Điều khiển bay)",
    "28": "Fuel (Nhiên liệu)",
    "29": "Hydraulic Power (Thủy lực)",
    "30": "Ice & Rain Protection (Chống băng tuyết)",
    "31": "Indicating / Recording (Hiển thị & Ghi dữ liệu)",
    "32": "Landing Gear (Bộ càng đáp & Phanh)",
    "33": "Lights (Hệ thống đèn)",
    "34": "Navigation (Dẫn đường & Cảm biến)",
    "35": "Oxygen (Dưỡng khí oxy)",
    "36": "Pneumatic (Khí nén Bleed Air)",
    "38": "Water / Waste (Nước sạch & Xả thải)",
    "49": "Airborne Auxiliary Power (Động cơ phụ APU)",
    "52": "Doors (Hệ thống cửa tàu bay)",
    "53": "Fuselage (Kết cấu thân tàu)",
    "54": "Nacelles / Pylons (Vỏ & Giá treo)",
    "55": "Stabilizers (Cánh đuôi)",
    "56": "Windows (Kính chắn gió & Cửa sổ)",
    "57": "Wings (Kết cấu cánh)",
    "71": "Power Plant (Cụm động cơ)",
    "72": "Engine (Động cơ lõi / Turbine / Fan)",
    "73": "Engine Fuel & Control (Điều khiển nhiên liệu)",
    "74": "Ignition (Hệ thống đánh lửa)",
    "75": "Air (Khí làm mát động cơ)",
    "76": "Engine Controls (Điều khiển động cơ)",
    "77": "Engine Indicating (Thông số động cơ)",
    "78": "Exhaust (Ống xả & Đảo chiều Reverser)",
    "79": "Engine Oil (Dầu nhớt bôi trơn)",
    "80": "Starting (Hệ thống khởi động)"
  };

  function populateAdAtaDropdown() {
    const sel = document.getElementById("filterAdAta");
    if (!sel) return;
    const counts = {};
    adList.forEach((ad) => {
      let code = "";
      if (ad.ata) {
        const m = ad.ata.match(/ATA\s*(\d{2})/i) || ad.ata.match(/^(\d{2})/);
        if (m) code = m[1];
      }
      if (code) {
        counts[code] = (counts[code] || 0) + 1;
      }
    });
    const sortedCodes = Object.keys(counts).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    const prev = sel.value || "ALL";
    sel.innerHTML = '<option value="ALL">🌐 Tất cả Chương ATA</option>' +
      sortedCodes.map((c) => {
        const name = ATA_CHAPTER_NAMES[c] || `ATA ${c}`;
        return `<option value="${c}">ATA ${c} — ${name} (${counts[c]} AD)</option>`;
      }).join("");
    if (prev !== "ALL" && counts[prev]) sel.value = prev;
    else sel.value = "ALL";
  }

  function populateApplianceAtaDropdown() {
    const sel = document.getElementById("filterApplianceAta");
    if (!sel) return;
    const counts = {};
    const adPool = adList.filter((a) => a.appliancesMatched && a.appliancesMatched.length > 0);
    adPool.forEach((ad) => {
      let code = "";
      if (ad.ata) {
        const m = ad.ata.match(/ATA\s*(\d{2})/i) || ad.ata.match(/^(\d{2})/);
        if (m) code = m[1];
      }
      if (code) {
        counts[code] = (counts[code] || 0) + 1;
      }
    });
    const sortedCodes = Object.keys(counts).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    const prev = sel.value || "ALL";
    sel.innerHTML = '<option value="ALL">🌐 Tất cả Chương ATA</option>' +
      sortedCodes.map((c) => {
        const name = ATA_CHAPTER_NAMES[c] || `ATA ${c}`;
        return `<option value="${c}">ATA ${c} — ${name} (${counts[c]} AD)</option>`;
      }).join("");
    if (prev !== "ALL" && counts[prev]) sel.value = prev;
    else sel.value = "ALL";
  }

  // Split Superseded AD items cleanly by authority side ("easa", "faa", or "all")
  // so Dual pairs display EASA superseded ADs under EASA row and FAA superseded ADs under FAA row.
  function normalizeEasaCoreNum(str) {
    return String(str || "")
      .replace(/^EASA\s+AD\s+/i, "")
      .replace(/\s*\([^)]*\)\s*$/g, "")
      .trim()
      .toUpperCase();
  }

  function getSupersededItemsForSide(ad, sideFilter = "all") {
    const supList = ad.supersededAds || [];
    if (supList.length === 0) return [];
    const curEasaCore = normalizeEasaCoreNum(ad.easaAdNumber);
    const results = [];

    supList.forEach((s, origIdx) => {
      const rawNum = String(s.adNumber || "").trim();
      const authUpper = String(s.authority || "").trim().toUpperCase();
      const hasFaa = Boolean(
        s.officialFaaAd || /\bFAA\b|\b\d{4}-\d{2}-\d{2}\b/i.test(rawNum) || authUpper === "FAA"
      );
      const hasExplicitEasa = Boolean(
        s.easaAdNumber || /\b(?:EASA|DGAC|LBA|CAA|State AD)\b|\b\d{4}-\d{4}(?:R\d+)?(?:-E)?\b/i.test(rawNum)
      );
      const hasEasa = hasExplicitEasa || (authUpper === "EASA" && !hasFaa);

      if (sideFilter === "faa") {
        if (!hasFaa) return;
        const cleanFaa = String(s.officialFaaAd || "").trim();
        const displayNum = cleanFaa
          ? /^FAA/i.test(cleanFaa)
            ? cleanFaa
            : `FAA AD ${cleanFaa}`
          : rawNum.includes(" / ")
            ? rawNum
                .split(" / ")
                .filter((p) => /FAA|\d{4}-\d{2}-\d{2}/i.test(p))
                .join(" / ") || rawNum
            : rawNum;
        results.push({ s, origIdx, displayNum, pdfSide: "main", sideTag: "faa" });
      } else if (sideFilter === "easa") {
        if (!hasEasa) return;
        const cleanEasa = String(s.easaAdNumber || "").trim();
        const sEasaCore = normalizeEasaCoreNum(cleanEasa || rawNum);
        // Skip mirrored entries that only record an older FAA AD tied to the SAME active EASA AD
        if (curEasaCore && sEasaCore && sEasaCore === curEasaCore) return;
        const displayNum = cleanEasa
          ? /^EASA/i.test(cleanEasa)
            ? cleanEasa
            : `EASA AD ${cleanEasa}`
          : rawNum.includes(" / ")
            ? rawNum
                .split(" / ")
                .filter((p) => !/FAA|\d{4}-\d{2}-\d{2}/i.test(p))
                .join(" / ") || rawNum
            : rawNum;
        const easaPdfSide = s.easaUrl || s.easaAdNumber ? "easa" : "main";
        results.push({ s, origIdx, displayNum, pdfSide: easaPdfSide, sideTag: "easa" });
      } else {
        results.push({ s, origIdx, displayNum: rawNum, pdfSide: "main", sideTag: "all" });
      }
    });

    return results;
  }

  function renderSupQuickPdfsHtml(ad, sideFilter = "all") {
    const items = getSupersededItemsForSide(ad, sideFilter);
    if (items.length === 0) return "";
    return `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;">
      ${items
        .map(({ s, origIdx, displayNum, pdfSide }) =>
          renderPdfActionHtml(ad.id, s, {
            supIdx: origIdx,
            side: pdfSide,
            viewLabel: `📎 PDF ${displayNum} ↗`,
            uploadLabel: `📤 Upload ${displayNum}`,
            style: "font-size:10.5px;padding:2px 6px;border-color:rgba(245,158,11,0.55);color:#fbbf24;",
            title: `Mở PDF gốc của AD bị thay thế ${displayNum}`
          })
        )
        .join("")}
    </div>`;
  }

  // Render grouped Dropdown List for a Superseding AD and its Superseded ADs (each with its own PDF!)
  function renderSupersededDropdownHtml(ad, forceOpen, sideFilter = "all", hideWhenEmpty = false) {
    const items = getSupersededItemsForSide(ad, sideFilter);
    if (items.length === 0) {
      if (hideWhenEmpty) return "";
      const emptyLabel =
        sideFilter === "easa"
          ? "AD EASA Độc lập (Không thay thế EASA AD cũ)"
          : sideFilter === "faa"
            ? "AD FAA Độc lập (Không thay thế FAA AD cũ)"
            : "AD Độc lập (Không thay thế AD cũ)";
      return `<div style="margin-top:5px;"><span class="badge badge-standard" style="opacity:0.75;">${emptyLabel}</span></div>`;
    }

    const isOpenAttr = forceOpen || expandAllSuperseded ? "open" : "";
    const splitInfo = getSplitAdParts(ad);
    const currentNum =
      sideFilter === "easa" && splitInfo.isDual
        ? splitInfo.easaLabel
        : sideFilter === "faa" && splitInfo.isDual
          ? splitInfo.faaLabel
          : ad.adNumber;
    const currentEff =
      sideFilter === "easa" && splitInfo.isDual
        ? ad.easaEffectiveDate || ad.effectiveDate
        : ad.effectiveDate;
    const chainTitle =
      sideFilter === "faa"
        ? `🔗 Chuỗi FAA AD (${items.length + 1} AD)`
        : sideFilter === "easa"
          ? `🔗 Chuỗi EASA AD (${items.length + 1} AD)`
          : `🔗 Chuỗi AD Thay thế & Bị thay thế (${items.length + 1} AD)`;

    const selectOptions = [
      `<option value="CURRENT">🟢 HIỆN HÀNH: ${escapeHtml(currentNum)} (${escapeHtml(
        currentEff
      )})</option>`,
      ...items.map(
        ({ s, origIdx, displayNum }) =>
          `<option value="SUP_${origIdx}">🔴 ${escapeHtml(
            displayNum
          )} (${escapeHtml(s.issuedDate || "Historical")})</option>`
      )
    ].join("");

    const detailItems = items
      .map(
        ({ s, origIdx, displayNum, pdfSide, sideTag }) => `
        <div class="superseded-item" data-sup-idx="${origIdx}" style="border-left:3px solid #f59e0b;padding-left:8px;">
          <div class="superseded-item-head" style="flex-wrap:wrap;gap:6px;">
            <div style="display:flex;align-items:flex-start;gap:6px;flex-wrap:wrap;">
              <span class="badge badge-superseded">⚠️ SUPERSEDED</span>
              <span class="superseded-num" style="font-weight:700;color:#fde68a;">${
                sideTag === "all" ? renderAdNumberSplitHtml(s, true) : escapeHtml(displayNum)
              }</span>
              ${
                s.issuedDate && s.issuedDate !== "Historical"
                  ? `<span style="font-size:11px;color:var(--text-muted);margin-left:4px;">(Issued: ${escapeHtml(
                      s.issuedDate
                    )} • Eff: ${escapeHtml(s.effectiveDate || s.issuedDate)})</span>`
                  : ""
              }
            </div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
              ${renderPdfActionHtml(ad.id, s, {
                supIdx: origIdx,
                side: pdfSide,
                viewLabel: `📎 PDF ${displayNum} ↗`,
                uploadLabel: `📤 Upload PDF ${displayNum}`,
                style: "padding:2px 8px;font-size:11px;border-color:rgba(245,158,11,0.65);color:#fbbf24;font-weight:600;"
              })}
              ${
                sideTag === "all" && s.easaAdNumber && s.officialFaaAd
                  ? renderPdfActionHtml(ad.id, s, {
                      supIdx: origIdx,
                      side: "easa",
                      viewLabel: `🇪🇺 PDF ${s.easaAdNumber} ↗`,
                      uploadLabel: `📤 Upload ${s.easaAdNumber}`,
                      style: "padding:2px 8px;font-size:11px;border-color:rgba(16,185,129,0.55);color:#34d399;font-weight:600;"
                    })
                  : ""
              }
            </div>
          </div>
          ${
            s.subject
              ? `<div style="font-size:11.5px;font-weight:700;color:#93c5fd;margin-top:4px;">${escapeHtml(
                  s.subject
                )}</div>`
              : ""
          }
          <div style="font-size:11.5px;color:var(--text-primary);line-height:1.45;margin-top:3px;font-family:monospace;background:rgba(15,23,42,0.6);padding:6px 8px;border-radius:4px;">
            ${escapeHtml(s.summary)}
          </div>
        </div>`
      )
      .join("");

    return `
      <div class="superseded-group-wrapper" onclick="event.stopPropagation();" style="margin-top:8px;">
        <div style="margin-bottom:5px;">
          <label style="font-size:10.5px;font-weight:700;color:#fbbf24;display:block;margin-bottom:3px;text-transform:uppercase;">
            ${chainTitle}:
          </label>
          <select class="form-control superseded-chain-select" data-parent-ad-id="${escapeHtml(
            ad.id
          )}" style="padding:5px 8px;font-size:11.5px;border-color:rgba(245,158,11,0.55);background:rgba(15,23,42,0.85);color:#fde68a;font-weight:600;">
            ${selectOptions}
          </select>
        </div>

        <details class="superseded-dropdown" ${isOpenAttr}>
          <summary>
            <span>📂 Xem ${items.length} ${sideFilter === "faa" ? "FAA AD" : sideFilter === "easa" ? "EASA AD" : "AD"} bị Superseded (${items
      .map((x) => escapeHtml(x.displayNum.replace(/^(?:EASA|FAA)\s+AD\s+/i, "")))
      .join(", ")})</span>
            <span>▾</span>
          </summary>
          <div class="superseded-list">
            ${detailItems}
          </div>
        </details>
      </div>
    `;
  }

  // Exact Airbus Model, Engine & MSN Parser
  function parseExactModelsEnginesAndMsn(title, abstract) {
    let norm = `${title || ""} ${abstract || ""}`
      .replace(/-\s+([0-9]{2,4}[A-Z0-9]*)/g, "-$1")
      .replace(/\s+/g, " ");

    const expandRe = /\b(A3[0-9]{2})(-[0-9]{3}[A-Z]*((?:,\s*|\s+and\s+|\s+or\s+|,\s*and\s+|,\s*or\s+)-[0-9]{3}[A-Z]*)+)/gi;
    norm = norm.replace(expandRe, (full, fam, tail) => {
      const prefix = fam.toUpperCase();
      return tail.replace(/(^|,\s*|\s+and\s+|\s+or\s+)-([0-9]{3}[A-Z]*)/gi, (m, sep, code) => {
        return `${sep}${prefix}-${code.toUpperCase()}`;
      });
    });

    const exactAirbusSet = new Set();
    const reAirbus = /\b(A3[0-9]{2}-[0-9]{3}[A-Z]{0,2}|A300-[A-Z0-9\-]+|A310-[0-9]{3}|A220-[0-9]{3})\b/gi;
    let m;
    while ((m = reAirbus.exec(norm)) !== null) {
      exactAirbusSet.add(m[1].toUpperCase());
    }
    const exactAirbusModels = Array.from(exactAirbusSet);

    const hasSpecificA320 = exactAirbusModels.some((x) => /^A320-[0-9]{3}/.test(x) && !x.endsWith("00"));
    const hasSpecificA321 = exactAirbusModels.some((x) => /^A321-[0-9]{3}/.test(x) && !x.endsWith("00"));
    const hasSpecificA330 = exactAirbusModels.some((x) => /^A330-[0-9]{3}/.test(x) && !x.endsWith("00"));

    const matchedTypesSet = new Set();
    const vjcMatchedLabels = [];
    const adExtractedModels = [...exactAirbusModels];

    if (
      exactAirbusModels.includes("A320-214") ||
      exactAirbusModels.includes("A320-200") ||
      (!hasSpecificA320 && /\b(?:Model|all)\s+A320\b|\bA320\s+(?:series|family)\b/i.test(norm))
    ) {
      matchedTypesSet.add("A320-214");
      vjcMatchedLabels.push("A320-214 (15 tàu • CFM56-5B4)");
      if (adExtractedModels.length === 0) adExtractedModels.push("Airbus A320 Series");
    }

    if (
      exactAirbusModels.includes("A321-211") ||
      exactAirbusModels.includes("A321-200") ||
      (!hasSpecificA321 && /\b(?:Model|all)\s+A321\b|\bA321\s+(?:series|family)\b/i.test(norm))
    ) {
      matchedTypesSet.add("A321-211");
      vjcMatchedLabels.push("A321-211 CEO (41 tàu • CFM56-5B3)");
      if (adExtractedModels.length === 0) adExtractedModels.push("Airbus A321 Series");
    }

    if (
      exactAirbusModels.includes("A321-271N") ||
      (!hasSpecificA321 && /\b(?:Model|all)\s+A321\b|\bA321\s+(?:series|family|NEO)\b/i.test(norm))
    ) {
      matchedTypesSet.add("A321-271N");
      vjcMatchedLabels.push("A321-271N NEO (11 tàu • PW1133G-JM)");
    }

    if (
      exactAirbusModels.includes("A321-271NX") ||
      (!hasSpecificA321 && /\b(?:Model|all)\s+A321\b|\bA321\s+(?:series|family|NEO)\b/i.test(norm))
    ) {
      matchedTypesSet.add("A321-271NX");
      vjcMatchedLabels.push("A321-271NX NEO ACF (33 tàu • PW1133G-JM)");
    }

    if (
      exactAirbusModels.includes("A330-343") ||
      exactAirbusModels.includes("A330-300") ||
      (!hasSpecificA330 && /\b(?:Model|all)\s+A330\b|\bA330\s+(?:series|family)\b/i.test(norm))
    ) {
      matchedTypesSet.add("A330-343");
      vjcMatchedLabels.push("A330-343 (8 tàu • Trent 772B-60)");
      if (adExtractedModels.length === 0) adExtractedModels.push("Airbus A330-300 Series");
    }

    if (
      exactAirbusModels.includes("A330-941") ||
      /\bA330-900\b|\bA330neo\b/i.test(norm)
    ) {
      matchedTypesSet.add("A330-941");
      vjcMatchedLabels.push("A330-941 NEO (Trent 7000-72)");
      if (adExtractedModels.length === 0) adExtractedModels.push("Airbus A330-941 (A330neo)");
    }

    const adExtractedEngines = [];
    if (/\bPW1100G|\bPW1133G|\bPW1127G|\bPW1130G|\bPW1124G|International Aero Engines.*PW11/i.test(norm)) {
      adExtractedEngines.push("PW1100G-JM Series (PW1133G-JM)");
      if (!matchedTypesSet.has("A321-271N")) {
        matchedTypesSet.add("A321-271N");
        vjcMatchedLabels.push("A321-271N (11 tàu • PW1133G-JM)");
      }
      if (!matchedTypesSet.has("A321-271NX")) {
        matchedTypesSet.add("A321-271NX");
        vjcMatchedLabels.push("A321-271NX (33 tàu • PW1133G-JM)");
      }
    }
    if (/\bCFM56-5B/i.test(norm)) {
      adExtractedEngines.push("CFM56-5B Series (CFM56-5B4 / -5B3)");
      if (!matchedTypesSet.has("A320-214")) {
        matchedTypesSet.add("A320-214");
        vjcMatchedLabels.push("A320-214 (15 tàu • CFM56-5B4)");
      }
      if (!matchedTypesSet.has("A321-211")) {
        matchedTypesSet.add("A321-211");
        vjcMatchedLabels.push("A321-211 (41 tàu • CFM56-5B3)");
      }
    }
    if (/\bTrent\s*772|\bTrent\s*700\b|\bRB211-Trent\s*7/i.test(norm)) {
      adExtractedEngines.push("Rolls-Royce Trent 700 (Trent 772B-60)");
      if (!matchedTypesSet.has("A330-343")) {
        matchedTypesSet.add("A330-343");
        vjcMatchedLabels.push("A330-343 (8 tàu • Trent 772B-60)");
      }
    }
    if (/\bTrent\s*7000/i.test(norm)) {
      adExtractedEngines.push("Rolls-Royce Trent 7000 (Trent 7000-72)");
      if (!matchedTypesSet.has("A330-941")) {
        matchedTypesSet.add("A330-941");
        vjcMatchedLabels.push("A330-941 NEO (Trent 7000-72)");
      }
    }

    let adMsnScope = "Theo mục (c) Applicability trong văn bản gốc AD";
    const mMsn = norm.match(
      /(?:manufacturer serial numbers?\s*\(?MSNs?\)?|MSNs?|serial numbers?)\s*(?:from\s+|between\s+|inclusive\s+|up to\s+)?([0-9]{3,5}(?:\s*(?:through|to|and|,|or|-)\s*[0-9]{3,5})*)/i
    );
    if (mMsn) {
      adMsnScope = `MSN / S/N trong AD: ${mMsn[1].trim()}`;
    } else if (/\ball\s+(?:Airbus|Model|airplane|engine)/i.test(norm)) {
      adMsnScope = "All MSNs (Mọi số xuất xưởng MSN thuộc Model nêu trong AD)";
    }

    return {
      adExtractedModels: adExtractedModels.length > 0 ? adExtractedModels.join(", ") : "Thiết bị / Tàu bay khác",
      adExtractedEngines:
        adExtractedEngines.length > 0 ? adExtractedEngines.join(", ") : "Động cơ theo TCDS tàu bay",
      adMsnScope,
      matchedTypes: Array.from(matchedTypesSet),
      vjcMatchedSummary:
        vjcMatchedLabels.length > 0
          ? vjcMatchedLabels.join(" + ")
          : "Không khớp biến thể tàu bay / động cơ của VJC"
    };
  }

  // Client-side Verbatim AD Builder (Zero synthetic intervals/evaluations; copies text verbatim)
  function evaluateAdAgainstVjcFleet(rawDoc) {
    const docNum = rawDoc.document_number || String(Date.now());
    const pubDate = rawDoc.publication_date || new Date().toISOString().slice(0, 10);
    const effectiveDate = rawDoc.effective_on || pubDate;
    const title = rawDoc.title || "Airworthiness Directives";
    const abstract = rawDoc.abstract || "";
    const htmlUrl = rawDoc.html_url || "https://drs.faa.gov/";
    const pdfUrl =
      rawDoc.pdf_url || `https://www.govinfo.gov/content/pkg/FR-${pubDate}/pdf/${docNum}.pdf`;
    const fullTextHtmlUrl = `https://www.govinfo.gov/content/pkg/FR-${pubDate}/html/${docNum}.htm`;

    let officialFaaAd = "";
    let projectMcai = "";
    if (Array.isArray(rawDoc.docket_ids)) {
      rawDoc.docket_ids.forEach((dk) => {
        const s = String(dk || "");
        const mAd = s.match(/AD\s+([0-9]{4}-[0-9]{2}-[0-9]{2}[A-Z0-9\-]*)/i);
        if (mAd && !officialFaaAd) officialFaaAd = mAd[1];
        const mPrj = s.match(/Project Identifier\s+([A-Z0-9\-]+)/i);
        if (mPrj) projectMcai = mPrj[1];
      });
    }

    let easaMatch = abstract.match(/EASA\s+(?:Emergency\s+)?AD\s+([0-9]{4}-[0-9]{4}[A-Z0-9\-]*)/i);
    let easaAdNum = easaMatch ? `EASA AD ${easaMatch[1]}` : "";
    let faaAdNum = officialFaaAd ? `FAA AD ${officialFaaAd}` : `FAA FR-${docNum}`;
    let authority = easaAdNum ? "EASA" : "FAA";
    let authorityDual = easaAdNum ? "EASA / FAA" : "FAA";
    let displayAdNum =
      easaAdNum && officialFaaAd
        ? `${faaAdNum} / ${easaAdNum}`
        : officialFaaAd
        ? faaAdNum
        : easaAdNum
        ? `${easaAdNum} (${faaAdNum})`
        : faaAdNum;

    const parsed = parseExactModelsEnginesAndMsn(title, abstract);
    const uniqueFleet = fleetList.filter((f) => parsed.matchedTypes.includes(f.type));
    const isApplicable = uniqueFleet.length > 0;
    const applicabilityStatus = isApplicable ? "Applicable" : "Not Applicable";
    const targetModelStr = isApplicable ? parsed.vjcMatchedSummary : parsed.adExtractedModels;

    let ata = "05 - Airworthiness Limitations (ALS)";
    const ataMatch = (title + " " + abstract).match(/ATA\s*([0-9]{2})/i);
    if (ataMatch && ATA_CHAPTER_NAMES[ataMatch[1]]) {
      ata = `${ataMatch[1]} - ${ATA_CHAPTER_NAMES[ataMatch[1]]}`;
    } else if (/Nacelle Inlet Cowl|Powerplant|Nacelle|Fan Cowl/i.test(abstract)) {
      ata = "71 - Powerplant";
    } else if (/Engine|turbine|HPT|LPT|compressor|HPC|fan blade|borescope|rotor|hub|disk|IBR/i.test(title + " " + abstract)) {
      ata = "72 - Engine Turbine / Compressor / Rotor";
    } else if (/fuel|LPSOV|tank/i.test(abstract)) ata = "28 - Fuel System";
    else if (/flight control|FCPC|ELAC|elevator|flap|slat/i.test(abstract)) ata = "27 - Flight Controls";
    else if (/landing gear|MLG|NLG|bogie|brake/i.test(abstract)) ata = "32 - Landing Gear";
    else if (/door|cargo door|pax door|passenger door|emergency exit/i.test(abstract)) ata = "52 - Doors";
    else if (/overhead stowage|OHSC|slide|cabin|girt bar|seat|galley|lavatory/i.test(abstract)) ata = "25 - Equipment / Furnishings";
    else if (/radio management|RMP|navigation|radar/i.test(abstract)) ata = "34 - Navigation & Avionics";
    else if (/wing|wingtip|sharklet|spar|rib/i.test(abstract)) ata = "57 - Wings";
    else if (/fuselage|windshield|spigot|frame|crack|corrosion|stringer|bulkhead/i.test(abstract)) ata = "53 - Fuselage";
    else if (/pylon/i.test(abstract)) ata = "54 - Nacelles / Pylons";
    else if (/air conditioning/i.test(abstract)) ata = "21 - Air Conditioning";
    else if (/bleed|BMC|overpressure|pneumatic/i.test(abstract)) ata = "36 - Pneumatic";
    else if (/fire|extinguisher|cargo compartment|smoke/i.test(abstract)) ata = "26 - Fire Protection";
    else if (/hydraulic|actuator/i.test(abstract)) ata = "29 - Hydraulic Power";
    else if (/electrical|wiring|harness|generator/i.test(abstract)) ata = "24 - Electrical Power";
    else if (/oxygen/i.test(abstract)) ata = "35 - Oxygen";

    // Extract Superseded ADs with their own resolved PDF URL
    const supersededAds = [];
    const seenOld = new Set();
    if (/supersed/i.test(abstract)) {
      const regex = /(?:EASA\s+)?AD\s+([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{4}-[0-9]{4}[A-Z0-9\-]*)/gi;
      let m;
      while ((m = regex.exec(abstract)) !== null) {
        const oldNum = m[1].replace(/\s+/g, "");
        if (oldNum && oldNum !== officialFaaAd && !seenOld.has(oldNum)) {
          seenOld.add(oldNum);
          supersededAds.push({
            adNumber: `FAA AD ${oldNum}`,
            authority,
            issuedDate: oldNum.slice(0, 4),
            effectiveDate: "Superseded",
            supersededBy: displayAdNum,
            subject: `Airworthiness Directive ${oldNum} (Superseded by ${displayAdNum})`,
            summary: `Superseded AD ${oldNum} — Click "📎 PDF của FAA AD ${oldNum}" to view or download the original PDF of AD ${oldNum}.`,
            pdfUrl: `/api/resolve-ad-pdf?ad=${encodeURIComponent(oldNum)}`
          });
        }
      }
    }

    return {
      id: `AUTO-${docNum}`,
      docNumber: docNum,
      adNumber: displayAdNum,
      authority,
      authorityDual,
      adClass: "Final Rule AD",
      issueDate: pubDate,
      issuedDate: pubDate,
      effectiveDate,
      ata,
      category: /Engine/i.test(title) ? "Engine" : "Aircraft",
      targetModel: targetModelStr,
      adExtractedModels: parsed.adExtractedModels,
      adExtractedEngines: parsed.adExtractedEngines,
      adMsnScope: parsed.adMsnScope,
      vjcMatchedSummary: parsed.vjcMatchedSummary,
      matchedTypes: parsed.matchedTypes,
      tcHolder: title,
      subject: title, // Keep 100% Verbatim Title
      summary: abstract || title, // Keep 100% Verbatim Abstract/Text
      applicabilityStatus,
      affectedCount: uniqueFleet.length,
      affectedFleet: uniqueFleet.map((ac) => ({
        reg: ac.reg,
        msn: ac.msn,
        type: ac.type,
        engine: ac.engine
      })),
      hasSupersededAds: supersededAds.length > 0,
      supersededCount: supersededAds.length,
      supersededAds,
      sourceUrl: htmlUrl,
      pdfUrl,
      fullTextHtmlUrl
    };
  }

  function renderBiweeklyBannerNotice(modeNote = "") {
    const bannerTitle = document.getElementById("autoBannerTitle");
    const bannerDesc = document.getElementById("autoBannerDesc");
    let totalSup = 0;
    adList.forEach((a) => (totalSup += (a.supersededAds || []).length));

    if (lastBiweeklyReport && lastBiweeklyReport.biweeklyLabel) {
      const r = lastBiweeklyReport;
      const cursorMatch = String(r.biweeklyLabel || "").match(/\b(20\d{2}-\d{2})\b/g);
      const cursorCode =
        r.lastCompletedBiweekly ||
        (cursorMatch && cursorMatch.length > 0 ? cursorMatch[cursorMatch.length - 1] : "") ||
        (r.windowEnd ? getBiweeklyPeriodInfo(new Date(`${r.windowEnd}T00:00:00`)).code : "");
      const seqNote =
        Array.isArray(r.biweeklySequence) && r.biweeklySequence.length > 1
          ? ` (Nối tiếp ${r.biweeklySequence[0]} → ${r.biweeklySequence[r.biweeklySequence.length - 1]})`
          : "";
      if (bannerTitle) {
        bannerTitle.textContent = `📅 Đã quét ${r.biweeklyLabel} (${r.windowStart} → ${r.windowEnd}): Cập nhật +${r.faaAdded || 0} FAA AD mới (${r.faaUpdated || 0} chỉnh sửa) & +${r.easaAdded || 0} EASA AD mới (${r.easaUpdated || 0} chỉnh sửa)`;
      }
      if (bannerDesc) {
        bannerDesc.innerHTML = `${
          cursorCode ? `Mốc Biweekly cuối: <strong>${escapeHtml(cursorCode)}</strong>${escapeHtml(seqNote)} • ` : ""
        }Lần quét gần nhất: <strong>${escapeHtml(
          r.scannedAt || lastSyncedAt
        )}</strong> (FAA quét ${r.faaScanned || 0} • EASA quét ${r.easaScanned || 0})${escapeHtml(
          modeNote
        )} • Tổng CSDL: <strong>${adList.length.toLocaleString()} AD hiện hành + ${totalSup} AD Superseded</strong> • Đội bay VJC: <strong>${
          fleetList.length
        } tàu</strong>.`;
      }
      return;
    }

    if (bannerTitle) {
      bannerTitle.textContent = `✅ Đã đồng bộ (${lastSyncedAt}${modeNote}): ${fleetList.length} tàu bay VJC • ${adList.length} AD hiện hành + ${totalSup} AD Superseded`;
    }
  }

  function saveToLocalStorage() {
    try {
      const compactAds = adList.map((a) => {
        const copy = Object.assign({}, a);
        delete copy.affectedFleet;
        return copy;
      });
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ lastSyncedAt, lastBiweeklyReport, fleet: fleetList, ads: compactAds })
      );
    } catch (e) {}
  }

  // Load Database from Server `./api/db` or Static Fallback `./db/aeroad-database.json` (GitHub Pages)
  async function loadDatabaseFromServer() {
    for (const dbUrl of ["./api/db", "./db/aeroad-database.json"]) {
      try {
        const resp = await fetch(dbUrl);
        if (resp.ok) {
          const db = await resp.json();
          if (db && Array.isArray(db.ads) && db.ads.length > 0) {
            fleetList = db.fleet || fleetList;
            adList = db.ads;
            lastSyncedAt =
              db.lastSyncedAt ||
              (db.metadata && db.metadata.lastSyncedAt) ||
              new Date().toLocaleString("vi-VN");
            lastFleetScanReport = db.lastFleetScanReport || null;
            lastBiweeklyReport = db.lastBiweeklyReport || null;
            hydrateAdsWithFleet();
            const modeNote = dbUrl.includes("aeroad-database.json") ? " • Static/GitHub Pages" : "";
            renderBiweeklyBannerNotice(modeNote);
            refreshAllViews();
            return;
          }
        }
      } catch (e) {
        console.info(`DB load fallback from ${dbUrl}:`, e);
      }
    }

    // Fallback: try localStorage cache if network unavailable
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        const db = JSON.parse(cached);
        if (db && Array.isArray(db.ads) && db.ads.length > 0) {
          fleetList = db.fleet || fleetList;
          adList = db.ads;
          lastSyncedAt = db.lastSyncedAt || lastSyncedAt;
          lastBiweeklyReport = db.lastBiweeklyReport || null;
          hydrateAdsWithFleet();
          renderBiweeklyBannerNotice(" • Offline Cache");
          refreshAllViews();
        }
      }
    } catch (e) {}
  }

  async function persistDatabase() {
    let totalSupCnt = 0;
    adList.forEach((a) => {
      totalSupCnt += (a.supersededAds || []).length;
    });

    const compactAds = adList.map((a) => {
      const copy = Object.assign({}, a);
      delete copy.affectedFleet;
      return copy;
    });

    const dbPayload = {
      lastSyncedAt,
      lastBiweeklyReport,
      lastFleetScanReport,
      operator: "VietJet Aviation Joint Stock Company (VJC)",
      fleetCount: fleetList.length,
      totalAds: adList.length,
      totalAllAdsIncludingSuperseded: adList.length + totalSupCnt,
      applicableCount: adList.filter((a) => a.applicabilityStatus === "Applicable").length,
      notApplicableCnt: adList.filter((a) => a.applicabilityStatus !== "Applicable").length,
      supersedingAdCount: adList.filter((a) => (a.supersededAds || []).length > 0).length,
      supersededTotalCnt: totalSupCnt,
      fleet: fleetList,
      ads: compactAds
    };

    saveToLocalStorage();
    try {
      await fetch("./api/db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dbPayload)
      });
    } catch (e) {}
  }

  // Rescan VJC Fleet from CAAV Certificate Folder & Optional New Aircraft Payload
  function renderFleetScanReportHtml(rep) {
    const box = document.getElementById("fleetScanReportContent");
    if (!box) return;
    const c214 = fleetList.filter((f) => f.type === "A320-214").length;
    const c211 = fleetList.filter((f) => f.type === "A321-211").length;
    const c271n = fleetList.filter((f) => f.type === "A321-271N").length;
    const c271nx = fleetList.filter((f) => f.type === "A321-271NX").length;
    const c330 = fleetList.filter((f) => f.type === "A330-343").length;

    const newList = rep && Array.isArray(rep.newlyDiscovered) ? rep.newlyDiscovered : [];
    const updList = rep && Array.isArray(rep.updatedAircraft) ? rep.updatedAircraft : [];

    box.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
        <span class="badge status-closed">Tổng đội bay VJC: ${fleetList.length} tàu</span>
        <span class="badge badge-standard">A320-214: ${c214} tàu</span>
        <span class="badge badge-standard">A321-211 CEO: ${c211} tàu</span>
        <span class="badge badge-standard">A321-271N NEO: ${c271n} tàu</span>
        <span class="badge badge-standard">A321-271NX NEO ACF: ${c271nx} tàu</span>
        <span class="badge badge-standard">A330-343: ${c330} tàu</span>
      </div>
      <div style="font-size:12.5px;color:var(--text-secondary);">
        • Thư mục chứng chỉ CAAV đã quét: <code>${escapeHtml(
          (rep && rep.certFolderScanned) || "G:\\My Drive\\VJC Certificate\\VJC Aircraft"
        )}</code> (${(rep && rep.scannedFoldersCount) || 102} thư mục tàu bay • Thời điểm: ${escapeHtml(
      (rep && rep.scannedAt) || lastSyncedAt
    )})
      </div>
      ${
        newList.length > 0
          ? `<div style="margin-top:6px;padding:6px 10px;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.4);border-radius:6px;color:#34d399;font-weight:600;">
               ✨ Phát hiện &amp; thêm mới ${newList.length} tàu bay: ${escapeHtml(newList.join(", "))}
             </div>`
          : `<div style="margin-top:4px;font-size:12px;color:#6ee7b7;">
               ✔ Toàn bộ ${fleetList.length} tàu bay trong thư mục chứng chỉ CAAV đã đồng bộ đầy đủ. Bạn có thể thêm nhanh tàu bay mới nhận ở biểu mẫu bên dưới.
             </div>`
      }
      ${
        updList.length > 0
          ? `<div style="margin-top:6px;padding:6px 10px;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.4);border-radius:6px;color:#93c5fd;font-weight:600;">
               🔄 Đã cập nhật cấu hình ${updList.length} tàu bay: ${escapeHtml(updList.join(", "))}
             </div>`
          : ""
      }
    `;
  }

  function parseCsvRow(line) {
    const out = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  }

  function colLettersToIndex(letters) {
    let idx = 0;
    for (let i = 0; i < letters.length; i++) {
      idx = idx * 26 + (letters.charCodeAt(i) - 64);
    }
    return idx - 1;
  }

  async function parseXlsxBufferToRows(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    // Locate End of Central Directory (0x06054b50)
    let eocdOffset = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset < 0) throw new Error("Invalid XLSX/ZIP file");

    const cdSize = view.getUint32(eocdOffset + 12, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    const entries = {};
    const dec = new TextDecoder("utf-8");

    let ptr = cdOffset;
    while (ptr < cdOffset + cdSize && ptr + 46 <= bytes.length) {
      if (view.getUint32(ptr, true) !== 0x02014b50) break;
      const method = view.getUint16(ptr + 10, true);
      const compSize = view.getUint32(ptr + 20, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localHeaderOffset = view.getUint32(ptr + 42, true);
      const name = dec.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
      entries[name] = { method, compSize, localHeaderOffset };
      ptr += 46 + nameLen + extraLen + commentLen;
    }

    async function readZipText(name) {
      const ent = entries[name];
      if (!ent) return null;
      const lh = ent.localHeaderOffset;
      if (view.getUint32(lh, true) !== 0x04034b50) return null;
      const lhNameLen = view.getUint16(lh + 26, true);
      const lhExtraLen = view.getUint16(lh + 28, true);
      const dataStart = lh + 30 + lhNameLen + lhExtraLen;
      const compSlice = bytes.subarray(dataStart, dataStart + ent.compSize);
      if (ent.method === 0) return dec.decode(compSlice);
      if (ent.method === 8) {
        if (typeof DecompressionStream === "undefined") {
          throw new Error("Trình duyệt chưa hỗ trợ DecompressionStream deflate-raw");
        }
        const ds = new DecompressionStream("deflate-raw");
        return await new Response(new Blob([compSlice]).stream().pipeThrough(ds)).text();
      }
      return null;
    }

    const xmlParser = new DOMParser();
    const sharedStrings = [];
    const ssXmlStr = await readZipText("xl/sharedStrings.xml");
    if (ssXmlStr) {
      const ssDoc = xmlParser.parseFromString(ssXmlStr, "application/xml");
      ssDoc.querySelectorAll("si").forEach((si) => {
        const ts = Array.from(si.querySelectorAll("t")).map((t) => t.textContent || "");
        sharedStrings.push(ts.join(""));
      });
    }

    const sheetNames = Object.keys(entries)
      .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (sheetNames.length === 0) return [];

    const sheetXmlStr = await readZipText(sheetNames[0]);
    if (!sheetXmlStr) return [];
    const sheetDoc = xmlParser.parseFromString(sheetXmlStr, "application/xml");
    const rows = [];
    sheetDoc.querySelectorAll("sheetData > row").forEach((rowEl) => {
      const rowArr = [];
      rowEl.querySelectorAll("c").forEach((cEl) => {
        const ref = cEl.getAttribute("r") || "";
        const mCol = ref.match(/^([A-Z]+)/i);
        const colIndex = mCol ? colLettersToIndex(mCol[1].toUpperCase()) : rowArr.length;
        const type = cEl.getAttribute("t") || "";
        let val = "";
        if (type === "s") {
          const vEl = cEl.querySelector("v");
          val = vEl ? sharedStrings[Number(vEl.textContent)] || "" : "";
        } else if (type === "inlineStr") {
          const ts = Array.from(cEl.querySelectorAll("is t")).map((t) => t.textContent || "");
          val = ts.join("");
        } else {
          const vEl = cEl.querySelector("v");
          val = vEl ? vEl.textContent || "" : "";
        }
        while (rowArr.length <= colIndex) rowArr.push("");
        rowArr[colIndex] = val.trim();
      });
      if (rowArr.some((x) => x !== "")) rows.push(rowArr);
    });
    return rows;
  }

  function parseHtmlTableToRows(htmlText) {
    const doc = new DOMParser().parseFromString(htmlText, "text/html");
    const rows = [];
    doc.querySelectorAll("tr").forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll("th, td")).map((td) =>
        (td.textContent || "").replace(/\s+/g, " ").trim()
      );
      if (cells.some((c) => c !== "")) rows.push(cells);
    });
    return rows;
  }

  function parseFleetRows(rows, sourceLabel = "File Import") {
    if (!Array.isArray(rows) || rows.length < 2) return [];

    let headerIdx = -1;
    let headers = [];
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const cols = rows[i].map((h) => String(h || "").trim().toLowerCase());
      if (cols.some((c) => c.includes("a/c register") || c === "reg" || c.includes("registration"))) {
        headerIdx = i;
        headers = cols;
        break;
      }
    }
    if (headerIdx < 0) return [];

    const colIdx = (patterns) => headers.findIndex((h) => patterns.some((p) => h.includes(p)));
    const idxReg = colIdx(["a/c register", "registration", "reg"]);
    const idxDesc = colIdx(["description"]);
    const idxType = colIdx(["a/c type", "aircraft type"]);
    const idxModel = colIdx(["a/c model", "model"]);
    const idxSub = colIdx(["a/c sub-type", "sub-type", "subtype", "variant"]);
    const idxMsn = colIdx(["aircraft serial", "serial no", "msn"]);
    const idxBase = colIdx(["base"]);
    const idxStatus = colIdx(["status"]);
    const idxEngModel = colIdx(["engine model", "engine"]);
    const idxOwner = colIdx(["owner"]);
    const idxAmp = colIdx(["maintenance program"]);
    const idxCabin = colIdx(["cabin version"]);

    const prevMap = new Map(fleetList.map((ac) => [String(ac.reg || "").toUpperCase(), ac]));
    const parsedFleet = [];
    const seenRegs = new Set();

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const cols = rows[i];
      const rawReg = String((idxReg >= 0 ? cols[idxReg] : cols[0]) || "").trim().toUpperCase();
      if (!rawReg || rawReg === "A/C TYPE" || rawReg === "TOTAL" || rawReg.startsWith("NGUỒN")) {
        break;
      }
      if (!/^(?:VN-)?[A-Z]\d{3,4}$/i.test(rawReg)) continue;

      const reg = rawReg.startsWith("VN-") ? rawReg : `VN-${rawReg}`;
      if (seenRegs.has(reg)) continue;
      seenRegs.add(reg);

      const rawMsn = idxMsn >= 0 ? cols[idxMsn] : "";
      const desc = idxDesc >= 0 ? cols[idxDesc] : "";
      let msn = String(rawMsn || "").trim().replace(/\.0$/, "");
      if (!msn && desc) {
        const mm = String(desc).match(/MSN\s*0*([0-9]{3,5})/i);
        if (mm) msn = mm[1];
      }
      if (/^\d+$/.test(msn) && msn.length < 4) msn = msn.padStart(4, "0");

      const acTypeCol = String((idxType >= 0 ? cols[idxType] : "") || "").trim().toUpperCase();
      const acModelCol = String((idxModel >= 0 ? cols[idxModel] : "") || "").trim().toUpperCase();
      const acSubCol = String((idxSub >= 0 ? cols[idxSub] : "") || "").trim().toUpperCase();

      let family = "A321";
      const famMatch = `${acTypeCol} ${acModelCol}`.match(/(A320|A321|A330|A350|B737|737)/);
      if (famMatch) family = famMatch[1] === "737" ? "B737" : famMatch[1];

      let subCode = acSubCol || (acModelCol.startsWith("-") ? acModelCol : "");
      subCode = subCode.replace(/^-343S$/, "-343");
      const fullType = subCode.startsWith("-")
        ? `${family}${subCode}`
        : acModelCol && acModelCol.includes("-")
        ? acModelCol
        : family === "A320"
        ? "A320-214"
        : family === "A330"
        ? "A330-343"
        : "A321-211";

      const engine = String((idxEngModel >= 0 ? cols[idxEngModel] : "") || "").trim() || "CFM56-5B3/P";
      const base = String((idxBase >= 0 ? cols[idxBase] : "") || "").trim() || "SGN";
      const status = String((idxStatus >= 0 ? cols[idxStatus] : "") || "").trim() || "Active";
      const prev = prevMap.get(reg);

      parsedFleet.push({
        reg,
        msn: msn || (prev ? prev.msn : ""),
        type: fullType,
        family,
        engine,
        fh: prev && prev.fh ? prev.fh : 1200,
        fc: prev && prev.fc ? prev.fc : 720,
        base,
        status,
        owner: idxOwner >= 0 ? String(cols[idxOwner] || "") : "",
        cabinVersion: idxCabin >= 0 ? String(cols[idxCabin] || "") : "",
        amp: idxAmp >= 0 ? String(cols[idxAmp] || "") : "",
        certSource: sourceLabel
      });
    }
    return parsedFleet;
  }

  function parseFleetCsvText(csvText) {
    const clean = String(csvText || "").replace(/^\uFEFF/, "");
    const lines = clean.split(/\r?\n/).filter((l) => l.trim() !== "");
    return parseFleetRows(
      lines.map((l) => parseCsvRow(l)),
      "CSV Fleet Import"
    );
  }

  async function importFleetFromCsvFile(file) {
    if (!requireAdmin() || !file) return;
    try {
      const lower = file.name.toLowerCase();
      let imported = [];
      if (lower.endsWith(".xlsx")) {
        const buf = await file.arrayBuffer();
        const rows = await parseXlsxBufferToRows(buf);
        imported = parseFleetRows(rows, `Excel Import: ${file.name}`);
      } else {
        const text = await file.text();
        if (lower.endsWith(".xls") && !/<(table|tr|html|workbook)/i.test(text.slice(0, 600))) {
          // Binary .xls fallback via local PowerShell server if available
          try {
            const resp = await fetch(`./api/parse-fleet-excel?fileName=${encodeURIComponent(file.name)}`, {
              method: "POST",
              body: file
            });
            if (resp.ok) {
              const res = await resp.json();
              if (Array.isArray(res.rows)) imported = parseFleetRows(res.rows, `Excel Import: ${file.name}`);
            }
          } catch (e) {}
          if (imported.length === 0) {
            showToast("⚠️ File .xls định dạng cũ — vui lòng lưu lại dưới dạng .xlsx hoặc .csv rồi chọn lại.");
            return;
          }
        } else if (/<(table|tr|html)/i.test(text.slice(0, 800))) {
          imported = parseFleetRows(parseHtmlTableToRows(text), `Excel Import: ${file.name}`);
        } else {
          imported = parseFleetCsvText(text);
        }
      }

      if (!imported || imported.length === 0) {
        showToast("⚠️ Không đọc được danh sách tàu bay hợp lệ. Kiểm tra cột A/C Register & Aircraft Serial No.");
        return;
      }

      const prevRegs = new Set(fleetList.map((f) => String(f.reg || "").toUpperCase()));
      const newRegs = imported.filter((f) => !prevRegs.has(f.reg.toUpperCase())).map((f) => f.reg);

      fleetList = imported;
      lastSyncedAt = new Date().toLocaleString("vi-VN");
      lastFleetScanReport = {
        certFolderScanned: `File: ${file.name}`,
        scannedFoldersCount: imported.length,
        scannedAt: lastSyncedAt,
        newlyDiscovered: newRegs,
        updatedRegs: []
      };

      hydrateAdsWithFleet();
      await persistDatabase();
      refreshAllViews();
      renderFleetScanReportHtml(lastFleetScanReport);

      const bannerTitle = document.getElementById("autoBannerTitle");
      let totalSup = 0;
      adList.forEach((a) => (totalSup += (a.supersededAds || []).length));
      if (bannerTitle) {
        bannerTitle.textContent = `✅ Đã đọc file "${file.name}" (${lastSyncedAt}): ${fleetList.length} tàu bay VJC • ${adList.length} AD hiện hành + ${totalSup} AD Superseded!`;
      }
      const modal = document.getElementById("fleetRescanModal");
      if (modal) modal.classList.add("open");
      showToast(`✅ Đã đọc ${fleetList.length} tàu bay từ "${file.name}" (${newRegs.length} tàu mới) & cập nhật Applicability!`);
    } catch (err) {
      console.error("Fleet import error:", err);
      showToast("⚠️ Lỗi đọc file Excel/CSV đội tàu.");
    }
  }

  async function rescanVjcFleet(newAircraftObj, openModalAfter) {
    if (!requireAdmin()) return;
    showToast("✈️ Đang quét lại Đội tàu bay VJC từ thư mục Chứng chỉ CAAV & cập nhật tàu bay mới...");
    try {
      const resp = await fetch("/api/rescan-fleet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: newAircraftObj ? JSON.stringify(newAircraftObj) : ""
      });
      if (resp.ok) {
        const db = await resp.json();
        fleetList = db.fleet || fleetList;
        adList = db.ads || adList;
        lastSyncedAt = db.lastSyncedAt || new Date().toLocaleString("vi-VN");
        lastFleetScanReport = db.lastFleetScanReport || null;
        hydrateAdsWithFleet();
        populateAircraftDropdowns();
        populateAdAtaDropdown();
        populateApplianceAtaDropdown();
        refreshAllViews();
        renderFleetScanReportHtml(lastFleetScanReport);

        const bannerTitle = document.getElementById("autoBannerTitle");
        let totalSup = 0;
        adList.forEach((a) => (totalSup += (a.supersededAds || []).length));
        if (bannerTitle) {
          bannerTitle.textContent = `✅ Đã quét Đội bay VJC (${lastSyncedAt}): ${fleetList.length} tàu bay VJC • ${adList.length} AD hiện hành + ${totalSup} AD Superseded!`;
        }

        showToast(
          `✅ Đã quét lại Đội tàu VJC (${fleetList.length} tàu bay chuẩn MSN/Động cơ CAAV) & cập nhật Dropdown chọn tàu!`
        );

        if (openModalAfter) {
          const modal = document.getElementById("fleetRescanModal");
          if (modal) modal.classList.add("open");
        }
        return;
      }
    } catch (e) {
      console.error("Rescan fleet error:", e);
      showToast("⚠️ Không thể kết nối API quét đội tàu.");
    }
  }

  function formatLocalIsoDate(dt) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function getBiweeklyPeriodInfo(dt) {
    const local = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    const startOfYear = new Date(local.getFullYear(), 0, 1);
    const dayOfYear = Math.floor((local - startOfYear) / 86400000) + 1;
    const period = Math.min(26, Math.max(1, Math.ceil(dayOfYear / 14)));
    const startDate = new Date(local.getFullYear(), 0, 1 + (period - 1) * 14);
    const endDate =
      period < 26
        ? new Date(local.getFullYear(), 0, 1 + period * 14 - 1)
        : new Date(local.getFullYear(), 11, 31);
    return {
      year: local.getFullYear(),
      period,
      code: `${local.getFullYear()}-${String(period).padStart(2, "0")}`,
      startDate,
      endDate
    };
  }

  function parseBiweeklyPeriodCode(code) {
    const m = String(code || "").match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    const year = Number(m[1]);
    const period = Math.min(26, Math.max(1, Number(m[2])));
    const startDate = new Date(year, 0, 1 + (period - 1) * 14);
    const endDate =
      period < 26 ? new Date(year, 0, 1 + period * 14 - 1) : new Date(year, 11, 31);
    return {
      year,
      period,
      code: `${year}-${String(period).padStart(2, "0")}`,
      startDate,
      endDate
    };
  }

  function getNextBiweeklyCode(code) {
    const info = parseBiweeklyPeriodCode(code);
    if (!info) return "";
    if (info.period < 26) {
      return `${info.year}-${String(info.period + 1).padStart(2, "0")}`;
    }
    return `${info.year + 1}-01`;
  }

  function getBiweeklySequence(startCode, endCode) {
    const seq = [];
    let cur = startCode;
    let guard = 0;
    while (cur && cur <= endCode && guard < 52) {
      const obj = parseBiweeklyPeriodCode(cur);
      if (!obj) break;
      seq.push(obj);
      if (cur === endCode) break;
      cur = getNextBiweeklyCode(cur);
      guard++;
    }
    return seq;
  }

  function buildIncrementalBiweeklyPlan(prevReport, now = new Date()) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const currentBw = getBiweeklyPeriodInfo(today);
    const windowEnd = formatLocalIsoDate(today);

    let lastRecordedBwCode = "";
    let lastScannedDate = null;
    if (prevReport) {
      if (prevReport.lastCompletedBiweekly && /^\d{4}-\d{2}$/.test(prevReport.lastCompletedBiweekly)) {
        lastRecordedBwCode = String(prevReport.lastCompletedBiweekly);
      } else if (prevReport.biweeklyLabel) {
        const bwMatches = String(prevReport.biweeklyLabel).match(/\b(20\d{2}-\d{2})\b/g);
        if (bwMatches && bwMatches.length > 0) {
          lastRecordedBwCode = bwMatches[bwMatches.length - 1];
        }
      }
      const rawLastDate = String(prevReport.lastScannedDate || prevReport.windowEnd || "").trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawLastDate)) {
        lastScannedDate = new Date(`${rawLastDate}T00:00:00`);
        if (!lastRecordedBwCode && !Number.isNaN(lastScannedDate.getTime())) {
          lastRecordedBwCode = getBiweeklyPeriodInfo(lastScannedDate).code;
        }
      }
    }

    const periods = [];
    if (lastRecordedBwCode && lastRecordedBwCode <= currentBw.code) {
      const lastBwInfo = parseBiweeklyPeriodCode(lastRecordedBwCode);
      if (lastRecordedBwCode === currentBw.code) {
        let scanFrom = lastScannedDate
          ? new Date(lastScannedDate.getTime() - 3 * 86400000)
          : new Date(currentBw.startDate.getTime());
        const minCur = new Date(currentBw.startDate.getTime() - 3 * 86400000);
        if (scanFrom < minCur) scanFrom = new Date(currentBw.startDate.getTime());
        if (scanFrom > today) scanFrom = today;
        periods.push({
          code: currentBw.code,
          scanStart: formatLocalIsoDate(scanFrom),
          scanEnd: windowEnd
        });
      } else {
        if (lastBwInfo) {
          let tailStart = lastScannedDate
            ? new Date(lastScannedDate.getTime() - 3 * 86400000)
            : new Date(lastBwInfo.startDate.getTime());
          if (tailStart < lastBwInfo.startDate) tailStart = new Date(lastBwInfo.startDate.getTime());
          if (tailStart <= lastBwInfo.endDate) {
            periods.push({
              code: lastBwInfo.code,
              scanStart: formatLocalIsoDate(tailStart),
              scanEnd: formatLocalIsoDate(lastBwInfo.endDate)
            });
          }
        }
        const nextCode = getNextBiweeklyCode(lastRecordedBwCode);
        getBiweeklySequence(nextCode, currentBw.code).forEach((p) => {
          const pEnd = p.endDate > today ? today : p.endDate;
          periods.push({
            code: p.code,
            scanStart: formatLocalIsoDate(p.startDate),
            scanEnd: formatLocalIsoDate(pEnd)
          });
        });
      }
    } else {
      const fallbackStart = new Date(today.getTime() - 28 * 86400000);
      const startBwInfo = getBiweeklyPeriodInfo(fallbackStart);
      getBiweeklySequence(startBwInfo.code, currentBw.code).forEach((p) => {
        const pStart =
          p.code === startBwInfo.code && fallbackStart > p.startDate ? fallbackStart : p.startDate;
        const pEnd = p.endDate > today ? today : p.endDate;
        periods.push({
          code: p.code,
          scanStart: formatLocalIsoDate(pStart),
          scanEnd: formatLocalIsoDate(pEnd)
        });
      });
    }

    const windowStart = periods[0].scanStart;
    const firstCode = periods[0].code;
    const lastCode = periods[periods.length - 1].code;
    const biweeklyLabel =
      firstCode === lastCode
        ? `Biweekly ${lastCode}`
        : `Biweekly ${firstCode} → ${lastCode} (${periods.length} kỳ)`;

    return {
      previousBiweekly: lastRecordedBwCode,
      currentBiweekly: currentBw.code,
      periods,
      windowStart,
      windowEnd,
      biweeklyLabel
    };
  }

  async function runBiweeklyAdSync() {
    if (!requireAdmin()) return;
    const plan = buildIncrementalBiweeklyPlan(lastBiweeklyReport, new Date());
    const fallbackBwLabel = plan.biweeklyLabel;
    const windowStart = plan.windowStart;
    const windowEnd = plan.windowEnd;
    const resumeNote = plan.previousBiweekly
      ? `Từ mốc ${plan.previousBiweekly} → ${plan.currentBiweekly}`
      : fallbackBwLabel;

    const bannerTitle = document.getElementById("autoBannerTitle");
    if (bannerTitle) {
      bannerTitle.textContent = `⏳ Đang quét nối tiếp ${resumeNote} (${windowStart} → ${windowEnd}) & cập nhật CSDL...`;
    }
    showToast(`🔄 Đang quét AD ${resumeNote} từ EASA Archive & FAA Federal Register...`);

    try {
      const resp = await fetch("./api/sync-biweekly", { method: "POST" });
      if (resp.ok) {
        const db = await resp.json();
        if (db && Array.isArray(db.ads) && db.ads.length > 0) {
          adList = db.ads;
          lastSyncedAt = db.lastSyncedAt || new Date().toLocaleString("vi-VN");
          lastBiweeklyReport = db.lastBiweeklyReport || {
            biweeklyLabel: fallbackBwLabel,
            previousBiweekly: plan.previousBiweekly,
            lastCompletedBiweekly: plan.currentBiweekly,
            lastScannedDate: windowEnd,
            biweeklySequence: plan.periods.map((p) => p.code),
            windowStart,
            windowEnd,
            scannedAt: lastSyncedAt,
            faaScanned: 0,
            faaAdded: 0,
            faaUpdated: 0,
            easaScanned: 0,
            easaAdded: 0,
            easaUpdated: 0
          };
          hydrateAdsWithFleet();
          renderBiweeklyBannerNotice();
          refreshAllViews();
          const r = lastBiweeklyReport;
          showToast(
            `✅ Đã quét ${r.biweeklyLabel} (mốc cuối: ${r.lastCompletedBiweekly || plan.currentBiweekly}): +${r.faaAdded} FAA AD (${r.faaUpdated} cập nhật) & +${r.easaAdded} EASA AD (${r.easaUpdated} cập nhật)!`
          );
          return;
        }
      }
    } catch (e) {}

    // Client-side Federal Register incremental biweekly scan fallback (for static GitHub Pages)
    try {
      const existingDocNums = new Set(adList.map((a) => String(a.docNumber || "")).filter(Boolean));
      const existingFaaNums = new Set(adList.map((a) => String(a.officialFaaAd || "")).filter(Boolean));
      let faaScanned = 0;
      let faaAdded = 0;
      let easaAdded = 0;
      const perBiweeklyStats = [];

      for (const period of plan.periods) {
        let pFaaScanned = 0;
        let pFaaAdded = 0;
        let pEasaAdded = 0;
        let nextUrl = `https://www.federalregister.gov/api/v1/documents.json?per_page=100&order=newest&conditions%5Bagencies%5D%5B%5D=federal-aviation-administration&conditions%5Btype%5D%5B%5D=RULE&conditions%5Bterm%5D=%22Airworthiness%20Directives%22&conditions%5Bpublication_date%5D%5Bgte%5D=${period.scanStart}&conditions%5Bpublication_date%5D%5Blte%5D=${period.scanEnd}&fields%5B%5D=document_number&fields%5B%5D=title&fields%5B%5D=publication_date&fields%5B%5D=effective_on&fields%5B%5D=pdf_url&fields%5B%5D=html_url&fields%5B%5D=abstract&fields%5B%5D=docket_ids`;
        let pageGuard = 0;
        while (nextUrl && pageGuard < 5) {
          pageGuard++;
          const frResp = await fetch(nextUrl);
          if (!frResp.ok) break;
          const data = await frResp.json();
          const allResults = data.results || [];
          pFaaScanned += allResults.length;
          faaScanned += allResults.length;
          const docs = allResults.filter((d) => String(d.title || "").includes("Airworthiness Directives"));
          docs.forEach((doc) => {
            const ev = evaluateAdAgainstVjcFleet(doc);
            const dupDoc = doc.document_number && existingDocNums.has(String(doc.document_number));
            const dupFaa = ev.officialFaaAd && existingFaaNums.has(String(ev.officialFaaAd));
            if (!dupDoc && !dupFaa) {
              adList.unshift(ev);
              if (doc.document_number) existingDocNums.add(String(doc.document_number));
              if (ev.officialFaaAd) existingFaaNums.add(String(ev.officialFaaAd));
              if (ev.easaAdNumber) {
                easaAdded++;
                pEasaAdded++;
              }
              faaAdded++;
              pFaaAdded++;
            }
          });
          nextUrl = data.next_page_url || "";
        }
        perBiweeklyStats.push({
          biweekly: period.code,
          windowStart: period.scanStart,
          windowEnd: period.scanEnd,
          faaScanned: pFaaScanned,
          faaAdded: pFaaAdded,
          faaUpdated: 0,
          easaScanned: pEasaAdded,
          easaAdded: pEasaAdded,
          easaUpdated: 0
        });
      }

      lastSyncedAt = new Date().toLocaleString("vi-VN");
      lastBiweeklyReport = {
        biweeklyLabel: fallbackBwLabel,
        previousBiweekly: plan.previousBiweekly,
        lastCompletedBiweekly: plan.currentBiweekly,
        lastScannedDate: windowEnd,
        biweeklySequence: plan.periods.map((p) => p.code),
        perBiweeklyStats,
        windowStart,
        windowEnd,
        scannedAt: lastSyncedAt,
        faaScanned,
        faaAdded,
        faaUpdated: 0,
        easaScanned: easaAdded,
        easaAdded,
        easaUpdated: 0
      };
      hydrateAdsWithFleet();
      saveToLocalStorage();
      renderBiweeklyBannerNotice(" • Federal Register Live");
      refreshAllViews();
      showToast(
        `✅ Đã quét ${fallbackBwLabel} (mốc cuối: ${plan.currentBiweekly}): +${faaAdded} FAA AD (kèm ${easaAdded} EASA liên quan)!`
      );
    } catch (err) {
      showToast("⚠️ Không thể kết nối cổng dữ liệu Biweekly lúc này.");
    }
  }

  // Update KPI Cards
  function updateKpis() {
    const total = adList.length;
    const applicable = adList.filter((a) => a.applicabilityStatus === "Applicable").length;
    const notApplicable = adList.filter((a) => a.applicabilityStatus !== "Applicable").length;

    let supersededCount = 0;
    let supersedingGroups = 0;
    adList.forEach((a) => {
      if (Array.isArray(a.supersededAds) && a.supersededAds.length > 0) {
        supersedingGroups++;
        supersededCount += a.supersededAds.length;
      }
    });

    document.getElementById("kpiTotal").textContent = `${total.toLocaleString()} (+${supersededCount})`;
    document.getElementById("navCountTotal").textContent = total + supersededCount;
    document.getElementById("kpiApplicable").textContent = applicable.toLocaleString();
    document.getElementById("navCountEvaluations").textContent = applicable;
    document.getElementById("kpiNotApplicable").textContent = notApplicable.toLocaleString();

    const supEl = document.getElementById("kpiSuperseded");
    const supSubEl = document.getElementById("kpiSupersededSub");
    if (supEl) supEl.textContent = supersededCount.toLocaleString();
    if (supSubEl) supSubEl.textContent = `Gom trong ${supersedingGroups} Dropdown (Có PDF riêng)`;

    document.getElementById("kpiFleetCount").textContent = fleetList.length;
    document.getElementById("navCountFleet").textContent = fleetList.length;
    const hFleet = document.getElementById("headerFleetCount");
    if (hFleet) hFleet.textContent = fleetList.length;
    const navTabFleet = document.getElementById("navTabFleetTitleCount");
    if (navTabFleet) navTabFleet.textContent = fleetList.length;
    const fleetSumBadge = document.getElementById("fleetSummaryBadge");
    if (fleetSumBadge) fleetSumBadge.textContent = `${fleetList.length} Tàu bay`;
    document.getElementById("lastSyncTimestamp").textContent = `Đồng bộ lần cuối: ${lastSyncedAt} (${
      total + supersededCount
    } tổng AD)`;
  }

  // Filter & Sort AD List
  function getSortDateKey(ad) {
    const eff = String((ad && ad.effectiveDate) || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(eff)) return eff;
    const iss = String((ad && (ad.issuedDate || ad.issueDate)) || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(iss)) return iss;
    return eff;
  }

  function renderEffectiveDateTextHtml(rawEff, defaultColor = "var(--text-primary)") {
    const eff = String(rawEff || "-").trim();
    const isTbd = /TBD|Pending|after AD issue date/i.test(eff);
    if (isTbd) {
      return `<div style="font-family:monospace;font-weight:700;font-size:12px;color:#fbbf24;white-space:normal;max-width:210px;line-height:1.35;">📅 Eff: ${escapeHtml(
        eff
      )}</div>`;
    }
    return `<div style="font-family:monospace;font-weight:700;font-size:13px;color:${defaultColor};white-space:nowrap;">📅 Eff: ${escapeHtml(
      eff
    )}</div>`;
  }

  function getFilteredAds() {
    const kw = (document.getElementById("searchKeyword").value || "").trim().toLowerCase();
    const authEl = document.getElementById("filterAuthority");
    const auth = authEl ? authEl.value : "ALL";
    const app = document.getElementById("filterApplicability").value;
    const adTypeEl = document.getElementById("filterAdType");
    const adTypeFilter = adTypeEl ? adTypeEl.value : "ALL";
    const supFilterEl = document.getElementById("filterSuperseded");
    const supFilter = supFilterEl ? supFilterEl.value : "ALL";
    const model = document.getElementById("filterModel").value;
    const regFilterEl = document.getElementById("filterAircraftReg");
    const regFilter = regFilterEl ? regFilterEl.value : "ALL";
    const selectedAc = regFilter !== "ALL" ? fleetList.find((f) => f.reg === regFilter) : null;
    const ataEl = document.getElementById("filterAdAta");
    const ataFilter = ataEl ? ataEl.value : "ALL";
    const sortBy = document.getElementById("sortSelect").value;

    let filtered = adList.filter((ad) => {
      if (auth !== "ALL") {
        const combinedAuth = `${ad.authority} ${ad.authorityDual || ""} ${ad.adNumber}`.toUpperCase();
        if (auth === "EASA" && !combinedAuth.includes("EASA") && !combinedAuth.includes("MCAI")) return false;
        if (auth === "FAA" && !combinedAuth.includes("FAA")) return false;
        if (auth === "CAAV" && !combinedAuth.includes("CAAV")) return false;
      }
      if (app !== "ALL" && ad.applicabilityStatus !== app) return false;

      if (ataFilter !== "ALL") {
        const adAta = String(ad.ata || "");
        const m = adAta.match(/ATA\s*(\d{2})/i) || adAta.match(/^(\d{2})/);
        const code = m ? m[1] : "";
        if (code !== ataFilter) return false;
      }

      if (adTypeFilter !== "ALL") {
        const bucket = classifyAdBucket(ad);
        if (adTypeFilter === "COMPONENT" || adTypeFilter === "NON_AIRCRAFT" || adTypeFilter === "ENGINE") {
          if (bucket !== "COMPONENT") return false;
        } else if (bucket !== adTypeFilter) {
          return false;
        }
      }

      const hasSup = Array.isArray(ad.supersededAds) && ad.supersededAds.length > 0;
      if (supFilter === "HAS_SUPERSEDED" && !hasSup) return false;
      if (supFilter === "NO_SUPERSEDED" && hasSup) return false;

      if (selectedAc) {
        if (ad.applicabilityStatus !== "Applicable") return false;
        const mTypes = ad.matchedTypes || [];
        const matchesAc =
          mTypes.includes(selectedAc.type) ||
          (ad.affectedFleet || []).some((af) => af.reg === selectedAc.reg);
        if (!matchesAc) return false;
      }

      if (model !== "ALL") {
        const mTypes = ad.matchedTypes || [];
        const modelText = `${ad.targetModel} ${ad.adExtractedModels || ""} ${ad.adExtractedEngines || ""} ${
          ad.vjcMatchedSummary || ""
        }`.toUpperCase();
        if (model === "NON_VJC") {
          if (ad.applicabilityStatus === "Applicable") return false;
        } else if (["A320-214", "A321-211", "A321-271N", "A321-271NX", "A330-343", "A330-941"].includes(model)) {
          if (!mTypes.includes(model)) return false;
        } else if (!modelText.includes(model.toUpperCase())) {
          return false;
        }
      }

      if (kw) {
        const supText = (ad.supersededAds || [])
          .map((s) => `${s.adNumber} ${s.subject || ""} ${s.summary || ""}`)
          .join(" ");
        const fleetText = (ad.affectedFleet || []).map((f) => `${f.reg} MSN${f.msn} ${f.msn}`).join(" ");
        const haystack = [
          ad.adNumber,
          ad.officialFaaAd,
          ad.easaAdNumber,
          ad.authority,
          ad.targetModel,
          ad.adExtractedModels,
          ad.adExtractedEngines,
          ad.adMsnScope,
          ad.vjcMatchedSummary,
          ad.ata,
          ad.subject,
          ad.summary,
          supText,
          fleetText
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(kw)) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      if (sortBy === "applicableFirst") {
        const aApp = a.applicabilityStatus === "Applicable" ? 0 : 1;
        const bApp = b.applicabilityStatus === "Applicable" ? 0 : 1;
        if (aApp !== bApp) return aApp - bApp;
      }
      if (sortBy === "ataAsc") {
        const codeA = (String(a.ata || "").match(/(\d{2})/) || [])[1] || "99";
        const codeB = (String(b.ata || "").match(/(\d{2})/) || [])[1] || "99";
        const numA = parseInt(codeA, 10);
        const numB = parseInt(codeB, 10);
        if (numA !== numB) return numA - numB;
        return String(a.adNumber).localeCompare(String(b.adNumber));
      }
      if (sortBy === "adNumAsc") {
        return String(a.adNumber).localeCompare(String(b.adNumber));
      }
      return getSortDateKey(b).localeCompare(getSortDateKey(a));
    });

    return filtered;
  }

  function renderPaginationBar(totalItems, totalSup) {
    const pagContainer = document.getElementById("adTablePagination");
    if (!pagContainer) return;

    if (totalItems <= pageSize) {
      pagContainer.innerHTML = `<div style="font-size:12.5px;color:var(--text-secondary);">Đang hiển thị toàn bộ <strong>${totalItems}</strong> AD hiện hành (+ <strong>${totalSup}</strong> AD Superseded).</div>`;
      return;
    }

    const totalPages = Math.ceil(totalItems / pageSize);
    if (currentPage > totalPages) currentPage = totalPages;
    const startIdx = (currentPage - 1) * pageSize + 1;
    const endIdx = Math.min(totalItems, currentPage * pageSize);

    let pageBtns = "";
    for (let p = 1; p <= totalPages; p++) {
      const activeStyle =
        p === currentPage
          ? "background:var(--accent-blue);color:#fff;border-color:var(--accent-blue);"
          : "";
      pageBtns += `<button type="button" class="btn btn-outline btn-sm page-jump-btn" data-page="${p}" style="${activeStyle}">${p}</button>`;
    }

    pagContainer.innerHTML = `
      <div style="font-size:12.5px;color:var(--text-secondary);">
        Đang hiển thị <strong>${startIdx}–${endIdx}</strong> trên tổng số <strong>${totalItems}</strong> AD hiện hành (+ <strong>${totalSup}</strong> AD Superseded gom trong Dropdown)
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
        ${pageBtns}
        <button type="button" class="btn btn-outline btn-sm" id="btnShowAllAds" style="border-color:#10b981;color:#34d399;">
          📋 Hiển thị tất cả ${totalItems} AD
        </button>
      </div>
    `;

    pagContainer.querySelectorAll(".page-jump-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentPage = Number(btn.getAttribute("data-page")) || 1;
        renderAdTable();
      });
    });

    const btnAll = document.getElementById("btnShowAllAds");
    if (btnAll) {
      btnAll.addEventListener("click", () => {
        pageSize = 99999;
        currentPage = 1;
        renderAdTable();
      });
    }
  }

  // Render Tab 1: Main Database Table (6 Clean Columns: AD + Superseded PDFs, Authority + PDF, Models/Engines/MSN, Effective Date, Decision, Verbatim Text + Copy)
  function renderAdTable() {
    updateFilterHighlights();
    const tbody = document.getElementById("adTableBody");
    const kw = (document.getElementById("searchKeyword").value || "").trim().toLowerCase();
    const filtered = getFilteredAds();

    let supCountInFiltered = 0;
    filtered.forEach((a) => (supCountInFiltered += (a.supersededAds || []).length));

    document.getElementById("resultCounterText").textContent = `Tìm thấy ${
      filtered.length
    } AD hiện hành (+ ${supCountInFiltered} AD bị Superseded kèm PDF riêng = ${
      filtered.length + supCountInFiltered
    } tổng AD)`;

    if (filtered.length === 0) {
      renderPaginationBar(0, 0);
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center;padding:30px;color:var(--text-muted);">
            <div>Không tìm thấy "${escapeHtml(kw)}" trong ${adList.length} AD hiện tại của CSDL.</div>
            ${
              kw
                ? `<button class="btn btn-primary btn-sm" id="btnFetchMissingAd" style="margin-top:10px;">
                     🌐 Quét trực tiếp AD "${escapeHtml(kw)}" từ cổng FAA / EASA &amp; Lưu Nguyên Văn vào CSDL
                   </button>`
                : ""
            }
          </td>
        </tr>`;
      const btnFetch = document.getElementById("btnFetchMissingAd");
      if (btnFetch) {
        btnFetch.addEventListener("click", async () => {
          btnFetch.disabled = true;
          btnFetch.textContent = `⏳ Đang tìm "${kw}" trên FAA / EASA...`;
          try {
            const url = `https://www.federalregister.gov/api/v1/documents.json?per_page=10&conditions%5Bagencies%5D%5B%5D=federal-aviation-administration&conditions%5Bterm%5D=${encodeURIComponent(
              kw
            )}&fields%5B%5D=document_number&fields%5B%5D=title&fields%5B%5D=publication_date&fields%5B%5D=effective_on&fields%5B%5D=dates&fields%5B%5D=action&fields%5B%5D=docket_ids&fields%5B%5D=abstract&fields%5B%5D=html_url&fields%5B%5D=pdf_url`;
            const r = await fetch(url);
            const d = await r.json();
            if (d.results && d.results.length > 0) {
              d.results.forEach((doc) => {
                const ev = evaluateAdAgainstVjcFleet(doc);
                if (!adList.some((x) => x.id === ev.id)) adList.unshift(ev);
              });
              await persistDatabase();
              refreshAllViews();
              showToast(`✅ Đã tìm thấy và nạp nguyên văn ${d.results.length} AD khớp "${kw}" vào CSDL!`);
            } else {
              showToast(`⚠️ Không tìm thấy văn bản AD nào khớp với "${kw}".`);
              btnFetch.textContent = "Không tìm thấy trên cổng FAA/EASA";
            }
          } catch (e) {
            showToast("⚠️ Lỗi kết nối tới API.");
          }
        });
      }
      return;
    }

    renderPaginationBar(filtered.length, supCountInFiltered);
    const startIdx = (currentPage - 1) * pageSize;
    const pagedAds = filtered.slice(startIdx, startIdx + pageSize);
    const regFilterEl = document.getElementById("filterAircraftReg");
    const regFilter = regFilterEl ? regFilterEl.value : "ALL";
    const selectedAc = regFilter !== "ALL" ? fleetList.find((f) => f.reg === regFilter) : null;

    tbody.innerHTML = pagedAds
      .map((ad) => {
        const isApp = ad.applicabilityStatus === "Applicable";
        const supList = ad.supersededAds || [];
        const hasSup = supList.length > 0;
        const matchedSupInSearch =
          kw.length > 2 && supList.some((s) => String(s.adNumber).toLowerCase().includes(kw));

        const appBadge = isApp
          ? `<div style="color:#34d399;font-weight:700;font-size:12px;line-height:1.35;white-space:nowrap;">✅ Applicable<br><span style="font-size:11px;font-weight:600;opacity:0.9;">(unverified)</span></div>`
          : `<span class="badge status-overdue" style="font-size:11px;padding:3px 8px;background:rgba(148,163,184,0.15);color:#cbd5e1;border-color:#475569;">🚫 NOT APPLICABLE</span>`;

        const supQuickPdfs = renderSupQuickPdfsHtml(ad, "all");

        const splitInfo = getSplitAdParts(ad);

        if (splitInfo.isDual) {
          const easaFirst = isEasaPrimaryDual(ad);
          const easaEff = ad.easaEffectiveDate || ad.effectiveDate || "-";
          const easaIss = ad.easaIssuedDate || ad.issueDate || "-";
          const easaSubj = ad.easaSubject || ad.subject || "";
          const easaSum = ad.easaSummary || ad.summary || "";
          const easaMod = ad.easaModels || ad.adExtractedModels || "";
          const firstSideLabel = easaFirst ? splitInfo.easaLabel : splitInfo.faaLabel;
          const easaSupItems = getSupersededItemsForSide(ad, "easa");
          const faaSupItems = getSupersededItemsForSide(ad, "faa");
          const easaSupQuickPdfs = renderSupQuickPdfsHtml(ad, "easa");
          const faaSupQuickPdfs = renderSupQuickPdfsHtml(ad, "faa");
          const easaSupWarn = ad.easaSupersededBy
            ? `<div style="margin-top:4px;"><span class="badge badge-superseded" style="font-size:10px;">⚠️ EASA Superseded by ${escapeHtml(
                ad.easaSupersededBy
              )}</span></div>`
            : "";

          const renderDualFaaRow = (isFirst) => `
          <tr class="dual-row-faa ${isFirst ? "dual-row-top" : "dual-row-bottom"}" data-ad-id="${escapeHtml(ad.id)}" data-ad-side="faa" style="${isApp ? "" : "opacity:0.92;"}">
            <td data-label="Số hiệu AD (FAA)">
              <div class="mobile-ad-row-head">
                <div style="flex:1;min-width:0;">
                  ${
                    isFirst
                      ? `<div class="dual-group-badge">🔗 Cặp AD song song • Cùng 1 nội dung (FAA ↔ EASA)</div>`
                      : ""
                  }
                  <div class="ad-num-cell" style="color:#93c5fd;">🇺🇸 ${escapeHtml(splitInfo.faaLabel)} ${isApp ? "✅" : "🚫"}</div>
                  <div class="mobile-only-subject">${escapeHtml(ad.subject)}</div>
                </div>
                <button type="button" class="mobile-expand-btn" aria-label="Xem thông tin sơ bộ FAA AD" aria-expanded="false">▾</button>
              </div>
              ${
                isFirst
                  ? `<div class="desktop-only-cell-extras">
                       <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">
                         <span class="badge badge-standard">${escapeHtml(ad.adClass)}</span>
                         ${faaSupItems.length > 0 ? `<span class="badge badge-superseding">🔗 Supersedes ${faaSupItems.length} FAA AD</span>` : ""}
                       </div>
                       ${renderSupersededDropdownHtml(ad, matchedSupInSearch, "faa", false)}
                     </div>`
                  : `<div class="desktop-only-cell-extras" style="font-size:11px;color:var(--text-muted);margin-top:4px;">
                       <div>↳ Cùng nội dung với <strong>${escapeHtml(firstSideLabel)}</strong></div>
                       ${faaSupItems.length > 0 ? `<div style="margin-top:4px;"><span class="badge badge-superseding">🔗 Supersedes ${faaSupItems.length} FAA AD</span></div>` : ""}
                       ${renderSupersededDropdownHtml(ad, matchedSupInSearch, "faa", true)}
                     </div>`
              }
            </td>
            <td data-label="Cơ quan & PDF FAA" onclick="event.stopPropagation();">
              <div><span class="badge badge-faa">🇺🇸 FAA</span></div>
              <div style="margin-top:7px;display:flex;flex-direction:column;gap:5px;">
                ${renderPdfActionHtml(ad.id, ad, {
                  side: "faa",
                  viewLabel: "📎 PDF FAA AD ↗",
                  uploadLabel: "📤 Upload PDF FAA",
                  style: "font-size:11.5px;padding:4px 8px;border-color:rgba(59,130,246,0.5);color:#60a5fa;text-align:left;"
                })}
                ${faaSupQuickPdfs}
              </div>
            </td>
            <td data-label="Tàu bay, Động cơ & MSN">
              <div style="font-size:11.5px;color:var(--text-secondary);margin-bottom:3px;">
                <strong style="color:#93c5fd;">Đọc từ FAA AD:</strong> ${escapeHtml(ad.adExtractedModels)}
              </div>
              ${renderAdEngineOrClassHtml(ad)}
              ${
                isFirst && selectedAc
                  ? `<div style="font-size:11.5px;color:#fde047;background:rgba(234,179,8,0.16);padding:4px 7px;border-radius:5px;border:1px solid rgba(234,179,8,0.45);font-weight:700;margin-bottom:4px;">
                       🎯 Tàu đang chọn: ${escapeHtml(selectedAc.reg)} (MSN ${escapeHtml(
                      selectedAc.msn
                    )} • ${escapeHtml(selectedAc.type)} • ${escapeHtml(selectedAc.engine)})
                     </div>`
                  : ""
              }
              ${
                isApp
                  ? `<div style="font-size:11.5px;color:#34d399;background:rgba(16,185,129,0.12);padding:4px 7px;border-radius:5px;border:1px solid rgba(16,185,129,0.35);font-weight:600;">
                       ✈️ Khớp VJC (${ad.affectedCount}/${fleetList.length} tàu): ${escapeHtml(
                      ad.vjcMatchedSummary
                    )}
                     </div>`
                  : `<div style="font-size:11px;color:var(--text-muted);">
                       🚫 Không khớp biến thể tàu bay/động cơ VJC
                     </div>`
              }
              <div style="font-size:11px;color:var(--accent-cyan);margin-top:3px;">${escapeHtml(ad.ata)}</div>
            </td>
            <td data-label="Effective & Issued (FAA)">
              ${renderEffectiveDateTextHtml(ad.effectiveDate, "var(--text-primary)")}
              <div style="font-size:11.5px;color:var(--text-muted);margin-top:3px;font-family:monospace;">
                Issued: ${escapeHtml(ad.issueDate)}
              </div>
            </td>
            <td data-label="Kết luận VJC">${appBadge}</td>
            <td data-label="Nội dung FAA AD">
              <div style="font-weight:700;color:#93c5fd;margin-bottom:5px;font-size:12.5px;">
                ${escapeHtml(ad.subject)}
              </div>
              ${renderReasonBoxHtml(ad.summary)}
              <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;" onclick="event.stopPropagation();">
                ${renderPdfActionHtml(ad.id, ad, {
                  side: "faa",
                  viewLabel: "📎 Mở PDF FAA ↗",
                  uploadLabel: "📤 Upload PDF FAA",
                  style: "font-size:11px;padding:3px 8px;border-color:rgba(59,130,246,0.45);color:#60a5fa;"
                })}
                ${
                  ad.sourceUrl
                    ? `<a href="${escapeHtml(
                        ad.sourceUrl
                      )}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="font-size:11px;padding:3px 8px;border-color:rgba(148,163,184,0.4);color:var(--text-secondary);">🔗 Link gốc FAA ↗</a>`
                    : ""
                }
              </div>
            </td>
          </tr>`;

          const renderDualEasaRow = (isFirst) => `
          <tr class="dual-row-easa ${isFirst ? "dual-row-top" : "dual-row-bottom"}" data-ad-id="${escapeHtml(ad.id)}" data-ad-side="easa" style="${isApp ? "" : "opacity:0.92;"}">
            <td data-label="Số hiệu AD (EASA)">
              <div class="mobile-ad-row-head">
                <div style="flex:1;min-width:0;">
                  ${
                    isFirst
                      ? `<div class="dual-group-badge">🔗 Cặp AD song song • Cùng 1 nội dung (EASA ↔ FAA)</div>`
                      : ""
                  }
                  <div class="ad-num-cell" style="color:#34d399;">🇪🇺 ${escapeHtml(splitInfo.easaLabel)} ${isApp ? "✅" : "🚫"}</div>
                  <div class="mobile-only-subject">${escapeHtml(easaSubj)}</div>
                </div>
                <button type="button" class="mobile-expand-btn" aria-label="Xem thông tin sơ bộ EASA AD" aria-expanded="false">▾</button>
              </div>
              ${
                isFirst
                  ? `<div class="desktop-only-cell-extras">
                       <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">
                         <span class="badge badge-standard">${escapeHtml(ad.adClass)}</span>
                         ${easaSupItems.length > 0 ? `<span class="badge badge-superseding">🔗 Supersedes ${easaSupItems.length} EASA AD</span>` : ""}
                       </div>
                       ${easaSupWarn}
                       ${renderSupersededDropdownHtml(ad, matchedSupInSearch, "easa", false)}
                     </div>`
                  : `<div class="desktop-only-cell-extras" style="font-size:11px;color:var(--text-muted);margin-top:4px;">
                       <div>↳ Cùng nội dung với <strong>${escapeHtml(firstSideLabel)}</strong></div>
                       ${easaSupWarn}
                       ${easaSupItems.length > 0 ? `<div style="margin-top:4px;"><span class="badge badge-superseding">🔗 Supersedes ${easaSupItems.length} EASA AD</span></div>` : ""}
                       ${renderSupersededDropdownHtml(ad, matchedSupInSearch, "easa", true)}
                     </div>`
              }
            </td>
            <td data-label="Cơ quan & PDF EASA" onclick="event.stopPropagation();">
              <div><span class="badge badge-easa">🇪🇺 EASA</span></div>
              <div style="margin-top:7px;display:flex;flex-direction:column;gap:5px;">
                ${renderPdfActionHtml(ad.id, ad, {
                  side: "easa",
                  viewLabel: "📎 PDF EASA AD ↗",
                  uploadLabel: "📤 Upload PDF EASA",
                  style: "font-size:11.5px;padding:4px 8px;border-color:rgba(16,185,129,0.55);color:#34d399;text-align:left;"
                })}
                ${easaSupQuickPdfs}
              </div>
            </td>
            <td data-label="Tàu bay & Động cơ (EASA)">
              <div style="font-size:11.5px;color:var(--text-secondary);margin-bottom:3px;">
                <strong style="color:#34d399;">Đọc từ EASA AD:</strong> ${escapeHtml(easaMod)}
              </div>
              ${renderAdEngineOrClassHtml(ad)}
              ${
                isFirst && selectedAc
                  ? `<div style="font-size:11.5px;color:#fde047;background:rgba(234,179,8,0.16);padding:4px 7px;border-radius:5px;border:1px solid rgba(234,179,8,0.45);font-weight:700;margin-bottom:4px;">
                       🎯 Tàu đang chọn: ${escapeHtml(selectedAc.reg)} (MSN ${escapeHtml(
                      selectedAc.msn
                    )} • ${escapeHtml(selectedAc.type)} • ${escapeHtml(selectedAc.engine)})
                     </div>`
                  : ""
              }
              ${
                isApp
                  ? `<div style="font-size:11.5px;color:#34d399;background:rgba(16,185,129,0.12);padding:4px 7px;border-radius:5px;border:1px solid rgba(16,185,129,0.35);font-weight:600;">
                       ✈️ Khớp VJC (${ad.affectedCount}/${fleetList.length} tàu): ${escapeHtml(
                      ad.vjcMatchedSummary
                    )}
                     </div>`
                  : `<div style="font-size:11px;color:var(--text-muted);">
                       🚫 Không khớp biến thể tàu bay/động cơ VJC
                     </div>`
              }
              <div style="font-size:11px;color:var(--accent-cyan);margin-top:3px;">${escapeHtml(ad.ata)}</div>
            </td>
            <td data-label="Effective & Issued (EASA)">
              ${renderEffectiveDateTextHtml(easaEff, "#34d399")}
              <div style="font-size:11.5px;color:var(--text-muted);margin-top:3px;font-family:monospace;">
                Issued: ${escapeHtml(easaIss)}
              </div>
            </td>
            <td data-label="Kết luận VJC">${appBadge}</td>
            <td data-label="Nội dung EASA AD">
              <div style="font-weight:700;color:#34d399;margin-bottom:5px;font-size:12.5px;">
                ${escapeHtml(easaSubj)}
              </div>
              ${renderReasonBoxHtml(easaSum)}
              <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;" onclick="event.stopPropagation();">
                ${renderPdfActionHtml(ad.id, ad, {
                  side: "easa",
                  viewLabel: "📎 Mở PDF EASA ↗",
                  uploadLabel: "📤 Upload PDF EASA",
                  style: "font-size:11px;padding:3px 8px;border-color:rgba(16,185,129,0.5);color:#34d399;"
                })}
                <a href="${escapeHtml(EASA_ARCHIVE_URL)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="font-size:11px;padding:3px 8px;border-color:rgba(148,163,184,0.4);color:var(--text-secondary);">🔗 EASA Archive ↗</a>
              </div>
            </td>
          </tr>`;

          return easaFirst ? renderDualEasaRow(true) + renderDualFaaRow(false) : renderDualFaaRow(true) + renderDualEasaRow(false);
        }

        return `
          <tr data-ad-id="${escapeHtml(ad.id)}" style="${isApp ? "border-left:3px solid #10b981;" : "opacity:0.92;"}">
            <td data-label="Số hiệu AD">
              <div class="mobile-ad-row-head">
                <div style="flex:1;min-width:0;">
                  <div class="ad-num-cell">${renderAdNumberSplitHtml(ad, false)}</div>
                  <div class="mobile-only-subject">${isApp ? "✅ " : "🚫 "}${escapeHtml(ad.subject)}</div>
                </div>
                <button type="button" class="mobile-expand-btn" aria-label="Xem thông tin sơ bộ" aria-expanded="false">▾</button>
              </div>
              <div class="desktop-only-cell-extras">
                <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">
                  <span class="badge badge-standard">${escapeHtml(ad.adClass)}</span>
                  ${
                    hasSup
                      ? `<span class="badge badge-superseding">🔗 Supersedes ${supList.length} AD</span>`
                      : ""
                  }
                  ${
                    ad.easaStatusNote
                      ? `<span class="badge badge-superseded">⚠️ ${escapeHtml(ad.easaStatusNote)}</span>`
                      : ""
                  }
                  ${
                    ad.historicalMcaiRef
                      ? `<span class="badge badge-standard" style="border-color:rgba(16,185,129,0.4);color:#6ee7b7;">🔗 EASA AD liên quan: ${escapeHtml(
                          ad.historicalMcaiRef
                        )}</span>`
                      : ""
                  }
                </div>
                ${renderSupersededDropdownHtml(ad, matchedSupInSearch)}
              </div>
            </td>
            <td data-label="Cơ quan & PDF" onclick="event.stopPropagation();">
              <div>${getAuthorityBadge(ad)}</div>
              <div style="margin-top:7px;display:flex;flex-direction:column;gap:5px;">
                ${renderPdfActionHtml(ad.id, ad, {
                  side: "main",
                  viewLabel: "📎 Xem PDF Hiện hành ↗",
                  uploadLabel: "📤 Upload PDF",
                  style: "font-size:11.5px;padding:4px 8px;border-color:rgba(59,130,246,0.45);color:#60a5fa;"
                })}
                ${supQuickPdfs}
              </div>
            </td>
            <td data-label="Tàu bay, Động cơ & MSN">
              <div style="font-size:11.5px;color:var(--text-secondary);margin-bottom:3px;">
                <strong style="color:#93c5fd;">Đọc từ AD:</strong> ${escapeHtml(ad.adExtractedModels)}
              </div>
              ${renderAdEngineOrClassHtml(ad)}
              ${
                selectedAc
                  ? `<div style="font-size:11.5px;color:#fde047;background:rgba(234,179,8,0.16);padding:4px 7px;border-radius:5px;border:1px solid rgba(234,179,8,0.45);font-weight:700;margin-bottom:4px;">
                       🎯 Tàu đang chọn: ${escapeHtml(selectedAc.reg)} (MSN ${escapeHtml(
                      selectedAc.msn
                    )} • ${escapeHtml(selectedAc.type)} • ${escapeHtml(selectedAc.engine)})
                     </div>`
                  : ""
              }
              ${
                isApp
                  ? `<div style="font-size:11.5px;color:#34d399;background:rgba(16,185,129,0.12);padding:4px 7px;border-radius:5px;border:1px solid rgba(16,185,129,0.35);font-weight:600;">
                       ✈️ Khớp VJC (${ad.affectedCount}/${fleetList.length} tàu): ${escapeHtml(
                      ad.vjcMatchedSummary
                    )}
                     </div>`
                  : `<div style="font-size:11px;color:var(--text-muted);">
                       🚫 Không khớp biến thể tàu bay/động cơ VJC
                     </div>`
              }
              <div style="font-size:11px;color:var(--accent-cyan);margin-top:3px;">${escapeHtml(ad.ata)}</div>
            </td>
            <td data-label="Effective & Issued">
              ${renderEffectiveDateTextHtml(ad.effectiveDate, "var(--text-primary)")}
              <div style="font-size:11.5px;color:var(--text-muted);margin-top:3px;font-family:monospace;">
                Issued: ${escapeHtml(ad.issueDate)}
              </div>
            </td>
            <td data-label="Kết luận VJC">${appBadge}</td>
            <td data-label="Nội dung AD">
              <div style="font-weight:700;color:#93c5fd;margin-bottom:5px;font-size:12.5px;">
                ${escapeHtml(ad.subject)}
              </div>
              ${renderReasonBoxHtml(ad.summary)}
              <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;" onclick="event.stopPropagation();">
                ${renderPdfActionHtml(ad.id, ad, {
                  side: "main",
                  viewLabel: "📎 Xem PDF ↗",
                  uploadLabel: "📤 Upload PDF",
                  style: "font-size:11px;padding:3px 8px;border-color:rgba(59,130,246,0.45);color:#60a5fa;"
                })}
                ${
                  ad.sourceUrl
                    ? `<a href="${escapeHtml(
                        ad.sourceUrl.includes("ad.easa.europa.eu") ? EASA_ARCHIVE_URL : ad.sourceUrl
                      )}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="font-size:11px;padding:3px 8px;border-color:rgba(148,163,184,0.4);color:var(--text-secondary);">🔗 Link gốc ↗</a>`
                    : ""
                }
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  // Render Tab 2: Verbatim AD Text & PDF List for Applicable VJC ADs
  function renderAutoEvaluationsTab() {
    updateFilterHighlights();
    const container = document.getElementById("autoEvaluationsContainer");
    const evalRegEl = document.getElementById("evalFilterAircraftReg");
    const evalReg = evalRegEl ? evalRegEl.value : "ALL";
    const selectedEvalAc = evalReg !== "ALL" ? fleetList.find((f) => f.reg === evalReg) : null;

    const applicableAds = adList.filter((a) => {
      if (a.applicabilityStatus !== "Applicable") return false;
      if (selectedEvalAc) {
        return (
          (a.matchedTypes || []).includes(selectedEvalAc.type) ||
          (a.affectedFleet || []).some((af) => af.reg === selectedEvalAc.reg)
        );
      }
      return true;
    });

    if (applicableAds.length === 0) {
      container.innerHTML = `<div class="dash-card">Chưa có AD Applicable nào cho tàu bay đã chọn.</div>`;
      return;
    }

    const shownApplicable = applicableAds.slice(0, 80);

    container.innerHTML =
      `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:4px;">
         Đang hiển thị <strong>${shownApplicable.length}</strong> / tổng số <strong>${applicableAds.length}</strong> AD Applicable ${
        selectedEvalAc
          ? `áp dụng cho tàu bay <strong style="color:#fde047;">${escapeHtml(
              selectedEvalAc.reg
            )} (MSN ${escapeHtml(selectedEvalAc.msn)} • ${escapeHtml(selectedEvalAc.type)} • ${escapeHtml(
              selectedEvalAc.engine
            )})</strong>`
          : `(Khớp đội bay ${fleetList.length} tàu VJC)`
      } — Nguyên văn chữ gốc đọc từ AD (Copy y chang).
       </div>` +
      shownApplicable
        .map((ad) => {
          const fleetArr = ad.affectedFleet || [];
          const shownTails = fleetArr.slice(0, 18);
          const tailBadges =
            shownTails
              .map(
                (t) =>
                  `<span class="badge status-open" style="margin:2px;font-family:monospace;">✈️ ${escapeHtml(
                    t.reg
                  )} (MSN ${escapeHtml(t.msn)} • ${escapeHtml(t.type)} • ${escapeHtml(t.engine)})</span>`
              )
              .join("") +
            (fleetArr.length > 18
              ? `<span class="badge status-closed" style="margin:2px;">+${
                  fleetArr.length - 18
                } tàu VJC khác (Tổng ${fleetArr.length}/${fleetList.length} tàu)</span>`
              : "");

          const supList = ad.supersededAds || [];
          const splitInfo = getSplitAdParts(ad);

          if (splitInfo.isDual) {
            const easaFirst = isEasaPrimaryDual(ad);
            const easaEff = ad.easaEffectiveDate || ad.effectiveDate || "-";
            const easaIss = ad.easaIssuedDate || ad.issueDate || "-";
            const easaSubj = ad.easaSubject || ad.subject || "";
            const easaSum = ad.easaSummary || ad.summary || "";
            const faaBox = (lineNum) => `
              <!-- Dòng ${lineNum}: FAA AD -->
              <div class="detail-box" style="margin-bottom:${lineNum === 1 ? "10px" : "12px"};border-color:rgba(59,130,246,0.55);background:rgba(30,58,138,0.14);">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
                  <div>
                    <span class="badge badge-faa">🇺🇸 DÒNG ${lineNum}: ${escapeHtml(splitInfo.faaLabel)}</span>
                    <span class="badge badge-standard" style="margin-left:6px;">Eff: ${escapeHtml(ad.effectiveDate)}</span>
                    <span class="badge badge-standard" style="margin-left:4px;">Issued: ${escapeHtml(ad.issueDate)}</span>
                  </div>
                  <div style="display:flex;gap:6px;flex-wrap:wrap;" class="no-print">
                    ${renderPdfActionHtml(ad.id, ad, {
                      side: "faa",
                      viewLabel: "📎 Mở PDF FAA ↗",
                      uploadLabel: "📤 Upload PDF FAA",
                      style: "border-color:#3b82f6;color:#60a5fa;"
                    })}
                    ${
                      ad.sourceUrl
                        ? `<a href="${escapeHtml(ad.sourceUrl)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">🔗 Trang gốc FAA ↗</a>`
                        : ""
                    }
                  </div>
                </div>
                <div style="font-weight:700;color:#93c5fd;margin-bottom:6px;font-size:13px;">${escapeHtml(ad.subject)}</div>
                ${renderReasonBoxHtml(ad.summary)}
                ${renderSupersededDropdownHtml(ad, false, "faa", true)}
              </div>`;
            const easaBox = (lineNum) => `
              <!-- Dòng ${lineNum}: EASA AD -->
              <div class="detail-box" style="margin-bottom:${lineNum === 1 ? "10px" : "12px"};border-color:rgba(16,185,129,0.55);background:rgba(6,78,59,0.16);">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
                  <div>
                    <span class="badge badge-easa">🇪🇺 DÒNG ${lineNum}: ${escapeHtml(splitInfo.easaLabel)}</span>
                    <span class="badge badge-standard" style="margin-left:6px;">Eff: ${escapeHtml(easaEff)}</span>
                    <span class="badge badge-standard" style="margin-left:4px;">Issued: ${escapeHtml(easaIss)}</span>
                  </div>
                  <div style="display:flex;gap:6px;flex-wrap:wrap;" class="no-print">
                    ${renderPdfActionHtml(ad.id, ad, {
                      side: "easa",
                      viewLabel: "📎 Mở PDF EASA ↗",
                      uploadLabel: "📤 Upload PDF EASA",
                      style: "border-color:#10b981;color:#34d399;"
                    })}
                    <a href="${escapeHtml(EASA_ARCHIVE_URL)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">🔗 EASA Archive ↗</a>
                  </div>
                </div>
                <div style="font-weight:700;color:#34d399;margin-bottom:6px;font-size:13px;">${escapeHtml(easaSubj)}</div>
                ${renderReasonBoxHtml(easaSum)}
                ${renderSupersededDropdownHtml(ad, false, "easa", true)}
              </div>`;
            return `
            <div class="dash-card" style="border-left:5px solid #10b981;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;border-bottom:1px solid var(--border-color);padding-bottom:10px;margin-bottom:12px;">
                <div style="flex:1;">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
                    <span style="color:#34d399;font-weight:700;font-size:12px;display:inline-flex;align-items:center;gap:4px;">✅ Applicable (unverified) (${fleetArr.length}/${fleetList.length} TÀU VJC)</span>
                    ${getAuthorityBadge(ad)}
                    <span class="badge badge-superseding">🔗 Cặp AD Song Song (2 dòng ${easaFirst ? "EASA &amp; FAA" : "FAA &amp; EASA"})</span>
                  </div>
                </div>
              </div>

              ${easaFirst ? easaBox(1) + faaBox(2) : faaBox(1) + easaBox(2)}

              <div class="detail-box">
                <div class="label">✈️ Danh sách Tàu bay VJC Khớp (${fleetArr.length}/${fleetList.length} tàu — ${escapeHtml(
              ad.vjcMatchedSummary
            )})</div>
                <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;">
                  ${tailBadges}
                </div>
              </div>
            </div>
            `;
          }

          return `
            <div class="dash-card" style="border-left:5px solid #10b981;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;border-bottom:1px solid var(--border-color);padding-bottom:12px;margin-bottom:14px;">
                <div style="flex:1;">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
                    <span style="color:#34d399;font-weight:700;font-size:12px;display:inline-flex;align-items:center;gap:4px;">✅ Applicable (unverified) (${fleetArr.length}/${fleetList.length} TÀU VJC)</span>
                    ${getAuthorityBadge(ad)}
                    <span class="badge badge-standard">Effective: ${escapeHtml(ad.effectiveDate)}</span>
                    <span class="badge badge-standard">Issued: ${escapeHtml(ad.issueDate)}</span>
                  </div>
                  <h3 style="margin:0;font-size:16px;color:#60a5fa;">
                    ${renderAdNumberSplitHtml(ad, false)}
                    <div style="font-size:14px;margin-top:4px;color:var(--text-primary);">${escapeHtml(ad.subject)}</div>
                  </h3>
                  ${supList.length > 0 ? renderSupersededDropdownHtml(ad, false) : ""}
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;" class="no-print">
                  ${renderPdfActionHtml(ad.id, ad, {
                    side: "main",
                    viewLabel: "📎 Xem PDF Hiện Hành ↗",
                    uploadLabel: "📤 Upload PDF",
                    style: "border-color:#3b82f6;color:#60a5fa;"
                  })}
                  ${
                    ad.sourceUrl
                      ? `<a href="${escapeHtml(
                          ad.sourceUrl.includes("ad.easa.europa.eu") ? EASA_ARCHIVE_URL : ad.sourceUrl
                        )}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">🔗 Link AD gốc ↗</a>`
                      : ""
                  }
                </div>
              </div>

              <div class="detail-box" style="margin-bottom:12px;">
                ${renderAdEngineOrClassHtml(ad)}
                ${renderReasonBoxHtml(ad.summary)}
              </div>

              <div class="detail-box">
                <div class="label">✈️ Danh sách Tàu bay VJC Khớp (${fleetArr.length}/${fleetList.length} tàu — ${escapeHtml(
            ad.vjcMatchedSummary
          )})</div>
                <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;">
                  ${tailBadges}
                </div>
              </div>
            </div>
          `;
        })
        .join("");
  }

  // Render Tab 3: VJC Fleet Registry & Verbatim AD List per Aircraft
  function renderFleetTab() {
    updateFilterHighlights();
    const regBody = document.getElementById("vjcFleetRegistryBody");
    document.getElementById("fleetSummaryBadge").textContent = `${fleetList.length} Tàu bay VJC (Chuẩn MSN & Động cơ CAAV)`;

    const appCountByType = {};
    Array.from(new Set(fleetList.map((f) => f.type).filter(Boolean))).forEach((t) => {
      appCountByType[t] = adList.filter(
        (ad) => ad.applicabilityStatus === "Applicable" && (ad.matchedTypes || []).includes(t)
      ).length;
    });

    regBody.innerHTML = fleetList
      .map((ac) => {
        const appAdsCount = appCountByType[ac.type] || 0;
        return `
          <tr>
            <td data-label="Tàu bay"><strong style="color:#60a5fa;font-family:monospace;font-size:14px;">${escapeHtml(ac.reg)}</strong></td>
            <td data-label="MSN" style="font-family:monospace;font-weight:700;color:#fcd34d;">MSN ${escapeHtml(ac.msn)}</td>
            <td data-label="Biến thể"><strong>${escapeHtml(ac.type)}</strong></td>
            <td data-label="Họ tàu">${escapeHtml(ac.family)}</td>
            <td data-label="Động cơ"><span class="badge badge-standard">${escapeHtml(ac.engine)}</span></td>
            <td data-label="FH">${Number(ac.fh).toLocaleString()} FH</td>
            <td data-label="FC">${Number(ac.fc).toLocaleString()} FC</td>
            <td data-label="Base"><strong>${escapeHtml(ac.base || "SGN")}</strong></td>
            <td data-label="AD áp dụng"><span style="color:#34d399;font-weight:700;font-size:12px;">${appAdsCount} AD Applicable (unverified)</span></td>
          </tr>
        `;
      })
      .join("");

    const sel = document.getElementById("fleetSelectFilter");
    const filterReg = sel ? sel.value : "ALL";
    const matrixBody = document.getElementById("fleetMatrixBody");
    const rows = [];

    const targetAircraft =
      filterReg === "ALL" ? fleetList.slice(0, 8) : fleetList.filter((fl) => fl.reg === filterReg);

    const adSliceLimit = filterReg === "ALL" ? 60 : 500;
    adList
      .filter((a) => a.applicabilityStatus === "Applicable")
      .slice(0, adSliceLimit)
      .forEach((ad) => {
        targetAircraft.forEach((acInfo) => {
          if ((ad.matchedTypes || []).includes(acInfo.type)) {
            rows.push({ ad, acInfo });
          }
        });
      });

    if (rows.length === 0) {
      matrixBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">Không có bản ghi AD cho tàu bay đã chọn.</td></tr>`;
      return;
    }

    const displayRows = rows.slice(0, 200);

    matrixBody.innerHTML = displayRows
      .map(({ ad, acInfo }) => {
        const splitInfo = getSplitAdParts(ad);
        if (splitInfo.isDual) {
          const easaFirst = isEasaPrimaryDual(ad) || /A31|A32|A33|A35|Airbus/i.test(acInfo.type || "");
          const easaEff = ad.easaEffectiveDate || ad.effectiveDate || "-";
          const easaSubj = ad.easaSubject || ad.subject || "";
          const easaSum = ad.easaSummary || ad.summary || "";
          const renderFleetFaaRow = (isFirst) => `
          <tr class="dual-row-faa ${isFirst ? "dual-row-top" : "dual-row-bottom"}" data-ad-id="${escapeHtml(ad.id)}" data-ad-side="faa">
            <td data-label="Tàu bay"><strong style="color:#60a5fa;font-family:monospace;">${escapeHtml(acInfo.reg)}</strong></td>
            <td data-label="MSN / Loại tàu"><span style="color:#fcd34d;font-family:monospace;">MSN ${escapeHtml(acInfo.msn)}</span> • <strong>${escapeHtml(
            acInfo.type
          )}</strong></td>
            <td data-label="Động cơ">${escapeHtml(acInfo.engine)}</td>
            <td data-label="Số hiệu AD">
              ${isFirst ? `<div class="dual-group-badge">🔗 Cùng 1 nội dung (${easaFirst ? "EASA ↔ FAA" : "FAA ↔ EASA"})</div>` : ""}
              <div class="ad-num-cell" style="color:#93c5fd;">🇺🇸 ${escapeHtml(splitInfo.faaLabel)}</div>
              <div style="font-size:11.5px;color:#93c5fd;margin-top:3px;">${escapeHtml(ad.subject)}</div>
            </td>
            <td data-label="Ngày Effective" style="font-family:monospace;font-weight:700;">📅 ${escapeHtml(ad.effectiveDate)}</td>
            <td data-label="Reason" style="max-width:420px;">
              ${renderReasonBoxHtml(ad.summary)}
            </td>
            <td data-label="File PDF" onclick="event.stopPropagation();">
              ${renderPdfActionHtml(ad.id, ad, { side: "faa", viewLabel: "🇺🇸 PDF ↗", uploadLabel: "📤 Upload" })}
            </td>
          </tr>`;
          const renderFleetEasaRow = (isFirst) => `
          <tr class="dual-row-easa ${isFirst ? "dual-row-top" : "dual-row-bottom"}" data-ad-id="${escapeHtml(ad.id)}" data-ad-side="easa">
            <td data-label="Tàu bay"><strong style="color:#34d399;font-family:monospace;">${escapeHtml(acInfo.reg)}</strong></td>
            <td data-label="MSN / Loại tàu"><span style="color:#fcd34d;font-family:monospace;">MSN ${escapeHtml(acInfo.msn)}</span> • <strong>${escapeHtml(
            acInfo.type
          )}</strong></td>
            <td data-label="Động cơ">${escapeHtml(acInfo.engine)}</td>
            <td data-label="Số hiệu AD">
              ${isFirst ? `<div class="dual-group-badge">🔗 Cùng 1 nội dung (${easaFirst ? "EASA ↔ FAA" : "FAA ↔ EASA"})</div>` : ""}
              <div class="ad-num-cell" style="color:#34d399;">🇪🇺 ${escapeHtml(splitInfo.easaLabel)}</div>
              <div style="font-size:11.5px;color:#34d399;margin-top:3px;">${escapeHtml(easaSubj)}</div>
            </td>
            <td data-label="Ngày Effective" style="font-family:monospace;font-weight:700;color:#34d399;">📅 ${escapeHtml(easaEff)}</td>
            <td data-label="Reason" style="max-width:420px;">
              ${renderReasonBoxHtml(easaSum)}
            </td>
            <td data-label="File PDF" onclick="event.stopPropagation();">
              ${renderPdfActionHtml(ad.id, ad, {
                side: "easa",
                viewLabel: "🇪🇺 PDF ↗",
                uploadLabel: "📤 Upload",
                style: "border-color:rgba(16,185,129,0.5);color:#34d399;"
              })}
            </td>
          </tr>`;
          return easaFirst ? renderFleetEasaRow(true) + renderFleetFaaRow(false) : renderFleetFaaRow(true) + renderFleetEasaRow(false);
        }
        return `
          <tr data-ad-id="${escapeHtml(ad.id)}">
            <td data-label="Tàu bay"><strong style="color:#60a5fa;font-family:monospace;">${escapeHtml(acInfo.reg)}</strong></td>
            <td data-label="MSN / Loại tàu"><span style="color:#fcd34d;font-family:monospace;">MSN ${escapeHtml(acInfo.msn)}</span> • <strong>${escapeHtml(
          acInfo.type
        )}</strong></td>
            <td data-label="Động cơ">${escapeHtml(acInfo.engine)}</td>
            <td data-label="Số hiệu AD">
              <div class="ad-num-cell">${renderAdNumberSplitHtml(ad, true)}</div>
              <div style="font-size:11.5px;color:#93c5fd;margin-top:3px;">${escapeHtml(ad.subject)}</div>
            </td>
            <td data-label="Ngày Effective" style="font-family:monospace;font-weight:700;">📅 ${escapeHtml(ad.effectiveDate)}</td>
            <td data-label="Reason" style="max-width:420px;">
              ${renderReasonBoxHtml(ad.summary)}
            </td>
            <td data-label="File PDF" onclick="event.stopPropagation();">
              ${renderPdfActionHtml(ad.id, ad, { side: "main", viewLabel: "📎 Xem PDF ↗", uploadLabel: "📤 Upload PDF" })}
            </td>
          </tr>
        `;
      })
      .join("");
  }

  // Render Dashboard Charts
  function renderDashboard() {
    const makeBars = (containerId, items, total, color) => {
      const el = document.getElementById(containerId);
      if (!el) return;
      el.innerHTML = items
        .map(([label, count]) => {
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return `
            <div>
              <div class="bar-item-head">
                <span><strong>${escapeHtml(label)}</strong></span>
                <span>${count} AD (${pct}%)</span>
              </div>
              <div class="bar-track">
                <div class="bar-fill" style="width:${pct}%;background:${color};"></div>
              </div>
            </div>
          `;
        })
        .join("");
    };

    const total = adList.length;

    const statusItems = [
      [
        `✅ Applicable (unverified) (Áp dụng đội bay ${fleetList.length} tàu VJC)`,
        adList.filter((a) => a.applicabilityStatus === "Applicable").length
      ],
      ["🚫 Not Applicable (Ngoài cấu hình VJC)", adList.filter((a) => a.applicabilityStatus !== "Applicable").length],
      ["🔗 AD có thay thế AD cũ (Superseding ADs)", adList.filter((a) => (a.supersededAds || []).length > 0).length]
    ];
    makeBars("chartStatus", statusItems, total, "var(--accent-emerald)");

    const authMap = {};
    adList.forEach((a) => (authMap[a.authority] = (authMap[a.authority] || 0) + 1));
    makeBars("chartAuthority", Object.entries(authMap), total, "var(--accent-blue)");

    const vjcVariantItems = [
      [
        "A320-214 (15 tàu • CFM56-5B4/P & -5B4/3)",
        adList.filter((a) => (a.matchedTypes || []).includes("A320-214")).length
      ],
      [
        "A321-211 CEO (41 tàu • CFM56-5B3/P & -5B3/3)",
        adList.filter((a) => (a.matchedTypes || []).includes("A321-211")).length
      ],
      [
        "A321-271N NEO (11 tàu • PW1133G-JM)",
        adList.filter((a) => (a.matchedTypes || []).includes("A321-271N")).length
      ],
      [
        "A321-271NX NEO ACF (33 tàu • PW1133G-JM)",
        adList.filter((a) => (a.matchedTypes || []).includes("A321-271NX")).length
      ],
      [
        "A330-343 Widebody (8 tàu • Trent 772B-60)",
        adList.filter((a) => (a.matchedTypes || []).includes("A330-343")).length
      ]
    ];
    makeBars("chartFleetModel", vjcVariantItems, total, "var(--accent-purple)");

    const ataMap = {};
    adList.forEach((a) => (ataMap[a.ata] = (ataMap[a.ata] || 0) + 1));
    makeBars("chartAta", Object.entries(ataMap).slice(0, 8), total, "var(--accent-amber)");
  }

  let navFromPart = false;
  window.lastPartViewContext = null;

  // Open Detail Modal: Displays 100% Verbatim Text + Official PDF for Current (EASA/FAA side) and any Superseded AD!
  async function openAdModal(adId, supIdx = null, adSide = null) {
    if (!adId) return;
    if (!navFromPart) {
      window.lastPartViewContext = null;
    }
    navFromPart = false;
    let ad = adList.find((x) => x.id === adId);
    if (!ad) {
      const q = String(adId).trim().toLowerCase();
      ad =
        adList.find((x) => x.id && x.id.toLowerCase() === q) ||
        adList.find((x) => x.adNumber && x.adNumber.toLowerCase() === q) ||
        adList.find((x) => x.officialFaaAd && x.officialFaaAd.toLowerCase() === q) ||
        adList.find((x) => x.easaAdNumber && x.easaAdNumber.toLowerCase() === q) ||
        adList.find((x) => x.adNumber && x.adNumber.toLowerCase().includes(q)) ||
        adList.find((x) => x.id && x.id.toLowerCase().includes(q));
    }
    if (!ad) {
      showToast(`⚠️ Không tìm thấy hồ sơ chi tiết cho AD: ${adId}`);
      return;
    }
    const easaFirst = isEasaPrimaryDual(ad);
    const resolvedSide = adSide || (easaFirst ? "easa" : "faa");
    activeAdId = ad.id;
    activeSupIdx = supIdx !== null && supIdx !== undefined ? Number(supIdx) : null;
    activeAdSide = resolvedSide;

    const supList = ad.supersededAds || [];
    const activeSupObj =
      activeSupIdx !== null && supList[activeSupIdx] ? supList[activeSupIdx] : null;

    const splitInfo = getSplitAdParts(ad);
    const isDualEasaView = !activeSupObj && splitInfo.isDual && resolvedSide === "easa";
    const isDualFaaView = !activeSupObj && splitInfo.isDual && resolvedSide !== "easa";

    const viewingDoc = activeSupObj
      ? activeSupObj
      : isDualEasaView
      ? {
          adNumber: splitInfo.easaLabel,
          subject: ad.easaSubject || ad.subject,
          summary: ad.easaSummary || ad.summary,
          issuedDate: ad.easaIssuedDate || ad.issueDate || ad.issuedDate,
          effectiveDate: ad.easaEffectiveDate || ad.effectiveDate,
          adExtractedModels: ad.easaModels || ad.adExtractedModels,
          pdfUrl: getSafeEasaUrl(ad),
          sourceUrl: EASA_ARCHIVE_URL,
          easaUrl: getSafeEasaUrl(ad)
        }
      : isDualFaaView
      ? Object.assign({}, ad, { adNumber: splitInfo.faaLabel })
      : ad;

    const isViewingSup = Boolean(activeSupObj);
    const isApp = ad.applicabilityStatus === "Applicable";

    const backContainer = document.getElementById("modalBackToPartContainer");
    if (backContainer) {
      if (window.lastPartViewContext && window.lastPartViewContext.pn) {
        const pnEsc = escapeHtml(window.lastPartViewContext.pn);
        backContainer.innerHTML = `
          <button type="button" class="btn btn-primary btn-sm no-print" onclick="window.goBackToPartDetail()" style="display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#2563eb,#1d4ed8);border-color:#3b82f6;color:#fff;font-weight:700;font-size:12px;padding:5px 12px;border-radius:6px;box-shadow:0 2px 8px rgba(37,99,235,0.4);">
            ◀ Quay lại Vật Tư (P/N: ${pnEsc})
          </button>
        `;
      } else {
        backContainer.innerHTML = "";
      }
    }

    document.getElementById("modalBadges").innerHTML = `
      ${
        isViewingSup
          ? `<span class="badge badge-superseded" style="font-size:12px;">⚠️ ĐANG XEM AD BỊ THAY THẾ (SUPERSEDED BY ${escapeHtml(
              ad.adNumber
            )})</span>`
          : `<span style="color:#34d399;font-weight:700;font-size:12px;display:inline-flex;align-items:center;gap:4px;">${escapeHtml(
              isApp ? "✅ Applicable (unverified)" : "🚫 NOT APPLICABLE"
            )}</span>`
      }
      ${getAuthorityBadge(ad)}
      ${supList.length > 0 ? `<span class="badge badge-superseding">🔗 Chuỗi ${supList.length + 1} AD</span>` : ""}
      <span class="badge badge-standard">${escapeHtml(ad.ata)}</span>
    `;

    document.getElementById("modalTitle").textContent = `${viewingDoc.adNumber} — ${
      viewingDoc.subject || ad.subject
    }`;
    const modalSide = isDualEasaView ? "easa" : "main";
    const modalHasPdf = hasDirectPdfFile(viewingDoc, modalSide);
    const modalPdfBtn = document.getElementById("btnModalPdfLink");
    if (modalPdfBtn) {
      if (modalHasPdf) {
        modalPdfBtn.href = getSafePdfUrl(viewingDoc) || getSafePdfUrl(ad) || "#";
        modalPdfBtn.target = "_blank";
        modalPdfBtn.classList.remove("btn-upload-ad-pdf");
        modalPdfBtn.textContent = "📥 Xem / Mở File PDF Gốc ↗";
        modalPdfBtn.onclick = null;
      } else {
        modalPdfBtn.href = "#";
        modalPdfBtn.removeAttribute("target");
        modalPdfBtn.classList.add("btn-upload-ad-pdf");
        modalPdfBtn.textContent = "📤 Upload PDF (Chưa có file)";
        modalPdfBtn.onclick = (ev) => {
          ev.preventDefault();
          const fi = document.getElementById("attachLocalPdfInput");
          if (fi) fi.click();
        };
      }
    }
    const modalSourceUrl = String(viewingDoc.sourceUrl || ad.sourceUrl || "");
    document.getElementById("btnModalSourceLink").href =
      modalSourceUrl && !modalSourceUrl.includes("ad.easa.europa.eu") ? modalSourceUrl : EASA_ARCHIVE_URL;

    // Build Switcher Bar between Current AD (FAA & EASA sides) and Superseded ADs
    const modalSupItems = splitInfo.isDual
      ? [...getSupersededItemsForSide(ad, "easa"), ...getSupersededItemsForSide(ad, "faa")]
      : getSupersededItemsForSide(ad, "all");

    let switcherHtml = "";
    if (splitInfo.isDual || supList.length > 0) {
      const currentSection = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:11.5px;font-weight:700;color:#94a3b8;letter-spacing:0.3px;text-transform:uppercase;">
              ⚡ VĂN BẢN HIỆN HÀNH ĐANG ÁP DỤNG:
            </span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${
              splitInfo.isDual
                ? (() => {
                    const faaBtn = `<button type="button" class="btn ${
                      isDualFaaView ? "btn-primary" : "btn-outline"
                    } btn-sm modal-switch-doc-btn" data-sup-idx="" data-ad-side="faa" style="${
                      isDualFaaView
                        ? "background:#2563eb;border-color:#3b82f6;color:#ffffff;font-weight:700;"
                        : "border-color:rgba(59,130,246,0.4);color:#93c5fd;"
                    }">
                     🇺🇸 [FAA] ${escapeHtml(splitInfo.faaLabel)} <span style="opacity:0.8;font-weight:normal;font-size:11px;">(Eff: ${escapeHtml(ad.effectiveDate)})</span>
                   </button>`;
                    const easaBtn = `<button type="button" class="btn ${
                      isDualEasaView ? "btn-primary" : "btn-outline"
                    } btn-sm modal-switch-doc-btn" data-sup-idx="" data-ad-side="easa" style="${
                      isDualEasaView
                        ? "background:#059669;border-color:#10b981;color:#ffffff;font-weight:700;"
                        : "border-color:rgba(16,185,129,0.45);color:#34d399;"
                    }">
                     🇪🇺 [EASA] ${escapeHtml(splitInfo.easaLabel)} <span style="opacity:0.8;font-weight:normal;font-size:11px;">(Eff: ${escapeHtml(
                      ad.easaEffectiveDate || ad.effectiveDate
                    )})</span>
                   </button>`;
                    return easaFirst ? easaBtn + faaBtn : faaBtn + easaBtn;
                  })()
                : `<button type="button" class="btn ${
                    !isViewingSup ? "btn-primary" : "btn-outline"
                  } btn-sm modal-switch-doc-btn" data-sup-idx="" data-ad-side="faa" style="${
                    !isViewingSup
                      ? "background:#059669;border-color:#10b981;color:#ffffff;font-weight:700;"
                      : "border-color:rgba(148,163,184,0.4);color:#cbd5e1;"
                  }">
                     🟢 [HIỆN HÀNH] ${escapeHtml(ad.adNumber)} (Eff: ${escapeHtml(ad.effectiveDate)})
                   </button>`
            }
          </div>
        </div>
      `;

      let supersededSection = "";
      if (modalSupItems.length > 0) {
        supersededSection = `
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.08);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
              <span style="color:#fbbf24;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;">
                ⚠️ LỊCH SỬ AD BỊ THAY THẾ (SUPERSEDED — ${modalSupItems.length} VĂN BẢN GỐC):
              </span>
              <span style="font-size:11px;color:var(--text-muted);">Bấm "Xem nguyên văn" để tải nội dung hoặc xem trực tiếp file PDF</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${modalSupItems
                .map(({ s, origIdx, displayNum, pdfSide, sideTag }) => {
                  const isCurrentSupViewing = activeSupIdx === origIdx;
                  const isEasa = sideTag === "easa";
                  const targetUrl = pdfSide === "easa" ? getSafeEasaUrl(s) || getSafePdfUrl(s) : getSafePdfUrl(s);
                  return `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 12px;background:${
                  isCurrentSupViewing ? "rgba(245,158,11,0.12)" : "rgba(255,255,255,0.03)"
                };border:1px solid ${
                    isCurrentSupViewing ? "rgba(245,158,11,0.6)" : "rgba(255,255,255,0.07)"
                  };border-radius:6px;gap:10px;flex-wrap:wrap;">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <span class="badge ${isEasa ? "badge-easa" : "badge-faa"}" style="font-size:10.5px;">${
                      isEasa ? "🇪🇺 EASA" : "🇺🇸 FAA"
                    }</span>
                    <strong style="color:${isCurrentSupViewing ? "#fbbf24" : "#e2e8f0"};font-size:12.5px;font-family:monospace;">
                      ${escapeHtml(displayNum)}
                    </strong>
                    <span style="font-size:11.5px;color:var(--text-muted);">
                      (Ban hành: ${escapeHtml(s.issuedDate || "Historical")})
                    </span>
                    <span class="badge badge-superseded" style="font-size:10px;">Bị thay thế</span>
                  </div>
                  <div style="display:flex;align-items:center;gap:6px;">
                    <button type="button" class="btn ${
                      isCurrentSupViewing ? "btn-primary" : "btn-outline"
                    } btn-sm modal-switch-doc-btn" data-sup-idx="${origIdx}" data-ad-side="${sideTag}" style="font-size:11.5px;padding:3px 10px;${
                      isCurrentSupViewing
                        ? "background:#d97706;border-color:#f59e0b;font-weight:700;"
                        : "border-color:rgba(245,158,11,0.45);color:#fde68a;"
                    }">
                      ${isCurrentSupViewing ? "👁️ Đang xem văn bản" : "👁️ Xem nguyên văn"}
                    </button>
                    <a href="${escapeHtml(
                      targetUrl
                    )}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="font-size:11.5px;padding:3px 10px;border-color:rgba(59,130,246,0.5);color:#60a5fa;">
                      📄 File PDF ↗
                    </a>
                  </div>
                </div>`;
                })
                .join("")}
            </div>
          </div>
        `;
      }

      switcherHtml = `
        <div class="detail-box" style="border-color:rgba(148,163,184,0.25);background:rgba(15,23,42,0.7);padding:12px 14px;border-radius:8px;">
          ${currentSection}
          ${supersededSection}
        </div>
      `;
    }

    const fleetRows =
      (ad.affectedFleet || []).length > 0
        ? ad.affectedFleet
            .map(
              (f) => `
              <tr>
                <td><strong style="color:#60a5fa;font-family:monospace;">${escapeHtml(f.reg)}</strong></td>
                <td style="font-family:monospace;color:#fcd34d;font-weight:700;">MSN ${escapeHtml(f.msn)}</td>
                <td><strong>${escapeHtml(f.type || ad.targetModel)}</strong></td>
                <td>${escapeHtml(f.engine || "-")}</td>
                <td><strong>${escapeHtml(ad.effectiveDate)}</strong></td>
              </tr>`
            )
            .join("")
        : `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">Không có tàu bay VJC bị ảnh hưởng (Not Applicable).</td></tr>`;

    const initialVerbatimText = `${viewingDoc.adNumber}\nTitle: ${
      viewingDoc.subject || ad.subject
    }\nIssued Date: ${viewingDoc.issuedDate || viewingDoc.issueDate || "-"}\nEffective Date: ${
      viewingDoc.effectiveDate || "-"
    }\n\n${viewingDoc.summary || ""}`;

    const partBackBanner = (window.lastPartViewContext && window.lastPartViewContext.pn)
      ? `
        <div style="background:linear-gradient(135deg,rgba(59,130,246,0.18),rgba(147,51,234,0.15));border:1px solid rgba(59,130,246,0.5);border-radius:8px;padding:9px 14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:15px;">🧰</span>
            <span style="font-size:13px;color:#bfdbfe;">
              Hồ sơ AD quy định cho Part Number: <strong style="color:#fff;font-family:monospace;font-size:14px;">${escapeHtml(window.lastPartViewContext.pn)}</strong>
            </span>
          </div>
          <button type="button" class="btn btn-primary btn-sm" onclick="window.goBackToPartDetail()" style="display:inline-flex;align-items:center;gap:6px;background:#2563eb;border-color:#3b82f6;color:#fff;font-weight:700;font-size:12px;padding:4px 12px;box-shadow:0 2px 6px rgba(37,99,235,0.35);">
            ◀ Quay lại linh kiện P/N: ${escapeHtml(window.lastPartViewContext.pn)}
          </button>
        </div>
      `
      : "";

    document.getElementById("modalBodyContent").innerHTML = `
      ${partBackBanner}
      ${switcherHtml}

      <!-- 1. Key Identification & Effective Date Grid -->
      <div class="detail-grid" style="grid-template-columns:repeat(3,1fr);">
        <div class="detail-box">
          <div class="label">Số hiệu AD Đang Xem</div>
          <div class="val">${renderAdNumberSplitHtml(viewingDoc, false)}</div>
          <div style="font-size:11.5px;color:#93c5fd;margin-top:4px;">Đọc từ AD: ${escapeHtml(
            viewingDoc.adExtractedModels || ad.adExtractedModels
          )}</div>
          <div style="margin-top:3px;">${renderAdEngineOrClassHtml(ad)}</div>
        </div>
        <div class="detail-box">
          <div class="label">Ngày Hiệu lực (Effective) &amp; Ngày Ban hành (Issued)</div>
          <div class="val" style="color:var(--accent-emerald);font-family:monospace;font-size:15px;">
            📅 Effective: ${escapeHtml(viewingDoc.effectiveDate || ad.effectiveDate)}
          </div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;font-family:monospace;">
            Issued: ${escapeHtml(viewingDoc.issuedDate || viewingDoc.issueDate || ad.issueDate)}
          </div>
        </div>
        <div class="detail-box">
          <div class="label">Đối chiếu Đội bay ${fleetList.length} tàu VJC</div>
          <div class="val" style="color:${isApp ? "#34d399" : "#94a3b8"};">
            ${isApp ? `✅ Applicable (unverified) (${(ad.affectedFleet || []).length}/${fleetList.length} tàu VJC)` : "🚫 Not Applicable"}
          </div>
          <div style="font-size:11.5px;color:var(--text-secondary);margin-top:4px;">
            ${escapeHtml(ad.vjcMatchedSummary)}
          </div>
        </div>
      </div>

      <!-- 2. Reason Box -->
      <div class="detail-box">
        ${renderReasonBoxHtml(viewingDoc.summary || ad.summary)}
      </div>

      <!-- 2.5 Appliances Matched Box (If AD affects specific P/Ns in VJC inventory) -->
      ${ad.appliancesMatched && ad.appliancesMatched.length > 0 ? `
        <div class="detail-box" style="border-color:rgba(59,130,246,0.6);background:rgba(59,130,246,0.06);">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
            <div class="label" style="color:#60a5fa;font-size:12.5px;font-weight:700;">
              🧰 THIẾT BỊ / VẬT TƯ VJC BỊ ẢNH HƯỞNG THEO QUY ĐỊNH CỦA AD (${ad.appliancesMatched.length} Part Number)
            </div>
            <span class="badge" style="background:rgba(59,130,246,0.2);color:#93c5fd;font-size:11px;">
              Đối chiếu danh mục vật tư VJC
            </span>
          </div>
          <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;">
            ${ad.appliancesMatched.map(app => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 12px;background:rgba(255,255,255,0.04);border-radius:6px;border:1px solid rgba(255,255,255,0.08);flex-wrap:wrap;gap:8px;">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                  <strong style="color:#93c5fd;font-family:monospace;font-size:13.5px;">P/N: ${escapeHtml(app.pn)}</strong>
                  <span style="color:var(--text-secondary);font-size:12px;">${escapeHtml(app.desc || '')}</span>
                  <span class="badge badge-standard" style="font-size:10.5px;">${escapeHtml(app.chapter || '')}</span>
                </div>
                <div>
                  <button type="button" class="btn btn-outline btn-sm" onclick="window.viewApplianceDetail('${escapeHtml(app.pn)}')" style="border-color:rgba(59,130,246,0.6);color:#93c5fd;font-size:11.5px;padding:3px 10px;">
                    ✈️ Đang lắp trên ${app.planeCount} tàu VJC (${escapeHtml(app.samplePlanes || '')}) ↗
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- 3. Direct Official AD Links & PDF Attachment (Current AD or Superseded AD PDF) -->
      <div class="detail-box no-print" style="border-color:rgba(16,185,129,0.5);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div class="label" style="color:#34d399;font-size:12px;">
            📎 LINK TÀI LIỆU &amp; BẢN PDF GỐC CỦA ${escapeHtml(viewingDoc.adNumber)}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${renderPdfActionHtml(ad.id, viewingDoc, {
              supIdx: activeSupIdx,
              side: modalSide,
              viewLabel: `📥 Xem Bản PDF của ${viewingDoc.adNumber} ↗`,
              uploadLabel: `📤 Upload PDF cho ${viewingDoc.adNumber}`,
              style: "border-color:#3b82f6;color:#60a5fa;"
            })}
            ${
              getSplitAdParts(viewingDoc).isDual
                ? renderPdfActionHtml(ad.id, viewingDoc, {
                    supIdx: activeSupIdx,
                    side: "easa",
                    viewLabel: `🇪🇺 Mở PDF ${getSplitAdParts(viewingDoc).easaLabel} ↗`,
                    uploadLabel: `📤 Upload PDF ${getSplitAdParts(viewingDoc).easaLabel}`,
                    style: "border-color:rgba(16,185,129,0.55);color:#34d399;"
                  })
                : ""
            }
          </div>
        </div>
      </div>

      <!-- 4. Affected VJC Aircraft Table -->
      <div>
        <h4 style="margin-bottom:8px;font-size:14px;">✈️ Danh sách Tàu bay VJC Áp dụng Chính xác (${
          (ad.affectedFleet || []).length
        } / ${fleetList.length} tàu — Đúng MSN &amp; Động cơ CAAV)</h4>
        <div class="table-responsive" style="border:1px solid var(--border-color);border-radius:var(--radius-sm);max-height:260px;overflow-y:auto;">
          <table class="ad-table">
            <thead>
              <tr>
                <th>Số Đăng ký (Reg)</th>
                <th>MSN Chính thức</th>
                <th>Biến thể Tàu bay</th>
                <th>Động cơ</th>
                <th>Ngày Effective</th>
              </tr>
            </thead>
            <tbody>${fleetRows}</tbody>
          </table>
        </div>
      </div>
    `;

    // Bind switcher buttons between Current AD (FAA / EASA) and Superseded ADs
    document.querySelectorAll(".modal-switch-doc-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rawIdx = btn.getAttribute("data-sup-idx");
        const side = btn.getAttribute("data-ad-side") || "faa";
        openAdModal(ad.id, rawIdx === "" ? null : Number(rawIdx), side);
      });
    });

    document.getElementById("adDetailModal").classList.add("open");
  }

  // Export CSV (Clean Verbatim Columns + Superseded PDFs)
  function exportCsv() {
    if (!requireAdmin()) return;
    const headers = [
      "AD_Number",
      "Superseded_ADs_And_PDFs",
      "Authority",
      "Issued_Date",
      "Effective_Date",
      "AD_Extracted_Models",
      "AD_Extracted_Engines",
      "AD_MSN_Scope",
      "VJC_Matched_Fleet",
      "ATA",
      "Applicability_Decision",
      "Verbatim_Title",
      "Verbatim_AD_Text",
      "PDF_Attachment_URL",
      "Affected_VJC_Count"
    ];
    const rows = adList.map((a) => [
      a.adNumber,
      (a.supersededAds || []).map((s) => `${s.adNumber} (${s.pdfUrl || ""})`).join(" | ") || "None",
      a.authority,
      a.issueDate,
      a.effectiveDate,
      a.adExtractedModels || a.targetModel,
      a.adExtractedEngines || "",
      a.adMsnScope || "",
      a.vjcMatchedSummary || "",
      a.ata,
      a.applicabilityStatus,
      a.subject || "",
      a.summary || "",
      a.pdfUrl || "",
      a.affectedCount || (a.affectedFleet || []).length
    ]);

    const csvContent =
      "\uFEFF" +
      [headers, ...rows]
        .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
        .join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `VJC_Verbatim_AD_Database_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("📥 Đã xuất CSDL (kèm Nguyên văn Text AD & Link PDF của cả AD hiện hành lẫn AD Superseded) ra CSV!");
  }

  function exportJson() {
    if (!requireAdmin()) return;
    const blob = new Blob([JSON.stringify({ fleet: fleetList, ads: adList }, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aeroad-database-backup.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("💾 Đã tải xuống file cơ sở dữ liệu JSON!");
  }

  function refreshAllViews() {
    populateAircraftDropdowns();
    populateAdAtaDropdown();
    populateApplianceAtaDropdown();
    updateKpis();
    renderAdTable();
    renderAutoEvaluationsTab();
    renderFleetTab();
    renderDashboard();
    filterAndRenderAppliances();
  }

  function initEvents() {
    document.querySelectorAll(".nav-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".nav-tab").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        try {
          btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        } catch (e) {}
        const tabId = btn.getAttribute("data-tab");
        const target = document.getElementById(tabId);
        if (target) target.classList.add("active");

        // Hide top AD summary banner & AD KPI cards on IPC and Part tabs
        const isPartTab = tabId === "tab-ipc" || tabId === "tab-appliances";
        const autoPanel = document.getElementById("automationStatusPanel");
        const kpiGrid = document.getElementById("kpiGrid");
        if (autoPanel) autoPanel.style.display = isPartTab ? "none" : "";
        if (kpiGrid) kpiGrid.style.display = isPartTab ? "none" : "";
      });
    });

    // Admin Authentication & Admin Options
    const btnAdminAuth = document.getElementById("btnAdminAuth");
    const btnAdminLogout = document.getElementById("btnAdminLogout");
    const adminLoginModal = document.getElementById("adminLoginModal");
    const closeAdminModal = () => {
      if (adminLoginModal) adminLoginModal.classList.remove("open");
    };
    const logoutAdmin = () => {
      try {
        sessionStorage.removeItem(ADMIN_SESSION_KEY);
      } catch (e) {}
      applyAdminUiState();
      showToast("🔒 Đã đăng xuất khỏi chế độ Admin.");
    };

    if (btnAdminAuth) {
      btnAdminAuth.addEventListener("click", () => {
        if (isAdminLoggedIn()) {
          logoutAdmin();
        } else {
          openAdminLoginModal();
        }
      });
    }
    if (btnAdminLogout) {
      btnAdminLogout.addEventListener("click", logoutAdmin);
    }
    const btnCloseAdminLogin = document.getElementById("btnCloseAdminLogin");
    const btnCancelAdminLogin = document.getElementById("btnCancelAdminLogin");
    if (btnCloseAdminLogin) btnCloseAdminLogin.addEventListener("click", closeAdminModal);
    if (btnCancelAdminLogin) btnCancelAdminLogin.addEventListener("click", closeAdminModal);

    const formAdminLogin = document.getElementById("formAdminLogin");
    if (formAdminLogin) {
      formAdminLogin.addEventListener("submit", (e) => {
        e.preventDefault();
        const u = (document.getElementById("adminUsername").value || "").trim();
        const p = document.getElementById("adminPassword").value || "";
        const errEl = document.getElementById("adminLoginError");
        if (u === ADMIN_CREDENTIALS.user && p === ADMIN_CREDENTIALS.pass) {
          try {
            sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
          } catch (err) {}
          applyAdminUiState();
          closeAdminModal();
          showToast("🔓 Đăng nhập Admin thành công! Đã mở Option Admin.");
        } else if (errEl) {
          errEl.textContent = "❌ Sai tài khoản hoặc mật khẩu Admin.";
          errEl.style.display = "block";
        }
      });
    }

    const btnTriggerSync = document.getElementById("btnTriggerSyncBanner");
    if (btnTriggerSync) btnTriggerSync.addEventListener("click", runBiweeklyAdSync);

    // Rescan Fleet Buttons -> Open File Picker (CSV Fleet Import) & Add Aircraft Modal
    const fleetCsvInput = document.getElementById("fleetCsvFileInput");
    const triggerFleetCsvPicker = () => {
      if (!requireAdmin()) return;
      if (fleetCsvInput) fleetCsvInput.click();
    };
    if (fleetCsvInput) {
      fleetCsvInput.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        await importFleetFromCsvFile(file);
        fleetCsvInput.value = "";
      });
    }

    const btnRescanHeader = document.getElementById("btnRescanFleetHeader");
    if (btnRescanHeader) btnRescanHeader.addEventListener("click", triggerFleetCsvPicker);
    const btnRescanTab = document.getElementById("btnRescanFleetTab");
    if (btnRescanTab) btnRescanTab.addEventListener("click", triggerFleetCsvPicker);
    const btnExecRescanNow = document.getElementById("btnExecuteRescanNow");
    if (btnExecRescanNow) btnExecRescanNow.addEventListener("click", triggerFleetCsvPicker);
    const btnRescanCaavFolder = document.getElementById("btnRescanCaavFolder");
    if (btnRescanCaavFolder) {
      btnRescanCaavFolder.addEventListener("click", () => rescanVjcFleet(null, false));
    }
    const fleetModal = document.getElementById("fleetRescanModal");
    const btnOpenAddAc = document.getElementById("btnOpenAddAircraftModal");
    if (btnOpenAddAc && fleetModal) {
      btnOpenAddAc.addEventListener("click", () => {
        renderFleetScanReportHtml(lastFleetScanReport);
        fleetModal.classList.add("open");
      });
    }
    const btnCloseFleetModal = document.getElementById("btnCloseFleetModal");
    if (btnCloseFleetModal && fleetModal) {
      btnCloseFleetModal.addEventListener("click", () => fleetModal.classList.remove("open"));
    }

    const newAcTypeSel = document.getElementById("newAcType");
    const newAcEngineSel = document.getElementById("newAcEngine");
    if (newAcTypeSel && newAcEngineSel) {
      newAcTypeSel.addEventListener("change", () => {
        const v = newAcTypeSel.value;
        if (v === "A321-271NX" || v === "A321-271N") newAcEngineSel.value = "PW1133G-JM";
        else if (v === "A321-211") newAcEngineSel.value = "CFM56-5B3/3";
        else if (v === "A320-214") newAcEngineSel.value = "CFM56-5B4/3";
        else if (v === "A330-343") newAcEngineSel.value = "Trent 772B-60";
        else if (v === "A330-941") newAcEngineSel.value = "Trent 7000-72";
      });
    }

    const formAddAc = document.getElementById("formAddNewAircraft");
    if (formAddAc) {
      formAddAc.addEventListener("submit", async (e) => {
        e.preventDefault();
        const payload = {
          reg: document.getElementById("newAcReg").value.trim().toUpperCase(),
          msn: document.getElementById("newAcMsn").value.trim(),
          type: document.getElementById("newAcType").value,
          engine: document.getElementById("newAcEngine").value,
          fh: Number(document.getElementById("newAcFh").value) || 500,
          fc: Math.round((Number(document.getElementById("newAcFh").value) || 500) * 0.6),
          base: document.getElementById("newAcBase").value
        };
        await rescanVjcFleet(payload, false);
        formAddAc.reset();
        const regSel = document.getElementById("filterAircraftReg");
        if (regSel) {
          regSel.value = payload.reg;
          renderAdTable();
        }
      });
    }

    // Export currently filtered AD list (respects all active filters, search keyword & sort) to Excel
    const btnExportAds = document.getElementById("btnExportFilteredAds");
    if (btnExportAds) {
      btnExportAds.addEventListener("click", () => {
        const rows = getFilteredAds();
        if (rows.length === 0) {
          showToast("⚠️ Không có AD nào theo bộ lọc hiện tại để xuất.");
          return;
        }

        const selText = (id) => {
          const el = document.getElementById(id);
          if (!el) return "";
          if (el.tagName === "SELECT") return el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : "";
          return el.value || "";
        };
        const filterDesc = [
          ["Từ khóa", selText("searchKeyword") || "(không)"],
          ["Cơ quan", selText("filterAuthority")],
          ["Áp dụng", selText("filterApplicability")],
          ["Superseded", selText("filterSuperseded")],
          ["Model", selText("filterModel")],
          ["Tàu bay", selText("filterAircraftReg")],
          ["Chương ATA", selText("filterAdAta")],
          ["Sắp xếp", selText("sortSelect")]
        ]
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}: ${v}`)
          .join(" | ");

        const absUrl = (u) => {
          if (!u) return "";
          return /^https?:\/\//i.test(u) ? u : `${location.origin}${u.startsWith("/") ? "" : "/"}${u}`;
        };
        const cell = (v) => `<td style="mso-number-format:'\\@';vertical-align:top;">${escapeHtml(v)}</td>`;

        const headers = [
          "STT",
          "Số hiệu AD",
          "FAA AD",
          "EASA AD",
          "Cơ quan",
          "ATA",
          "Tiêu đề (Subject)",
          "Ngày ban hành",
          "Ngày hiệu lực",
          "Áp dụng VJC",
          "Model (đọc từ AD)",
          "Động cơ",
          "Khớp đội bay VJC",
          "Số tàu ảnh hưởng",
          "AD bị thay thế (Superseded)",
          "Link PDF",
          "Link EASA",
          "Nội dung tóm tắt"
        ];

        const bodyRows = rows
          .flatMap((ad, i) => {
            const sups = (ad.supersededAds || []).map((s) => s.adNumber).join("; ");
            const splitInfo = getSplitAdParts(ad);
            if (splitInfo.isDual) {
              const easaFirst = isEasaPrimaryDual(ad);
              const makeFaaRow = (subIdx) =>
                "<tr>" +
                [
                  `${i + 1}${subIdx}`,
                  splitInfo.faaLabel,
                  ad.officialFaaAd,
                  ad.easaAdNumber,
                  "FAA",
                  ad.ata,
                  ad.subject,
                  ad.issueDate || ad.issuedDate,
                  ad.effectiveDate,
                  ad.applicabilityStatus,
                  ad.adExtractedModels,
                  ad.adExtractedEngines,
                  ad.applicabilityStatus === "Applicable" ? ad.vjcMatchedSummary : "",
                  ad.affectedCount || 0,
                  sups,
                  absUrl(getSafePdfUrl(ad)),
                  getSafeEasaUrl(ad),
                  ad.summary
                ]
                  .map(cell)
                  .join("") +
                "</tr>";
              const makeEasaRow = (subIdx) =>
                "<tr>" +
                [
                  `${i + 1}${subIdx}`,
                  splitInfo.easaLabel,
                  ad.officialFaaAd,
                  ad.easaAdNumber,
                  "EASA",
                  ad.ata,
                  ad.easaSubject || ad.subject,
                  ad.easaIssuedDate || ad.issueDate || ad.issuedDate,
                  ad.easaEffectiveDate || ad.effectiveDate,
                  ad.applicabilityStatus,
                  ad.easaModels || ad.adExtractedModels,
                  ad.adExtractedEngines,
                  ad.applicabilityStatus === "Applicable" ? ad.vjcMatchedSummary : "",
                  ad.affectedCount || 0,
                  sups,
                  getSafeEasaUrl(ad),
                  getSafeEasaUrl(ad),
                  ad.easaSummary || ad.summary
                ]
                  .map(cell)
                  .join("") +
                "</tr>";
              return easaFirst ? [makeEasaRow("a"), makeFaaRow("b")] : [makeFaaRow("a"), makeEasaRow("b")];
            }
            return [
              "<tr>" +
              [
                i + 1,
                ad.adNumber,
                ad.officialFaaAd,
                ad.easaAdNumber,
                ad.authorityDual || ad.authority,
                ad.ata,
                ad.subject,
                ad.issueDate || ad.issuedDate,
                ad.effectiveDate,
                ad.applicabilityStatus,
                ad.adExtractedModels,
                ad.adExtractedEngines,
                ad.applicabilityStatus === "Applicable" ? ad.vjcMatchedSummary : "",
                ad.affectedCount || 0,
                sups,
                absUrl(getSafePdfUrl(ad)),
                getSafeEasaUrl(ad),
                ad.summary
              ]
                .map(cell)
                .join("") +
              "</tr>"
            ];
          })
          .join("");

        const now = new Date();
        const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>AD List</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>
<body>
<table border="1" style="border-collapse:collapse;font-family:Calibri;font-size:11pt;">
<tr><td colspan="${headers.length}" style="font-weight:bold;font-size:14pt;">VJC — Danh sách AD (${rows.length} AD) — Xuất lúc ${escapeHtml(
          now.toLocaleString("vi-VN")
        )}</td></tr>
<tr><td colspan="${headers.length}" style="font-style:italic;">Bộ lọc: ${escapeHtml(filterDesc)}</td></tr>
<tr>${headers.map((h) => `<th style="background:#1e3a8a;color:#ffffff;">${escapeHtml(h)}</th>`).join("")}</tr>
${bodyRows}
</table></body></html>`;

        const blob = new Blob(["\ufeff" + html], { type: "application/vnd.ms-excel;charset=utf-8" });
        const pad = (n) => String(n).padStart(2, "0");
        const fname = `VJC_AD_List_${rows.length}AD_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
          now.getDate()
        )}_${pad(now.getHours())}${pad(now.getMinutes())}.xls`;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          URL.revokeObjectURL(a.href);
          a.remove();
        }, 500);
        showToast(`✅ Đã xuất ${rows.length} AD theo bộ lọc hiện tại ra file ${fname}`);
      });
    }

    const btnToggleSup = document.getElementById("btnToggleAllSuperseded");
    if (btnToggleSup) {
      btnToggleSup.addEventListener("click", () => {
        expandAllSuperseded = !expandAllSuperseded;
        document.querySelectorAll("details.superseded-dropdown").forEach((d) => {
          d.open = expandAllSuperseded;
        });
        showToast(
          expandAllSuperseded
            ? "📂 Đã mở rộng tất cả Dropdown chứa AD bị Superseded & Link PDF!"
            : "📁 Đã thu gọn các Dropdown AD Superseded!"
        );
      });
    }

    // When selecting a Superseded AD in the dropdown, expand the inline Superseded panel (without opening modal);
    // switching back to CURRENT collapses it cleanly.
    document.body.addEventListener("change", (e) => {
      if (e.target.classList.contains("superseded-chain-select")) {
        const wrapper = e.target.closest(".superseded-group-wrapper");
        const val = e.target.value;
        if (wrapper) {
          const det = wrapper.querySelector("details.superseded-dropdown");
          const items = wrapper.querySelectorAll(".superseded-item");
          items.forEach((el) => el.classList.remove("is-selected"));

          if (val === "CURRENT") {
            if (det) det.open = false;
          } else if (val.startsWith("SUP_")) {
            const supIdx = val.replace("SUP_", "");
            if (det) det.open = true;
            const targetItem = wrapper.querySelector(`.superseded-item[data-sup-idx="${supIdx}"]`);
            if (targetItem) {
              targetItem.classList.add("is-selected");
              targetItem.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }
          }
        }
      }
    });

    // Keep select synced when user manually collapses the superseded dropdown via <summary>
    document.body.addEventListener(
      "toggle",
      (e) => {
        const det = e.target;
        if (det && det.classList && det.classList.contains("superseded-dropdown") && !det.open) {
          const wrapper = det.closest(".superseded-group-wrapper");
          const sel = wrapper ? wrapper.querySelector(".superseded-chain-select") : null;
          if (sel && sel.value !== "CURRENT") sel.value = "CURRENT";
          if (wrapper) {
            wrapper.querySelectorAll(".superseded-item.is-selected").forEach((el) => el.classList.remove("is-selected"));
          }
        }
      },
      true
    );

    // Global click handlers for "Xem PDF & Chi tiết AD cũ"
    document.body.addEventListener("click", (e) => {
      const btnSupModal = e.target.closest(".btn-open-sup-modal");
      if (btnSupModal) {
        e.stopPropagation();
        const adId = btnSupModal.getAttribute("data-ad-id");
        const supIdx = Number(btnSupModal.getAttribute("data-sup-idx"));
        openAdModal(adId, supIdx);
        return;
      }

      const btnOpenEval = e.target.closest(".btn-open-eval-modal");
      if (btnOpenEval) {
        e.stopPropagation();
        openAdModal(btnOpenEval.getAttribute("data-ad-id"), null);
      }
    });

    // Attach Local PDF File inside Modal (persists to server /db/uploaded-pdfs/)
    const pdfInput = document.getElementById("attachLocalPdfInput");
    if (pdfInput) {
      pdfInput.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file || !activeAdId) return;
        await uploadPdfFileForAd(file, activeAdId, activeSupIdx, activeAdSide);
        pdfInput.value = "";
      });
    }

    // Inline Upload PDF buttons across Table / Cards / Fleet / Modal
    const globalUploadInput = document.getElementById("globalRowPdfUploadInput");
    if (globalUploadInput) {
      globalUploadInput.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file || !pendingUploadTarget) return;
        const { adId, supIdx, side } = pendingUploadTarget;
        pendingUploadTarget = null;
        await uploadPdfFileForAd(file, adId, supIdx, side);
        globalUploadInput.value = "";
      });
    }

    document.addEventListener("click", (e) => {
      const btnUp = e.target.closest(".btn-upload-ad-pdf");
      if (btnUp && globalUploadInput) {
        e.preventDefault();
        e.stopPropagation();
        pendingUploadTarget = {
          adId: btnUp.getAttribute("data-ad-id"),
          supIdx: btnUp.getAttribute("data-sup-idx"),
          side: btnUp.getAttribute("data-ad-side") || "main"
        };
        globalUploadInput.click();
        return;
      }

      const chip = e.target.closest(".active-filter-chip");
      if (chip) {
        const fid = chip.getAttribute("data-clear-filter-id");
        const fdef = chip.getAttribute("data-clear-default") || "";
        const targetEl = fid ? document.getElementById(fid) : null;
        if (targetEl) {
          targetEl.value = fdef;
          if (fid === "filterAircraftReg") {
            const evalSel = document.getElementById("evalFilterAircraftReg");
            if (evalSel) evalSel.value = fdef;
            renderAutoEvaluationsTab();
          }
          currentPage = 1;
          renderAdTable();
        }
      }
    });

    // KPI Quick Filters (Scoped strictly to top AD KPI cards in #kpiGrid)
    document.querySelectorAll("#kpiGrid .kpi-card").forEach((card) => {
      card.addEventListener("click", () => {
        const qf = card.getAttribute("data-QuickFilter");
        if (!qf) return;
        if (qf === "FLEET") {
          document.querySelector('.nav-tab[data-tab="tab-fleet"]').click();
          return;
        }
        document.getElementById("btnResetFilters").click();
        if (qf === "APPLICABLE") {
          document.getElementById("filterApplicability").value = "Applicable";
        } else if (qf === "NOT_APPLICABLE") {
          document.getElementById("filterApplicability").value = "Not Applicable";
        } else if (qf === "SUPERSEDED") {
          const sf = document.getElementById("filterSuperseded");
          if (sf) sf.value = "HAS_SUPERSEDED";
          expandAllSuperseded = true;
        }
        currentPage = 1;
        renderAdTable();
        document.querySelector('.nav-tab[data-tab="tab-register"]').click();
      });
    });

    [
      "searchKeyword",
      "filterAuthority",
      "filterApplicability",
      "filterAdType",
      "filterSuperseded",
      "filterModel",
      "filterAircraftReg",
      "filterAdAta",
      "sortSelect"
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        const handler = () => {
          if (id === "filterAircraftReg") {
            const evalSel = document.getElementById("evalFilterAircraftReg");
            if (evalSel) evalSel.value = el.value;
            renderAutoEvaluationsTab();
          }
          currentPage = 1;
          renderAdTable();
        };
        el.addEventListener("input", handler);
        el.addEventListener("change", handler);
      }
    });

    const evalRegSel = document.getElementById("evalFilterAircraftReg");
    if (evalRegSel) {
      evalRegSel.addEventListener("change", () => {
        const mainRegSel = document.getElementById("filterAircraftReg");
        if (mainRegSel) mainRegSel.value = evalRegSel.value;
        currentPage = 1;
        renderAdTable();
        renderAutoEvaluationsTab();
      });
    }

    document.getElementById("btnResetFilters").addEventListener("click", () => {
      document.getElementById("searchKeyword").value = "";
      document.getElementById("filterAuthority").value = "ALL";
      document.getElementById("filterApplicability").value = "ALL";
      const adt = document.getElementById("filterAdType");
      if (adt) adt.value = "ALL";
      const sf = document.getElementById("filterSuperseded");
      if (sf) sf.value = "ALL";
      document.getElementById("filterModel").value = "ALL";
      const af = document.getElementById("filterAircraftReg");
      if (af) af.value = "ALL";
      const ataEl = document.getElementById("filterAdAta");
      if (ataEl) ataEl.value = "ALL";
      const eaf = document.getElementById("evalFilterAircraftReg");
      if (eaf) eaf.value = "ALL";
      document.getElementById("sortSelect").value = "applicableFirst";
      expandAllSuperseded = false;
      currentPage = 1;
      pageSize = 150;
      renderAdTable();
      renderAutoEvaluationsTab();
    });

    document.getElementById("adTableBody").addEventListener("click", (e) => {
      const expandBtn = e.target.closest(".mobile-expand-btn");
      if (expandBtn) {
        e.stopPropagation();
        const tr = expandBtn.closest("tr[data-ad-id]");
        if (tr) {
          const isOpen = tr.classList.toggle("mobile-expanded");
          expandBtn.textContent = isOpen ? "▴" : "▾";
          expandBtn.setAttribute("aria-expanded", String(isOpen));
        }
        return;
      }
      if (e.target.closest(".superseded-group-wrapper")) return;
      if (window.getSelection && window.getSelection().toString().trim().length > 0) return;
      const tr = e.target.closest("tr[data-ad-id]");
      if (tr) openAdModal(tr.getAttribute("data-ad-id"), null, tr.getAttribute("data-ad-side") || null);
    });

    document.getElementById("fleetMatrixBody").addEventListener("click", (e) => {
      if (window.getSelection && window.getSelection().toString().trim().length > 0) return;
      const tr = e.target.closest("tr[data-ad-id]");
      if (tr) openAdModal(tr.getAttribute("data-ad-id"), null, tr.getAttribute("data-ad-side") || null);
    });

    document.getElementById("fleetSelectFilter").addEventListener("change", renderFleetTab);

    document.getElementById("btnCloseDetailModal").addEventListener("click", () => {
      document.getElementById("adDetailModal").classList.remove("open");
    });

    document.getElementById("btnToggleTheme").addEventListener("click", () => {
      document.body.classList.toggle("light-mode");
    });
    document.getElementById("btnExportCsv").addEventListener("click", exportCsv);
    document.getElementById("btnExportJson").addEventListener("click", exportJson);

    const newModal = document.getElementById("newAdModal");
    document.getElementById("btnOpenNewAdModal").addEventListener("click", () => {
      if (!requireAdmin()) return;
      document.getElementById("newAdEffectiveDate").value = new Date().toISOString().slice(0, 10);
      newModal.classList.add("open");
    });
    document.getElementById("btnCloseNewAdModal").addEventListener("click", () => newModal.classList.remove("open"));
    document.getElementById("btnCancelNewAd").addEventListener("click", () => newModal.classList.remove("open"));

    document.getElementById("formNewAd").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!requireAdmin()) return;
      const num = document.getElementById("newAdNumber").value.trim();
      const auth = document.getElementById("newAdAuthority").value;
      const eff = document.getElementById("newAdEffectiveDate").value;
      const target = document.getElementById("newAdTargetModel").value.trim();
      const pdf = document.getElementById("newAdPdfUrl").value.trim();
      const subj = document.getElementById("newAdSubject").value.trim();
      const sum = document.getElementById("newAdSummary").value.trim();

      const evaluated = evaluateAdAgainstVjcFleet({
        document_number: num,
        publication_date: eff,
        effective_on: eff,
        pdf_url: pdf || undefined,
        title: subj,
        abstract: sum
      });
      evaluated.adNumber = `${auth} AD ${num}`;
      evaluated.authority = auth;
      evaluated.authorityDual = auth;
      evaluated.adExtractedModels = target;

      adList.unshift(evaluated);
      await persistDatabase();
      refreshAllViews();
      newModal.classList.remove("open");
      e.target.reset();
      showToast(`✅ Đã lưu nguyên văn AD ${num} (${auth}) vào CSDL!`);
    });

    initApplianceEvents();
  }

  // ==========================================
  // APPLIANCES & EQUIPMENT INTEGRATION MODULE
  // ==========================================
  let appliancesCatalog = [];
  let appliancesMetadata = null;
  let applianceCurrentPage = 1;
  const appliancePageSize = 50;
  let applianceViewMode = "PN"; // "PN" | "AD"
  let filteredAppliances = [];
  let filteredApplianceAds = [];

  async function loadAppliancesCatalog() {
    try {
      const resp = await fetch("./db/vjc-appliances-catalog.json");
      if (resp.ok) {
        const data = await resp.json();
        appliancesMetadata = data.metadata || null;
        appliancesCatalog = data.appliances || [];
        updateApplianceKpis();
        filterAndRenderAppliances();
      }
    } catch (e) {
      console.warn("Failed to load appliances catalog:", e);
    }
  }

  function updateApplianceKpis() {
    if (!appliancesMetadata) return;
    const elTotParts = document.getElementById("kpiValTotalParts");
    if (elTotParts) elTotParts.textContent = Number(appliancesMetadata.totalRows || 150633).toLocaleString();
    const elUniqPn = document.getElementById("kpiValUniquePn");
    if (elUniqPn) elUniqPn.textContent = Number(appliancesMetadata.totalUniquePn || 3987).toLocaleString();
    const elPnAds = document.getElementById("kpiValPnWithAds");
    if (elPnAds) elPnAds.textContent = Number(appliancesMetadata.pnsWithAds || 55).toLocaleString();
    const elAffAds = document.getElementById("kpiValAffectedAds");
    if (elAffAds) elAffAds.textContent = Number(appliancesMetadata.adCountMatching || 45).toLocaleString();

    const countBadge = document.getElementById("navCountAppliances");
    if (countBadge) {
      countBadge.textContent = appliancesMetadata.pnsWithAds || 55;
    }
  }

  function getApplianceAdsList(item) {
    if (!item || !item.matchedAds) return [];
    if (Array.isArray(item.matchedAds)) return item.matchedAds;
    if (typeof item.matchedAds === "object" && item.matchedAds.adNumber) return [item.matchedAds];
    return [];
  }

  function filterAndRenderAppliances() {
    const searchKw = (document.getElementById("filterApplianceSearch")?.value || "").trim().toLowerCase();
    const chapterFilter = document.getElementById("filterApplianceChapter")?.value || "ALL";
    const ataFilter = document.getElementById("filterApplianceAta")?.value || "ALL";
    const typeFilter = document.getElementById("filterApplianceType")?.value || "ALL";
    const planeFilter = document.getElementById("filterAppliancePlane")?.value || "ALL";
    const adStatusFilter = document.getElementById("filterApplianceAdStatus")?.value || "HAS_AD";

    if (applianceViewMode === "PN") {
      filteredAppliances = appliancesCatalog.filter((item) => {
        if (adStatusFilter === "HAS_AD" && !item.hasAd) return false;
        if (adStatusFilter === "NO_AD" && item.hasAd) return false;

        if (chapterFilter !== "ALL" && item.chapter !== chapterFilter) return false;
        if (typeFilter !== "ALL" && (!item.types || !item.types.includes(typeFilter))) return false;
        if (planeFilter !== "ALL" && (!item.planes || !item.planes.some((p) => p.reg === planeFilter))) return false;

        if (ataFilter !== "ALL") {
          const itemAds = getApplianceAdsList(item);
          if (!itemAds.some((a) => {
            const realAd = adList.find((x) => (a.adId && x.id === a.adId) || (a.adNumber && x.adNumber === a.adNumber));
            const adAta = String((realAd && realAd.ata) || a.ata || "");
            const m = adAta.match(/ATA\s*(\d{2})/i) || adAta.match(/^(\d{2})/);
            return m && m[1] === ataFilter;
          })) return false;
        }

        if (searchKw) {
          const matchPn = (item.pn || "").toLowerCase().includes(searchKw);
          const matchDesc = (item.desc || "").toLowerCase().includes(searchKw);
          const itemAds = getApplianceAdsList(item);
          const matchAd = itemAds.some(
            (a) => (a.adNumber || "").toLowerCase().includes(searchKw) || (a.subject || "").toLowerCase().includes(searchKw)
          );
          if (!matchPn && !matchDesc && !matchAd) return false;
        }
        return true;
      });

      // Sort: items with ADs first, then by ATA ascending (ATA 21 -> 25 -> 28 -> 32 -> 35 -> 52 -> 53 -> 57 -> 71 -> 72), then by P/N
      filteredAppliances.sort((a, b) => {
        if (a.hasAd !== b.hasAd) return a.hasAd ? -1 : 1;
        const ataA = (a.matchedAds && a.matchedAds[0] && a.matchedAds[0].ata) || "";
        const ataB = (b.matchedAds && b.matchedAds[0] && b.matchedAds[0].ata) || "";
        const codeA = (ataA.match(/(\d{2})/) || [])[1] || "";
        const codeB = (ataB.match(/(\d{2})/) || [])[1] || "";
        if (codeA && codeB) {
          const numA = parseInt(codeA, 10);
          const numB = parseInt(codeB, 10);
          if (numA !== numB) return numA - numB;
        } else if (codeA) return -1;
        else if (codeB) return 1;
        return (a.pn || "").localeCompare(b.pn || "");
      });

      applianceCurrentPage = 1;
      renderAppliancesPnTable();
    } else {
      // AD View Mode: collect all ADs from adList that have appliancesMatched
      const adPool = adList.filter((a) => a.appliancesMatched && a.appliancesMatched.length > 0);
      filteredApplianceAds = adPool.filter((ad) => {
        if (chapterFilter !== "ALL" && !ad.appliancesMatched.some((m) => m.chapter === chapterFilter)) return false;
        if (planeFilter !== "ALL" && (!ad.affectedFleet || !ad.affectedFleet.some((f) => f.reg === planeFilter))) return false;
        if (typeFilter !== "ALL" && (!ad.matchedTypes || !ad.matchedTypes.some((t) => t.includes(typeFilter)))) return false;

        if (ataFilter !== "ALL") {
          const adAta = String(ad.ata || "");
          const m = adAta.match(/ATA\s*(\d{2})/i) || adAta.match(/^(\d{2})/);
          if (!m || m[1] !== ataFilter) return false;
        }

        if (searchKw) {
          const matchNum = (ad.adNumber || "").toLowerCase().includes(searchKw);
          const matchSubj = (ad.subject || "").toLowerCase().includes(searchKw);
          const matchPn = ad.appliancesMatched.some(
            (m) => (m.pn || "").toLowerCase().includes(searchKw) || (m.desc || "").toLowerCase().includes(searchKw)
          );
          if (!matchNum && !matchSubj && !matchPn) return false;
        }
        return true;
      });

      filteredApplianceAds.sort((a, b) => {
        const codeA = (String(a.ata || "").match(/(\d{2})/) || [])[1] || "";
        const codeB = (String(b.ata || "").match(/(\d{2})/) || [])[1] || "";
        if (codeA && codeB) {
          const numA = parseInt(codeA, 10);
          const numB = parseInt(codeB, 10);
          if (numA !== numB) return numA - numB;
        } else if (codeA) return -1;
        else if (codeB) return 1;
        return (a.adNumber || "").localeCompare(b.adNumber || "");
      });
      applianceCurrentPage = 1;
      renderAppliancesAdsTable();
    }
  }

  function renderAppliancesPnTable() {
    const tbody = document.getElementById("appliancesPnTableBody");
    const titleEl = document.getElementById("appliancesTableTitle");
    const countEl = document.getElementById("appliancesCounterText");
    const pageInfo = document.getElementById("appliancesPageInfo");
    if (!tbody) return;

    if (titleEl) titleEl.textContent = "Bảng Danh Mục Thiết Bị, Vật Tư & AD Quy Định";
    if (countEl) countEl.textContent = `Hiển thị ${filteredAppliances.length.toLocaleString()} Part Number`;

    const totalPages = Math.ceil(filteredAppliances.length / appliancePageSize) || 1;
    if (applianceCurrentPage > totalPages) applianceCurrentPage = totalPages;
    if (applianceCurrentPage < 1) applianceCurrentPage = 1;

    if (pageInfo) {
      pageInfo.textContent = `Trang ${applianceCurrentPage} / ${totalPages} (${filteredAppliances.length.toLocaleString()} P/N)`;
    }

    const startIdx = (applianceCurrentPage - 1) * appliancePageSize;
    const pageItems = filteredAppliances.slice(startIdx, startIdx + appliancePageSize);

    if (pageItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text-secondary);">Không tìm thấy thiết bị nào phù hợp với bộ lọc hiện tại.</td></tr>`;
      return;
    }

    tbody.innerHTML = pageItems
      .map((item) => {
        const itemAds = getApplianceAdsList(item);
        const adHtml =
          itemAds.length > 0
            ? `<div style="display:flex;flex-direction:column;gap:4px;">` +
              itemAds
                .map((a) => {
                  const authBadge = (a.authority || "").includes("EASA")
                    ? `<span class="badge badge-easa" style="font-size:10px;padding:2px 5px;">EASA</span>`
                    : `<span class="badge badge-faa" style="font-size:10px;padding:2px 5px;">FAA</span>`;
                  return `
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                      ${authBadge}
                      <a href="javascript:void(0)" onclick="window.viewAdFromAppliance('${escapeHtml(a.adId || '')}')" style="color:#60a5fa;font-size:12px;font-weight:600;text-decoration:underline;">
                        ${escapeHtml(a.adNumber)}
                      </a>
                      ${
                        a.pdfUrl
                          ? `<a href="${escapeHtml(a.pdfUrl)}" target="_blank" rel="noopener" class="badge" style="background:rgba(16,185,129,0.18);border:1px solid rgba(16,185,129,0.4);color:#34d399;font-size:10px;padding:2px 6px;">📄 PDF ↗</a>`
                          : ""
                      }
                    </div>
                  `;
                })
                .join("") +
              `</div>`
            : `<span style="font-size:12px;color:var(--text-secondary);">Chưa ghi nhận AD điều chỉnh</span>`;

        const typeBadges = (item.types || [])
          .map((t) => `<span class="badge badge-standard" style="font-size:10.5px;">${escapeHtml(t)}</span>`)
          .join(" ");

        let ataBadge = "";
        const rawAta = (item.matchedAds && item.matchedAds[0] && item.matchedAds[0].ata) || "";
        const mCode = rawAta.match(/(\d{2})/);
        if (mCode) {
          ataBadge = `<span class="badge" style="background:rgba(6,182,212,0.18);border:1px solid rgba(6,182,212,0.45);color:#67e8f9;font-weight:700;font-size:11px;padding:2px 6px;margin-bottom:3px;display:inline-block;">ATA ${mCode[1]}</span><br/>`;
        }

        return `
          <tr style="cursor:pointer;" onclick="window.viewApplianceDetail('${escapeHtml(item.pn)}')">
            <td>
              <div style="display:flex;align-items:center;gap:6px;">
                <strong style="color:#93c5fd;font-family:monospace;font-size:13.5px;">${escapeHtml(item.pn)}</strong>
                ${item.hasAd ? `<span class="badge badge-warning" style="font-size:10px;padding:2px 6px;">⚠️ Có AD</span>` : ""}
              </div>
            </td>
            <td>
              <div style="font-weight:600;color:#fff;">${escapeHtml(item.desc || "Thiết bị không tên")}</div>
            </td>
            <td>
              ${ataBadge}
              <span class="badge badge-standard" style="font-size:10.5px;">${escapeHtml(item.chapter || "Chưa phân loại")}</span>
            </td>
            <td>${typeBadges || "—"}</td>
            <td>
              <span class="badge" style="background:rgba(59,130,246,0.18);border:1px solid rgba(59,130,246,0.4);color:#bfdbfe;font-size:11.5px;padding:3px 8px;">
                ✈️ ${item.planeCount || 0} tàu (${item.totalQty || 0} chi tiết)
              </span>
            </td>
            <td onclick="event.stopPropagation();">${adHtml}</td>
          </tr>
        `;
      })
      .join("");
  }

  function renderAppliancesAdsTable() {
    const tbody = document.getElementById("appliancesAdsTableBody");
    const titleEl = document.getElementById("appliancesTableTitle");
    const countEl = document.getElementById("appliancesCounterText");
    const pageInfo = document.getElementById("appliancesPageInfo");
    if (!tbody) return;

    if (titleEl) titleEl.textContent = "Bảng Danh Sách AD Quy Định Theo Vật Tư & Thiết Bị (Appliances)";
    if (countEl) countEl.textContent = `Hiển thị ${filteredApplianceAds.length.toLocaleString()} AD Vật Tư`;

    const totalPages = Math.ceil(filteredApplianceAds.length / appliancePageSize) || 1;
    if (applianceCurrentPage > totalPages) applianceCurrentPage = totalPages;
    if (applianceCurrentPage < 1) applianceCurrentPage = 1;

    if (pageInfo) {
      pageInfo.textContent = `Trang ${applianceCurrentPage} / ${totalPages} (${filteredApplianceAds.length.toLocaleString()} AD)`;
    }

    const startIdx = (applianceCurrentPage - 1) * appliancePageSize;
    const pageItems = filteredApplianceAds.slice(startIdx, startIdx + appliancePageSize);

    if (pageItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text-secondary);">Không có AD vật tư nào phù hợp với bộ lọc hiện tại.</td></tr>`;
      return;
    }

    tbody.innerHTML = pageItems
      .map((ad) => {
        const authBadge = (ad.authorityDual || ad.authority || "").toUpperCase().includes("EASA")
          ? `<span class="badge badge-easa">🇪🇺 EASA</span>`
          : `<span class="badge badge-faa">🇺🇸 FAA</span>`;

        const partsHtml = (ad.appliancesMatched || [])
          .map((m) => `
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
              <a href="javascript:void(0)" onclick="window.viewApplianceDetail('${escapeHtml(m.pn)}')" style="color:#93c5fd;font-family:monospace;font-size:12px;font-weight:700;text-decoration:underline;">
                ${escapeHtml(m.pn)}
              </a>
              <span style="font-size:11.5px;color:var(--text-secondary);">${escapeHtml(m.desc || "")}</span>
              <span class="badge badge-standard" style="font-size:10px;">${m.planeCount} tàu</span>
            </div>
          `)
          .join("");

        const planesSummary = (ad.affectedFleet || [])
          .slice(0, 8)
          .map((f) => `<span class="badge badge-standard" style="font-size:10px;padding:2px 5px;">${escapeHtml(f.reg)}</span>`)
          .join(" ");

        const extraPlanesCount = (ad.affectedFleet || []).length > 8 ? `+${(ad.affectedFleet || []).length - 8} tàu` : "";

        return `
          <tr style="cursor:pointer;" onclick="openAdModal('${escapeHtml(ad.id)}')">
            <td>
              <div style="margin-bottom:4px;">${authBadge}</div>
              <strong style="color:#60a5fa;font-size:13.5px;">${escapeHtml(ad.adNumber)}</strong>
            </td>
            <td>
              <div style="font-weight:600;color:#fff;margin-bottom:4px;">${escapeHtml(ad.subject || "AD Yêu Cầu Kỹ Thuật")}</div>
              <div style="font-size:12px;color:var(--text-secondary);line-height:1.45;">${escapeHtml((ad.summary || "").slice(0, 160))}...</div>
            </td>
            <td onclick="event.stopPropagation();">${partsHtml}</td>
            <td>
              <div style="margin-bottom:4px;font-size:12px;font-weight:600;color:#34d399;">
                ✅ Áp dụng ${(ad.affectedFleet || []).length}/111 tàu VJC
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:3px;">
                ${planesSummary}
                ${extraPlanesCount ? `<span class="badge badge-standard" style="font-size:10px;">${extraPlanesCount}</span>` : ""}
              </div>
            </td>
            <td>
              <div style="font-family:monospace;font-size:12px;color:var(--accent-emerald);">
                ${escapeHtml(ad.effectiveDate || ad.issueDate || "—")}
              </div>
            </td>
            <td onclick="event.stopPropagation();">
              <div style="display:flex;gap:6px;flex-direction:column;">
                ${
                  ad.pdfUrl
                    ? `<a href="${escapeHtml(ad.pdfUrl)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="border-color:rgba(16,185,129,0.5);color:#34d399;font-size:11px;padding:3px 8px;text-align:center;">
                        📄 File PDF ↗
                      </a>`
                    : ""
                }
                <button class="btn btn-primary btn-sm" onclick="openAdModal('${escapeHtml(ad.id)}')" style="font-size:11px;padding:3px 8px;">
                  👁️ Chi tiết AD
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function openApplianceModal(pn) {
    const item = appliancesCatalog.find((x) => x.pn === pn);
    if (!item) {
      showToast(`⚠️ Không tìm thấy chi tiết thiết bị P/N: ${pn}`);
      return;
    }

    const modal = document.getElementById("applianceDetailModal");
    const titleEl = document.getElementById("modalApplianceTitle");
    const chapEl = document.getElementById("modalApplianceChapter");
    const bodyEl = document.getElementById("modalApplianceBody");
    if (!modal || !bodyEl) return;

    if (titleEl) titleEl.textContent = `P/N: ${item.pn} — ${item.desc || "Chi tiết Thiết Bị"}`;
    if (chapEl) chapEl.textContent = item.chapter || "Chưa phân loại";

    const planeList = item.planes || [];
    const adsList = getApplianceAdsList(item);

    bodyEl.innerHTML = `
      <div class="detail-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px;">
        <div class="detail-box">
          <div class="label">Mã Part Number (P/N)</div>
          <div class="val" style="color:#93c5fd;font-family:monospace;font-size:15px;">${escapeHtml(item.pn)}</div>
        </div>
        <div class="detail-box">
          <div class="label">Nhóm / Phân Loại</div>
          <div class="val" style="font-size:13.5px;">${escapeHtml(item.chapter || "—")}</div>
        </div>
        <div class="detail-box">
          <div class="label">Dòng Tàu Lắp Đặt</div>
          <div class="val" style="font-size:13.5px;">${escapeHtml((item.types || []).join(", ") || "—")}</div>
        </div>
        <div class="detail-box">
          <div class="label">Tổng Số Lượng / Số Tàu</div>
          <div class="val" style="color:#34d399;font-size:14px;">
            ✈️ ${item.planeCount || planeList.length} tàu (${item.totalQty} chi tiết)
          </div>
        </div>
      </div>

      <!-- ADs Regulating this Appliance -->
      <div class="detail-box" style="margin-bottom:14px;border-color:${adsList.length > 0 ? "rgba(245,158,11,0.6)" : "rgba(255,255,255,0.15)"};background:${adsList.length > 0 ? "rgba(245,158,11,0.06)" : "transparent"};">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
          <div class="label" style="color:${adsList.length > 0 ? "#fde68a" : "var(--text-secondary)"};font-size:12.5px;font-weight:700;">
            🛡️ QUY ĐỊNH KỸ THUẬT &amp; AIRWORTHINESS DIRECTIVES (AD) LIÊN QUAN (${adsList.length} AD)
          </div>
          ${adsList.length > 0 ? `<span class="badge badge-warning">Cần kiểm tra tuân thủ</span>` : `<span class="badge badge-standard">Chưa có AD</span>`}
        </div>
        ${
          adsList.length > 0
            ? `<div style="display:flex;flex-direction:column;gap:8px;">` +
              adsList
                .map((a) => `
                  <div class="appliance-ad-clickable-card"
                       onclick="window.viewAdFromAppliance('${escapeHtml(a.adId || '')}', '${escapeHtml(item.pn)}')"
                       style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:rgba(255,255,255,0.04);border-radius:8px;border:1px solid rgba(59,130,246,0.35);transition:all 0.2s ease;flex-wrap:wrap;gap:10px;"
                       onmouseover="this.style.background='rgba(59,130,246,0.14)';this.style.borderColor='#3b82f6';"
                       onmouseout="this.style.background='rgba(255,255,255,0.04)';this.style.borderColor='rgba(59,130,246,0.35)';"
                       title="Nhấp vào khung để xem toàn văn hồ sơ AD này"
                  >
                    <div style="flex:1;min-width:240px;">
                      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                        <span class="badge ${ (a.authority || "").includes("EASA") ? "badge-easa" : "badge-faa" }">${escapeHtml(a.authority || "AD")}</span>
                        <strong style="color:#60a5fa;font-size:14px;">${escapeHtml(a.adNumber)}</strong>
                        <span style="font-size:12px;color:var(--accent-emerald);font-family:monospace;margin-left:6px;">Eff: ${escapeHtml(a.effectiveDate || "—")}</span>
                      </div>
                      <div style="font-size:12.5px;color:#fff;margin-top:5px;line-height:1.4;">${escapeHtml(a.subject || "")}</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                      ${
                        a.pdfUrl
                          ? `<a href="${escapeHtml(a.pdfUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation();" class="btn btn-outline btn-sm" style="border-color:rgba(16,185,129,0.5);color:#34d399;font-size:11.5px;padding:4px 9px;">
                              📄 Bản PDF ↗
                            </a>`
                          : ""
                      }
                      <span style="color:#93c5fd;font-size:12.5px;font-weight:700;display:inline-flex;align-items:center;gap:4px;">
                        Xem hồ sơ AD ➜
                      </span>
                    </div>
                  </div>
                `)
                .join("") +
              `</div>`
            : `<div style="font-size:12.5px;color:var(--text-secondary);padding:6px 0;">Không có AD nào của FAA hoặc EASA trực tiếp yêu cầu xử lý Part Number này trên đội tàu VJC.</div>`
        }
      </div>

      <!-- Aircraft List Equipped with this Appliance -->
      <div class="detail-box">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div class="label" style="color:#60a5fa;font-size:12.5px;font-weight:700;">
            ✈️ DANH SÁCH ${planeList.length} TÀU BAY VIETJET AIR ĐANG LẮP ĐẶT THIẾT BỊ NÀY
          </div>
          <span class="badge status-closed">${item.totalQty} Chi Tiết Lắp Đặt</span>
        </div>
        <div style="max-height:320px;overflow-y:auto;border:1px solid rgba(255,255,255,0.08);border-radius:6px;">
          <table class="ad-table" style="font-size:12.5px;margin:0;">
            <thead>
              <tr style="position:sticky;top:0;background:var(--bg-card);z-index:1;">
                <th>Số Đăng Ký (Reg)</th>
                <th>Số Xuất Xưởng (MSN)</th>
                <th>Dòng Tàu Bay</th>
                <th style="text-align:right;">Số Lượng Lắp</th>
              </tr>
            </thead>
            <tbody>
              ${planeList
                .map(
                  (p) => `
                <tr>
                  <td>
                    <strong style="color:#60a5fa;font-family:monospace;">${escapeHtml(p.reg)}</strong>
                  </td>
                  <td style="font-family:monospace;">${escapeHtml(p.msn || "—")}</td>
                  <td>${escapeHtml(p.type || "—")}</td>
                  <td style="text-align:right;font-weight:700;color:#34d399;">${p.qty || 1}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    modal.classList.add("open");
  }

  window.viewApplianceDetail = openApplianceModal;
  window.openAdModal = openAdModal;

  window.viewAdFromAppliance = function (adId, pn) {
    navFromPart = true;
    window.lastPartViewContext = { source: "appliance", pn: pn || "" };
    const appModal = document.getElementById("applianceDetailModal");
    if (appModal) appModal.classList.remove("open");
    openAdModal(adId);
  };

  window.viewAdFromIpc = function (adId, pn) {
    navFromPart = true;
    window.lastPartViewContext = { source: "ipc", pn: pn || "" };
    const ipcModal = document.getElementById("ipcPartDetailModal");
    if (ipcModal) ipcModal.classList.remove("open");
    openAdModal(adId);
  };

  window.goBackToPartDetail = function () {
    const ctx = window.lastPartViewContext;
    if (!ctx || !ctx.pn) return;
    const adModal = document.getElementById("adDetailModal");
    if (adModal) adModal.classList.remove("open");
    if (ctx.source === "ipc") {
      if (typeof openIpcDetailModal === "function") {
        openIpcDetailModal(ctx.pn);
      }
    } else {
      if (typeof openApplianceModal === "function") {
        openApplianceModal(ctx.pn);
      }
    }
  };

  function exportAppliancesToExcel() {
    if (!filteredAppliances || filteredAppliances.length === 0) {
      showToast("⚠️ Không có dữ liệu thiết bị để xuất");
      return;
    }
    const headers = [
      "Part Number",
      "Description",
      "Chapter",
      "Types",
      "Total Qty",
      "Planes Count",
      "Installed Planes",
      "Has AD",
      "Regulating ADs"
    ];
    const rows = filteredAppliances.map((it) => [
      `"${(it.pn || "").replace(/"/g, '""')}"`,
      `"${(it.desc || "").replace(/"/g, '""')}"`,
      `"${(it.chapter || "").replace(/"/g, '""')}"`,
      `"${(it.types || []).join(", ").replace(/"/g, '""')}"`,
      it.totalQty || 0,
      it.planeCount || 0,
      `"${(it.planes || []).map((p) => p.reg).join(", ").replace(/"/g, '""')}"`,
      it.hasAd ? "YES" : "NO",
      `"${(it.matchedAds || []).map((a) => a.adNumber).join("; ").replace(/"/g, '""')}"`
    ]);
    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `VJC_Appliances_Inventory_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`📥 Đã xuất ${filteredAppliances.length.toLocaleString()} thiết bị ra file CSV!`);
  }

  function initApplianceEvents() {
    const btnPn = document.getElementById("btnViewByPartNumber");
    const btnAds = document.getElementById("btnViewByApplianceAds");
    const tblPn = document.getElementById("tableAppliancesPn");
    const tblAds = document.getElementById("tableAppliancesAds");

    if (btnPn && btnAds) {
      btnPn.addEventListener("click", () => {
        applianceViewMode = "PN";
        btnPn.className = "btn btn-primary btn-sm";
        btnAds.className = "btn btn-outline btn-sm";
        if (tblPn) tblPn.style.display = "";
        if (tblAds) tblAds.style.display = "none";
        const btnSubPn = document.getElementById("btnIpcSubAppliancesPn");
        const btnSubAds = document.getElementById("btnIpcSubAppliancesAds");
        if (btnSubPn) btnSubPn.classList.add("active");
        if (btnSubAds) btnSubAds.classList.remove("active");
        filterAndRenderAppliances();
      });

      btnAds.addEventListener("click", () => {
        applianceViewMode = "AD";
        btnAds.className = "btn btn-primary btn-sm";
        btnPn.className = "btn btn-outline btn-sm";
        if (tblPn) tblPn.style.display = "none";
        if (tblAds) tblAds.style.display = "";
        const btnSubPn = document.getElementById("btnIpcSubAppliancesPn");
        const btnSubAds = document.getElementById("btnIpcSubAppliancesAds");
        if (btnSubAds) btnSubAds.classList.add("active");
        if (btnSubPn) btnSubPn.classList.remove("active");
        filterAndRenderAppliances();
      });
    }

    const searchInput = document.getElementById("filterApplianceSearch");
    if (searchInput) {
      let deb = null;
      searchInput.addEventListener("input", () => {
        clearTimeout(deb);
        deb = setTimeout(() => filterAndRenderAppliances(), 200);
      });
    }

    ["filterApplianceChapter", "filterApplianceAta", "filterApplianceType", "filterAppliancePlane", "filterApplianceAdStatus"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("change", () => filterAndRenderAppliances());
    });

    const btnReset = document.getElementById("btnResetApplianceFilters");
    if (btnReset) {
      btnReset.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";
        const cEl = document.getElementById("filterApplianceChapter");
        if (cEl) cEl.value = "ALL";
        const aEl = document.getElementById("filterApplianceAta");
        if (aEl) aEl.value = "ALL";
        const tEl = document.getElementById("filterApplianceType");
        if (tEl) tEl.value = "ALL";
        const pEl = document.getElementById("filterAppliancePlane");
        if (pEl) pEl.value = "ALL";
        const sEl = document.getElementById("filterApplianceAdStatus");
        if (sEl) sEl.value = "HAS_AD";
        filterAndRenderAppliances();
      });
    }

    const btnExp = document.getElementById("btnExportAppliancesExcel");
    if (btnExp) btnExp.addEventListener("click", exportAppliancesToExcel);

    const btnPrev = document.getElementById("btnAppliancePrevPage");
    if (btnPrev) {
      btnPrev.addEventListener("click", () => {
        if (applianceCurrentPage > 1) {
          applianceCurrentPage--;
          if (applianceViewMode === "PN") renderAppliancesPnTable();
          else renderAppliancesAdsTable();
        }
      });
    }

    const btnNext = document.getElementById("btnApplianceNextPage");
    if (btnNext) {
      btnNext.addEventListener("click", () => {
        const pool = applianceViewMode === "PN" ? filteredAppliances : filteredApplianceAds;
        const totalPages = Math.ceil(pool.length / appliancePageSize) || 1;
        if (applianceCurrentPage < totalPages) {
          applianceCurrentPage++;
          if (applianceViewMode === "PN") renderAppliancesPnTable();
          else renderAppliancesAdsTable();
        }
      });
    }

    const btnCloseModal = document.getElementById("btnCloseApplianceModal");
    const btnCloseModalBtm = document.getElementById("btnCloseApplianceModalBottom");
    const appModal = document.getElementById("applianceDetailModal");
    if (btnCloseModal && appModal) {
      btnCloseModal.addEventListener("click", () => appModal.classList.remove("open"));
    }
    if (btnCloseModalBtm && appModal) {
      btnCloseModalBtm.addEventListener("click", () => appModal.classList.remove("open"));
    }
    if (appModal) {
      appModal.addEventListener("click", (e) => {
        if (e.target === appModal) appModal.classList.remove("open");
      });
    }
  }

  // PWA Service Worker & Install App Support
  let deferredInstallPrompt = null;
  function showPwaInstallGuideModal() {
    const modal = document.getElementById("pwaInstallGuideModal");
    const contentEl = document.getElementById("pwaGuideContent");
    if (!modal || !contentEl) return;

    const ua = navigator.userAgent || "";
    const isInAppWebView = /Zalo|FBAN|FBAV|Messenger|Line|Instagram/i.test(ua);
    const isIos = /iPad|iPhone|iPod/i.test(ua);
    const isLocalNonSecure = !window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1";

    let html = "";
    if (isInAppWebView) {
      html = `
        <div style="padding:10px 12px;border-radius:8px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.45);color:#fde68a;margin-bottom:10px;">
          ⚠️ <strong>Bạn đang mở trang trong trình duyệt Zalo / Messenger</strong> nên hệ điều hành không cho cài App trực tiếp từ đây.
        </div>
        <ol style="padding-left:18px;margin:0;display:flex;flex-direction:column;gap:6px;">
          <li>Bấm <strong>🔗 Copy Link</strong> bên dưới (hoặc bấm nút <strong>⋯ / ⋮</strong> góc phải chọn <strong>Mở bằng Chrome / Safari</strong>).</li>
          <li>Mở bằng <strong>Chrome</strong> (Android) hoặc <strong>Safari</strong> (iPhone), sau đó bấm <strong>📲 Cài App</strong> hoặc chọn <strong>Thêm vào Màn hình chính</strong>.</li>
        </ol>
      `;
    } else if (isLocalNonSecure) {
      html = `
        <div style="padding:10px 12px;border-radius:8px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.45);color:#fca5a5;margin-bottom:10px;">
          ⚠️ Địa chỉ HTTP nội bộ (<code>${escapeHtml(location.origin)}</code>) không hỗ trợ cài PWA trên điện thoại (trình duyệt bắt buộc <strong>HTTPS</strong> hoặc <code>localhost</code>).
        </div>
        <p style="margin:0;">Hãy mở trang qua đường dẫn <strong>HTTPS (GitHub Pages)</strong> để cài đặt biểu tượng App lên điện thoại.</p>
      `;
    } else if (isIos) {
      html = `
        <p style="margin:0 0 8px;">Để cài <strong>VJC AeroAD</strong> lên iPhone / iPad:</p>
        <ol style="padding-left:18px;margin:0;display:flex;flex-direction:column;gap:6px;">
          <li>Mở trang bằng trình duyệt <strong>Safari</strong>.</li>
          <li>Bấm nút <strong>Chia sẻ (⬆️)</strong> ở thanh công cụ dưới cùng.</li>
          <li>Cuộn xuống chọn <strong>“Thêm vào MH chính” (Add to Home Screen)</strong> → <strong>Thêm</strong>.</li>
        </ol>
      `;
    } else {
      html = `
        <p style="margin:0 0 8px;">Để cài <strong>VJC AeroAD</strong> lên điện thoại Android:</p>
        <ol style="padding-left:18px;margin:0;display:flex;flex-direction:column;gap:6px;">
          <li>Mở trang bằng trình duyệt <strong>Google Chrome</strong> hoặc <strong>Edge</strong>.</li>
          <li>Bấm biểu tượng menu <strong>(⋮)</strong> ở góc trên bên phải.</li>
          <li>Chọn <strong>“Cài đặt ứng dụng”</strong> hoặc <strong>“Thêm vào Màn hình chính”</strong> → Xác nhận cài đặt.</li>
        </ol>
      `;
    }

    contentEl.innerHTML = html;
    modal.classList.add("open");
  }

  function initPwaSupport() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch(() => {});
    }

    const btnInstall = document.getElementById("btnInstallPwa");
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

    if (btnInstall && isStandalone) {
      btnInstall.style.display = "none";
    }

    if (window.__deferredPwaPrompt) {
      deferredInstallPrompt = window.__deferredPwaPrompt;
      if (btnInstall) btnInstall.style.display = "inline-flex";
    }

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      window.__deferredPwaPrompt = e;
      if (btnInstall) {
        btnInstall.style.display = "inline-flex";
      }
    });

    const pwaModal = document.getElementById("pwaInstallGuideModal");
    const closePwaModal = () => pwaModal && pwaModal.classList.remove("open");
    document.getElementById("btnClosePwaGuideModal")?.addEventListener("click", closePwaModal);
    document.getElementById("btnDismissPwaGuide")?.addEventListener("click", closePwaModal);
    document.getElementById("btnCopyPwaUrl")?.addEventListener("click", () => {
      copyTextToClipboard(window.location.href, "Link VJC AeroAD");
    });

    if (btnInstall) {
      btnInstall.addEventListener("click", async () => {
        if (deferredInstallPrompt) {
          try {
            deferredInstallPrompt.prompt();
            const { outcome } = await deferredInstallPrompt.userChoice;
            deferredInstallPrompt = null;
            if (outcome === "accepted") {
              btnInstall.style.display = "none";
              showToast("✅ Đang cài đặt ứng dụng VJC AeroAD vào thiết bị!");
            }
            return;
          } catch (err) {}
        }
        showPwaInstallGuideModal();
      });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".table-responsive").forEach((wrap) => {
      wrap.addEventListener(
        "wheel",
        (e) => {
          if (e.shiftKey && wrap.scrollWidth > wrap.clientWidth + 2 && e.deltaY !== 0) {
            wrap.scrollLeft += e.deltaY;
            e.preventDefault();
          }
        },
        { passive: false }
      );
    });
    /* ==========================================================================
     IPC AIRBUS CATALOG & INTERCHANGE MODULE
     ========================================================================== */
  const ipcState = {
    fleet: [],
    parts: [],
    totalParts: 0,
    page: 1,
    pageSize: 25,
    isLoading: false,
    filters: {
      q: "",
      family: "ALL",
      plane: "ALL",
      relation: "ALL",
      installed: "ALL",
      hasAd: "ALL",
      ata: "ALL",
      partType: "ALL"
    }
  };

  const isStaticHost = window.location.protocol === "https:" || 
                       window.location.hostname.endsWith("github.io") || 
                       window.location.hostname.endsWith("pages.dev") || 
                       window.location.protocol === "file:" ||
                       (window.location.port !== "8085");

  window.ipcCatalogStatic = null;
  window.ipcShardCache = {};
  window.ipcPlaneSetCache = {};

  function getIpcApiUrl(endpoint) {
    if (window.location.protocol.startsWith("http") && window.location.port === "8085") {
      return endpoint;
    }
    const host = window.location.hostname || "localhost";
    return `http://${host}:8085${endpoint}`;
  }

  async function loadIpcStats() {
    try {
      let stats = null;
      if (!isStaticHost) {
        try {
          const res = await fetch(getIpcApiUrl("/api/ipc/stats"));
          if (res.ok) stats = await res.json();
        } catch (e) {}
      }
      if (!stats) {
        const res = await fetch("./db/vjc-ipc-stats.json");
        if (res.ok) stats = await res.json();
      }
      if (stats && stats.totalParts) {
        const elTotal = document.getElementById("ipcKpiTotalPn");
        const elIc = document.getElementById("ipcKpiTotalInterchanges");
        const elAd = document.getElementById("ipcKpiMatchedAds");
        const elNav = document.getElementById("navCountIpc");
        if (elTotal) elTotal.textContent = Number(stats.totalParts).toLocaleString("en-US");
        if (elIc) elIc.textContent = Number(stats.totalInterchanges).toLocaleString("en-US");
        if (elAd) elAd.textContent = Number(stats.withAdCount).toLocaleString("en-US");
        if (elNav) elNav.textContent = Number(stats.totalParts).toLocaleString("en-US");
      }
    } catch (e) {
      console.warn("Could not load IPC stats:", e);
    }
  }

  async function fetchIpcParts(page = 1) {
    if (ipcState.isLoading) return;
    ipcState.isLoading = true;
    ipcState.page = page;

    const tbody = document.getElementById("ipcPartsTableBody");
    const counterText = document.getElementById("ipcPartsCounterText");
    const pageInfo = document.getElementById("ipcPartsPageInfo");

    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center;padding:32px;color:var(--text-muted);">
            <div style="display:inline-block;animation:spin 1s linear infinite;margin-right:8px;">⏳</div>
            Đang tra cứu dữ liệu phụ tùng IPC (114,648 linh kiện & 137,832 quan hệ thay thế)...
          </td>
        </tr>
      `;
    }

    try {
      const t0 = performance.now();
      let parts = [];
      let totalParts = 0;
      let elapsedMs = 0;

      if (!isStaticHost) {
        try {
          const params = new URLSearchParams({
            q: ipcState.filters.q,
            family: ipcState.filters.family,
            plane: ipcState.filters.plane,
            relation: ipcState.filters.relation,
            installed: ipcState.filters.installed,
            hasAd: ipcState.filters.hasAd,
            ata: ipcState.filters.ata,
            partType: ipcState.filters.partType,
            page: page,
            pageSize: ipcState.pageSize
          });
          const res = await fetch(getIpcApiUrl(`/api/ipc/search?${params.toString()}`));
          if (res.ok) {
            const data = await res.json();
            parts = data.items || [];
            totalParts = data.total || 0;
            elapsedMs = data.elapsedMs || Math.round(performance.now() - t0);
          }
        } catch (e) {
          console.warn("Backend IPC search unavailable, falling back to static in-memory:", e);
        }
      }

      // If backend search was not used or returned no items, run static in-memory search
      if (totalParts === 0 && parts.length === 0) {
        if (!window.ipcCatalogStatic) {
          if (counterText) counterText.textContent = "Đang tải cơ sở dữ liệu tra cứu IPC...";
          const res = await fetch("./db/vjc-ipc-search.json");
          if (!res.ok) throw new Error(`HTTP ${res.status} khi tải db/vjc-ipc-search.json`);
          window.ipcCatalogStatic = await res.json();
        }

        let list = window.ipcCatalogStatic || [];

        // If plane filter is selected, load that plane's part set
        const selectedPlane = (ipcState.filters.plane || "ALL").trim();
        if (selectedPlane && selectedPlane !== "ALL") {
          if (!window.ipcPlaneSetCache[selectedPlane]) {
            try {
              const resPl = await fetch(`./db/ipc-planes/${encodeURIComponent(selectedPlane)}.json`);
              if (resPl.ok) {
                const arr = await resPl.json();
                window.ipcPlaneSetCache[selectedPlane] = new Set((arr || []).map(x => (x || "").toUpperCase()));
              } else {
                window.ipcPlaneSetCache[selectedPlane] = new Set();
              }
            } catch (e) {
              window.ipcPlaneSetCache[selectedPlane] = new Set();
            }
          }
          const planeSet = window.ipcPlaneSetCache[selectedPlane];
          list = list.filter(p => planeSet.has((p.pn || "").toUpperCase()));
        }

        // Apply filters
        const q = (ipcState.filters.q || "").trim().toUpperCase();
        const family = (ipcState.filters.family || "ALL").toUpperCase();
        const relation = (ipcState.filters.relation || "ALL").toUpperCase();
        const installed = (ipcState.filters.installed || "ALL").toUpperCase();
        const hasAd = (ipcState.filters.hasAd || "ALL").toUpperCase();
        const ata = (ipcState.filters.ata || "ALL").toUpperCase();
        const partType = (ipcState.filters.partType || "ALL").toUpperCase();

        if (q || family !== "ALL" || relation !== "ALL" || installed !== "ALL" || hasAd !== "ALL" || ata !== "ALL" || partType !== "ALL") {
          list = list.filter(p => {
            if (partType !== "ALL") {
              const pt = (p.partType || "ROTABLE").toUpperCase();
              if (pt !== partType) return false;
            }

            if (family !== "ALL") {
              const fams = (p.fams || p.families || []).map(f => (f || "").toUpperCase());
              if (!fams.some(f => f.includes(family))) return false;
            }
            const isInst = p.installed !== undefined ? p.installed : p.inst;
            if (installed === "YES" && !isInst) return false;
            if (installed === "NO" && isInst) return false;

            const adCount = p.adCount !== undefined ? p.adCount : (p.matchedAds ? p.matchedAds.length : 0);
            if (hasAd === "YES" && adCount === 0) return false;
            if (hasAd === "NO" && adCount > 0) return false;

            if (ata !== "ALL") {
              const refs = [p.ipcRef || "", ...(p.ipcRefs || [])];
              const prefix = ata + "-";
              const prefixSlash = ata + "/";
              const matchingRef = refs.find(r => {
                const ru = (r || "").toUpperCase();
                return ru.startsWith(prefix) || ru.startsWith(prefixSlash);
              });
              if (!matchingRef) return false;
              if (matchingRef !== p.ipcRef) {
                p = Object.assign({}, p, { ipcRef: matchingRef, isSecondaryRef: true });
              }
            }

            if (relation === "2WAY") {
              const ics = p.ics || p.interchanges || [];
              if (!ics.some(x => x.is2Way || (x.rel && x.rel.includes("2-Way")))) return false;
            } else if (relation === "1WAY") {
              const ics = p.ics || p.interchanges || [];
              if (!ics.some(x => x.is2Way === false || (x.rel && x.rel.includes("1-Way")))) return false;
            } else if (relation === "NONE") {
              const icCount = p.icCount !== undefined ? p.icCount : (p.ics ? p.ics.length : (p.interchanges ? p.interchanges.length : 0));
              if (icCount > 0) return false;
            }

            if (q) {
              const target = `${p.pn || ""} ${p.desc || ""} ${p.mfr || ""} ${p.ipcRef || ""}`.toUpperCase();
              if (target.indexOf(q) === -1) return false;
            }
            return true;
          });
        }

        list.sort((a, b) => {
          if (ata !== "ALL") {
            const secA = a.isSecondaryRef ? 1 : 0;
            const secB = b.isSecondaryRef ? 1 : 0;
            if (secA !== secB) return secA - secB;
          }
          const refA = a.ipcRef || "";
          const refB = b.ipcRef || "";
          if (refA && refB) {
            const cmp = refA.localeCompare(refB, undefined, { numeric: true });
            if (cmp !== 0) return cmp;
          } else if (refA) return -1;
          else if (refB) return 1;
          return (a.pn || "").localeCompare(b.pn || "");
        });

        totalParts = list.length;
        const start = (page - 1) * ipcState.pageSize;
        parts = list.slice(start, start + ipcState.pageSize);
        elapsedMs = Math.round(performance.now() - t0);
      }

      ipcState.parts = parts;
      ipcState.totalParts = totalParts;

      renderIpcPartsTable(ipcState.parts);

      const totalPages = Math.ceil(ipcState.totalParts / ipcState.pageSize) || 1;
      if (pageInfo) {
        pageInfo.textContent = `Trang ${page} / ${totalPages} (Tổng số ${Number(ipcState.totalParts).toLocaleString("en-US")} phụ tùng • ${elapsedMs}ms)`;
      }
      if (counterText) {
        counterText.textContent = `Tìm thấy ${Number(ipcState.totalParts).toLocaleString("en-US")} kết quả`;
      }

      const btnPrev = document.getElementById("btnIpcPrevPage");
      const btnNext = document.getElementById("btnIpcNextPage");
      if (btnPrev) btnPrev.disabled = page <= 1;
      if (btnNext) btnNext.disabled = page >= totalPages;
    } catch (err) {
      console.error("Error fetching IPC parts:", err);
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="8" style="text-align:center;padding:24px;color:#fca5a5;">
              ❌ Không thể tải danh sách phụ tùng: ${escapeHtml(err.message)}
            </td>
          </tr>
        `;
      }
    } finally {
      ipcState.isLoading = false;
    }
  }

  function isStrict1WayReason(reason) {
    if (!reason) return false;
    const r = reason.toUpperCase();
    // Nếu có dấu hiệu cho phép thay thế 2 chiều hoặc có điều kiện đảo chiều (TWO WAY, BUT IF, ONLY IF, CAN REPLACE...IF, v.v.)
    const has2WaySignal = r.includes("TWO WAY") || r.includes("2-WAY") || r.includes("2 WAY") ||
                          r.includes("BUT IF") || r.includes("ONLY IF") ||
                          (r.includes("CAN REPLACE") && r.includes(" IF "));
    if (has2WaySignal) return false;
    // Chỉ coi là 1-Way khi cấm tuyệt đối / chỉ 1 chiều không có điều kiện đảo lại
    return r.includes("ONE WAY") || r.includes("1-WAY") || r.includes("1 WAY") || 
           r.includes("CANNOT REPLACE") || r.includes("NOT INTERCHANGEABLE");
  }

  function renderIpcPartsTable(items) {
    const tbody = document.getElementById("ipcPartsTableBody");
    if (!tbody) return;

    if (!items || items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center;padding:32px;color:var(--text-muted);">
            Không tìm thấy Part Number nào khớp với điều kiện tìm kiếm.
          </td>
        </tr>
      `;
      return;
    }

    const html = items.map((p) => {
      const isInst = p.installed !== undefined ? p.installed : p.inst;
      const planeCount = p.planeCount || 0;
      const lineCount = p.lineItems !== undefined ? p.lineItems : (p.lines || 0);

      const installedBadge = isInst
        ? `<span class="badge badge-success" style="font-size:10px;padding:1px 5px;font-weight:700;">✅ Active (${planeCount})</span>`
        : `<span class="badge" style="font-size:10px;padding:1px 5px;background:rgba(255,255,255,0.08);color:var(--text-muted);">🚫 Spare</span>`;

      const famBadges = (p.families || p.fams || [])
        .map((f) => {
          let col = "#93c5fd";
          let bg = "rgba(59,130,246,0.18)";
          if (f === "A330") { col = "#d8b4fe"; bg = "rgba(168,85,247,0.2)"; }
          else if (f === "A321neo") { col = "#34d399"; bg = "rgba(16,185,129,0.2)"; }
          return `<span class="badge" style="background:${bg};color:${col};font-size:11px;padding:2px 6px;margin:2px 2px 2px 0;">${escapeHtml(f)}</span>`;
        })
        .join("");

      // Render interchange summary (Grouped by 2-Way / 1-Way)
      let icHtml = `<span style="color:var(--text-muted);font-size:12px;">Không có</span>`;
      const ics = p.ics || [];
      const distinctCount = p.icCount !== undefined ? p.icCount : (p.interchanges ? p.interchanges.length : 0);

      if (ics.length > 0) {
        const lines = ics.slice(0, 2).map((ic) => {
          const tag = ic.is2Way ? "↔️ 2-Way" : "➡️ 1-Way";
          const tagCol = ic.is2Way ? "#34d399" : "#fbbf24";
          const tagBg = ic.is2Way ? "rgba(16,185,129,0.18)" : "rgba(234,179,8,0.18)";
          const tagBorder = ic.is2Way ? "rgba(16,185,129,0.4)" : "rgba(234,179,8,0.4)";

          return `
            <div style="font-size:12px;margin-bottom:3px;line-height:1.35;display:flex;align-items:center;gap:6px;">
              <span class="badge" style="background:${tagBg};border:1px solid ${tagBorder};color:${tagCol};font-size:10.5px;font-weight:700;padding:1px 5px;">${tag}</span>
              <code style="color:#fff;font-weight:700;">${escapeHtml(ic.icPn)}</code>
            </div>
          `;
        });
        if (distinctCount > 2) {
          lines.push(`<span style="font-size:11px;color:#c084fc;">+${distinctCount - 2} part thay thế khác...</span>`);
        }
        icHtml = lines.join("");
      } else if (p.interchanges && p.interchanges.length > 0) {
        const icMap = new Map();
        for (const ic of p.interchanges) {
          const k = (ic.icPn || "").trim().toUpperCase();
          if (!k) continue;
          if (!icMap.has(k)) icMap.set(k, []);
          icMap.get(k).push(ic);
        }

        const mergedSummary = [];
        for (const [k, grp] of icMap.entries()) {
          let hasExplicit1WayReason = false;
          for (const it of grp) {
            if (isStrict1WayReason(it.reason)) {
              hasExplicit1WayReason = true;
              break;
            }
          }
          const is2Way = !hasExplicit1WayReason;
          mergedSummary.push({
            is2Way: is2Way,
            icPn: grp[0].icPn
          });
        }

        const topIc = mergedSummary.slice(0, 2);
        const lines = topIc.map((ic) => {
          const tag = ic.is2Way ? "↔️ 2-Way" : "➡️ 1-Way";
          const tagCol = ic.is2Way ? "#34d399" : "#fbbf24";
          const tagBg = ic.is2Way ? "rgba(16,185,129,0.18)" : "rgba(234,179,8,0.18)";
          const tagBorder = ic.is2Way ? "rgba(16,185,129,0.4)" : "rgba(234,179,8,0.4)";

          return `
            <div style="font-size:12px;margin-bottom:3px;line-height:1.35;display:flex;align-items:center;gap:6px;">
              <span class="badge" style="background:${tagBg};border:1px solid ${tagBorder};color:${tagCol};font-size:10.5px;font-weight:700;padding:1px 5px;">${tag}</span>
              <code style="color:#fff;font-weight:700;">${escapeHtml(ic.icPn)}</code>
            </div>
          `;
        });
        if (mergedSummary.length > 2) {
          lines.push(`<span style="font-size:11px;color:#c084fc;">+${mergedSummary.length - 2} part thay thế khác...</span>`);
        }
        icHtml = lines.join("");
      }

      // Render AD link
      let adHtml = `<span style="color:var(--text-muted);font-size:12px;">---</span>`;
      const adList = p.ads || p.matchedAds || [];
      const totalAds = p.adCount !== undefined ? p.adCount : adList.length;

      if (adList.length > 0) {
        const adItems = adList.slice(0, 2).map((a) => {
          const isEasa = (a.auth || "").toUpperCase() === "EASA";
          const flag = isEasa ? "🇪🇺" : "🇺🇸";
          const col = isEasa ? "#34d399" : "#93c5fd";
          return `
            <div style="font-size:12px;margin-bottom:2px;">
              <span style="color:${col};font-weight:700;">${flag} ${escapeHtml(a.num)}</span>
            </div>
          `;
        });
        if (totalAds > 2) {
          adItems.push(`<span style="font-size:11px;color:#fbbf24;font-weight:600;">+${totalAds - 2} AD khác</span>`);
        }
        adHtml = adItems.join("");
      }

      const refCount = p.refCount || (p.ipcRefs ? p.ipcRefs.length : (p.ipcRef ? 1 : 0));

      return `
        <tr class="clickable-ipc-row" data-pn="${escapeHtml(p.pn)}" title="Nhấp vào để xem đầy đủ cấu hình lắp & quan hệ thay thế của Part: ${escapeHtml(p.pn)}">
          <td>
            <div style="display:flex;flex-direction:column;gap:3px;">
              <code style="font-size:13.5px;font-weight:800;color:#c084fc;">${escapeHtml(p.pn)}</code>
              <div>${installedBadge}</div>
            </div>
          </td>
          <td>
            ${p.ipcRef ? `
              <div style="display:flex;flex-direction:column;gap:2px;">
                <code style="font-size:11.5px;font-weight:700;color:#67e8f9;background:rgba(6,182,212,0.12);padding:2px 6px;border-radius:4px;border:1px solid rgba(6,182,212,0.3);display:inline-block;max-width:fit-content;">${escapeHtml(p.ipcRef)}</code>
                ${refCount > 1 ? `<span style="font-size:10.5px;color:var(--text-muted);">+${refCount - 1} vị trí</span>` : ""}
              </div>
            ` : `<span style="color:var(--text-muted);font-size:12px;">---</span>`}
          </td>
          <td>
            <div style="font-weight:600;font-size:13px;color:#fff;">${escapeHtml(p.desc || "---")}</div>
          </td>
          <td style="text-align:center;">
            <span class="badge badge-standard" style="font-size:11px;padding:2px 5px;">${escapeHtml(p.mfr || "---")}</span>
          </td>
          <td style="text-align:center;">${famBadges}</td>
          <td>
            <div style="font-size:11.5px;line-height:1.35;">
              <div>Lines: <strong>${lineCount}</strong></div>
              <div style="color:var(--text-secondary);font-size:10.5px;">Fleet: <strong>${planeCount} A/C</strong></div>
            </div>
          </td>
          <td>${icHtml}</td>
          <td>${adHtml}</td>
        </tr>
      `;
    }).join("");

    tbody.innerHTML = html;

    // Attach click listeners to entire rows
    tbody.querySelectorAll(".clickable-ipc-row").forEach((row) => {
      row.addEventListener("click", () => {
        const pn = row.getAttribute("data-pn");
        if (pn) openIpcDetailModal(pn);
      });
    });
  }

  window.openIpcDetailModal = openIpcDetailModal;
  async function openIpcDetailModal(pn) {
    window.openIpcDetailModal = openIpcDetailModal;
    const modal = document.getElementById("ipcPartDetailModal");
    const elTitle = document.getElementById("modalIpcPartTitle");
    const elDesc = document.getElementById("modalIpcPartDesc");
    const elMfr = document.getElementById("modalIpcPartMfr");
    const elBadge = document.getElementById("modalIpcPartInstalledBadge");
    const elBody = document.getElementById("modalIpcPartBody");

    if (!modal || !elBody) return;

    modal.classList.add("open");
    elTitle.textContent = pn;
    elDesc.textContent = "Đang tải dữ liệu chi tiết cấu hình lắp và quan hệ interchange...";
    elBody.innerHTML = `
      <div style="text-align:center;padding:40px;color:var(--text-muted);">
        <div style="display:inline-block;animation:spin 1s linear infinite;margin-right:8px;">⏳</div>
        Đang tra cứu cơ sở dữ liệu IPC cho Part Number ${escapeHtml(pn)}...
      </div>
    `;

    try {
      let part = null;
      if (!isStaticHost) {
        try {
          const res = await fetch(getIpcApiUrl(`/api/ipc/part-detail?pn=${encodeURIComponent(pn)}`));
          if (res.ok) part = await res.json();
        } catch (e) {}
      }

      // Fallback to static shard
      if (!part) {
        const cleanPn = (pn || "").trim();
        let shardKey = cleanPn.length > 0 ? cleanPn[0].toUpperCase() : "_";
        if (!/^[0-9A-Z]$/.test(shardKey)) shardKey = "_";

        if (!window.ipcShardCache[shardKey]) {
          const res = await fetch(`./db/ipc-details/${shardKey}.json`);
          if (!res.ok) throw new Error(`HTTP ${res.status} khi tải chi tiết phụ tùng`);
          window.ipcShardCache[shardKey] = await res.json();
        }
        part = window.ipcShardCache[shardKey][cleanPn] || null;
      }

      if (!part) {
        elBody.innerHTML = `<div style="padding:20px;color:#fca5a5;">Không tìm thấy thông tin chi tiết cho Part Number ${escapeHtml(pn)}.</div>`;
        return;
      }

      elTitle.textContent = part.pn;
      elDesc.textContent = part.desc || "Không có mô tả";
      if (elMfr) elMfr.textContent = `MFR: ${part.mfr || "---"}`;

      if (elBadge) {
        if (part.installed) {
          elBadge.className = "badge badge-success";
          elBadge.textContent = `✅ Đã lắp trên đội bay (${part.planeCount || 0} tàu)`;
        } else {
          elBadge.className = "badge";
          elBadge.style.background = "rgba(255,255,255,0.08)";
          elBadge.style.color = "var(--text-muted)";
          elBadge.textContent = "🚫 Chưa lắp / Phụ tùng spare";
        }
      }

      // Build Interchange Table (Unified into 2-Way / 1-Way Interchange)
      let icRows = `<tr><td colspan="7" style="text-align:center;padding:16px;color:var(--text-muted);">Không có dữ liệu thay thế (Interchange) trong IPC.</td></tr>`;
      let distinctIcCount = 0;
      if (part.interchanges && part.interchanges.length > 0) {
        // Group by interchange part number (icPn) to unify 2-Way / 1-Way relations
        const groups = new Map();
        for (const ic of part.interchanges) {
          const pnKey = (ic.icPn || "").trim().toUpperCase();
          if (!pnKey) continue;
          if (!groups.has(pnKey)) groups.set(pnKey, []);
          groups.get(pnKey).push(ic);
        }

        const mergedList = [];
        for (const [pnKey, group] of groups.entries()) {
          let hasExplicit1WayReason = false;
          const reasons = new Set();
          const locations = new Set();
          let desc = "";
          let mfr = "";
          let incCode = "";

          for (const item of group) {
            const inc = (item.inc || "").trim();
            const reason = (item.reason || "").trim();
            const loc = (item.loc || "").trim();
            const rUpper = reason.toUpperCase();

            // Chỉ coi là 1-Way khi có lý do kỹ thuật cấm tuyệt đối 1 chiều (không có điều kiện đảo ngược)
            if (isStrict1WayReason(reason)) {
              hasExplicit1WayReason = true;
            }

            if (!incCode && inc) incCode = inc;
            if (!desc && item.icDesc) desc = item.icDesc;
            if (!mfr && item.icMfr) mfr = item.icMfr;
            if (reason && reason !== "No condition stated in IPC" && !reason.toLowerCase().includes("reverse of a spare")) {
              reasons.add(reason);
            }
            if (loc && loc !== "---") {
              loc.split(/,\s*/).forEach(l => { if (l.trim()) locations.add(l.trim()); });
            }
          }

          // Không có lý do rõ ràng thì đều là 2-Way Interchange
          const is2Way = !hasExplicit1WayReason;

          let finalRel = is2Way ? "2-Way" : "1-Way";
          let finalReason = Array.from(reasons).join(" | ");
          if (!finalReason) {
            finalReason = "No restriction stated in IPC";
          }
          let finalLoc = Array.from(locations).join(", ");

          mergedList.push({
            is2Way: is2Way,
            rel: finalRel,
            icPn: group[0].icPn,
            icDesc: desc || group[0].icDesc,
            icMfr: mfr || group[0].icMfr,
            reason: finalReason,
            loc: finalLoc || "---",
            inc: incCode ? `${incCode} (${is2Way ? "2-Way" : "1-Way"})` : (is2Way ? "2-WAY" : "1-WAY")
          });
        }

        distinctIcCount = mergedList.length;

        icRows = mergedList.map((ic) => {
          const badgeBg = ic.is2Way ? "rgba(16,185,129,0.18)" : "rgba(234,179,8,0.18)";
          const badgeBorder = ic.is2Way ? "rgba(16,185,129,0.45)" : "rgba(234,179,8,0.45)";
          const badgeColor = ic.is2Way ? "#34d399" : "#fbbf24";
          const icon = ic.is2Way ? "↔️" : "➡️";

          return `
            <tr>
              <td style="vertical-align:top;">
                <span class="badge" style="background:${badgeBg};border:1px solid ${badgeBorder};color:${badgeColor};font-size:11.5px;font-weight:800;padding:3px 7px;white-space:nowrap;">
                  ${icon} ${escapeHtml(ic.rel)}
                </span>
              </td>
              <td style="vertical-align:top;">
                <code style="font-size:13px;font-weight:800;color:#c084fc;">${escapeHtml(ic.icPn)}</code>
              </td>
              <td style="font-size:12px;vertical-align:top;font-weight:600;color:#fff;">${escapeHtml(ic.icDesc || "---")}</td>
              <td style="font-size:11.5px;vertical-align:top;"><span class="badge badge-standard">${escapeHtml(ic.icMfr || "---")}</span></td>
              <td style="font-size:11.5px;color:var(--text-secondary);word-break:break-word;vertical-align:top;line-height:1.35;">
                ${escapeHtml(ic.reason)}
              </td>
              <td style="font-size:11px;text-align:center;vertical-align:top;">
                <span class="badge" style="background:rgba(255,255,255,0.06);font-size:11px;font-weight:700;">${escapeHtml(ic.inc)}</span>
              </td>
            </tr>
          `;
        }).join("");
      }

      // Build Matched ADs Table
      let adRows = `<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--text-muted);">Part Number này hiện không có Airworthiness Directive (AD) nào quy định trực tiếp.</td></tr>`;
      if (part.matchedAds && part.matchedAds.length > 0) {
        adRows = part.matchedAds.map((a) => {
          const isEasa = a.auth === "EASA";
          const flag = isEasa ? "🇪🇺 EASA" : "🇺🇸 FAA";
          return `
            <tr class="clickable-ad-row"
                onclick="window.viewAdFromIpc('${escapeHtml(a.id)}', '${escapeHtml(part.pn)}')"
                style="cursor:pointer;"
                onmouseover="this.style.background='rgba(59,130,246,0.12)';"
                onmouseout="this.style.background='';"
                title="Nhấp vào hàng để xem toàn văn hồ sơ AD"
            >
              <td>
                <strong style="color:${isEasa ? "#34d399" : "#93c5fd"};font-size:13px;">
                  ${escapeHtml(a.num)}
                </strong>
              </td>
              <td><span class="badge badge-standard">${flag}</span></td>
              <td style="font-size:12px;">${escapeHtml(a.eff || "---")}</td>
              <td style="text-align:right;">
                <span style="color:#60a5fa;font-size:12px;font-weight:700;">Xem AD ➜</span>
              </td>
            </tr>
          `;
        }).join("");
      }

      // Build Planes List
      let planesHtml = `<span style="color:var(--text-muted);font-size:12px;">Part chưa được lắp đặt trên tàu bay nào trong 146 cấu hình IPC.</span>`;
      const allPlanes = (part.planes && part.planes.length > 0) ? part.planes : (part.samplePlanes || []);
      if (allPlanes.length > 0) {
        const planeItems = allPlanes.map(p => `<span style="font-family:monospace;font-size:12px;color:#93c5fd;font-weight:600;">${escapeHtml(p)}</span>`).join(`<span style="color:rgba(255,255,255,0.25);margin:0 4px;">,</span> `);
        planesHtml = `
          <div style="font-size:12px;line-height:1.75;word-break:break-word;max-height:180px;overflow-y:auto;padding:2px 0;">
            ${planeItems}
          </div>
        `;
      }

      // Build IPC References List
      let refsHtml = `<span style="color:var(--text-muted);font-size:12.5px;">Chưa có dữ liệu vị trí IPC trong cơ sở dữ liệu.</span>`;
      const allRefs = (part.ipcRefs && part.ipcRefs.length > 0) ? part.ipcRefs : (part.ipcRef ? [part.ipcRef] : []);
      if (allRefs.length > 0) {
        const rBadges = allRefs.map(r => `
          <code style="background:rgba(6,182,212,0.15);border:1px solid rgba(6,182,212,0.4);color:#67e8f9;font-size:12px;font-weight:700;padding:3px 8px;border-radius:4px;">
            📍 ${escapeHtml(r)}
          </code>
        `).join("");
        refsHtml = `
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;max-height:100px;overflow-y:auto;padding:6px;background:rgba(255,255,255,0.02);border-radius:6px;">
            ${rBadges}
          </div>
        `;
      }

      elBody.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:18px;">
          
          <!-- Summary Grid -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;background:rgba(255,255,255,0.03);padding:14px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);">
            <div>
              <div style="font-size:11.5px;color:var(--text-secondary);">Dòng Tàu Áp Dụng</div>
              <div style="font-size:13.5px;font-weight:700;color:#fff;margin-top:2px;">
                ${(part.families || []).join(", ") || "---"}
              </div>
            </div>
            <div>
              <div style="font-size:11.5px;color:var(--text-secondary);">Số Vị Trí Lắp (Line Items)</div>
              <div style="font-size:13.5px;font-weight:700;color:#c084fc;margin-top:2px;">
                ${part.lineItems || 0} dòng trong Components
              </div>
            </div>
            <div>
              <div style="font-size:11.5px;color:var(--text-secondary);">Số Lượng Part Thay Thế</div>
              <div style="font-size:13.5px;font-weight:700;color:#34d399;margin-top:2px;">
                ${distinctIcCount || part.interchangeCount || 0} Part thay thế (2-Way / 1-Way)
              </div>
            </div>
            <div>
              <div style="font-size:11.5px;color:var(--text-secondary);">Số Hồ Sơ AD Khớp</div>
              <div style="font-size:13.5px;font-weight:700;color:#fbbf24;margin-top:2px;">
                ${part.adCount || 0} Airworthiness Directives
              </div>
            </div>
          </div>

          <!-- Section 0: IPC Reference -->
          <div>
            <h4 style="font-size:14px;font-weight:700;color:#67e8f9;margin-bottom:8px;">
              📍 Vị Trí Tra Cứu IPC (IPC Reference / ATA - Figure - Item)
            </h4>
            ${refsHtml}
          </div>

          <!-- Section 1: Aircraft Installation (Collapsible) -->
          <div>
            <details style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:6px;overflow:hidden;" ontoggle="const ind = this.querySelector('.plane-toggle-arrow'); if (ind) ind.textContent = this.open ? 'Thu gọn ▲' : 'Bấm xem danh sách ▼';">
              <summary style="cursor:pointer;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;user-select:none;outline:none;background:rgba(255,255,255,0.03);list-style:none;transition:background 0.2s ease;" onmouseover="this.style.background='rgba(59,130,246,0.1)';" onmouseout="this.style.background='rgba(255,255,255,0.03)';">
                <span style="font-size:13.5px;font-weight:700;color:#93c5fd;display:inline-flex;align-items:center;gap:8px;">
                  ✈️ Danh Sách Tàu Bay Lắp Đặt Trên Đội Bay VJC (${part.planeCount || 0} tàu)
                </span>
                <span class="plane-toggle-arrow" style="font-size:12px;color:#60a5fa;font-weight:600;display:inline-flex;align-items:center;gap:4px;">
                  Bấm xem danh sách ▼
                </span>
              </summary>
              <div style="padding:10px 14px;border-top:1px solid rgba(255,255,255,0.06);background:rgba(0,0,0,0.15);">
                ${planesHtml}
              </div>
            </details>
          </div>

          <!-- Section 2: Interchange Relationships -->
          <div>
            <h4 style="font-size:14px;font-weight:700;color:#c084fc;margin-bottom:8px;">
              🔄 Bảng Quan Hệ Thay Thế (Interchange Relationships) Trong IPC
            </h4>
            <div class="table-responsive" style="max-height:280px;overflow-y:auto;border:1px solid rgba(255,255,255,0.08);border-radius:6px;">
              <table class="ad-table" id="tableIpcModalInterchange">
                <thead>
                  <tr>
                    <th style="width:14%;" title="Interchange Relationship">
                      <span class="col-full">Relation</span><span class="col-compact">Rel</span>
                    </th>
                    <th style="width:20%;" title="Interchange Part Number">
                      <span class="col-full">Interchange P/N</span><span class="col-compact">Part #</span>
                    </th>
                    <th style="width:22%;" title="Description">
                      <span class="col-full">Description</span><span class="col-compact">Desc</span>
                    </th>
                    <th style="width:8%;" title="Manufacturer Code">MFR</th>
                    <th style="width:29%;" title="Condition / Technical Reason">
                      <span class="col-full">Condition / Reason</span><span class="col-compact">Reason</span>
                    </th>
                    <th style="width:7%;text-align:center;" title="Interchangeability Code">INC</th>
                  </tr>
                </thead>
                <tbody>
                  ${icRows}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Section 3: Matched ADs -->
          <div>
            <h4 style="font-size:14px;font-weight:700;color:#fbbf24;margin-bottom:8px;">
              ⚠️ Airworthiness Directives (AD) Related to Part Number &amp; Interchange
            </h4>
            <div class="table-responsive" style="border:1px solid rgba(255,255,255,0.08);border-radius:6px;">
              <table class="ad-table" id="tableIpcModalAds">
                <thead>
                  <tr>
                    <th style="width:28%;">AD Number</th>
                    <th style="width:18%;">Authority</th>
                    <th style="width:34%;">Effective Date</th>
                    <th style="width:20%;text-align:center;">Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${adRows}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      `;

      // Wire AD click handlers in modal
      elBody.querySelectorAll(".btn-open-ad-from-ipc").forEach((btn) => {
        btn.addEventListener("click", () => {
          const adId = btn.getAttribute("data-adid");
          if (adId && typeof openAdModal === "function") {
            if (modal) modal.classList.remove("open");
            openAdModal(adId);
          }
        });
      });
    } catch (err) {
      elBody.innerHTML = `<div style="padding:20px;color:#fca5a5;">Lỗi khi tải chi tiết phụ tùng: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function fetchIpcFleet() {
    const tbody = document.getElementById("ipcFleetTableBody");
    const counterText = document.getElementById("ipcFleetCounterText");
    if (!tbody) return;

    if (ipcState.fleet && ipcState.fleet.length > 0) {
      renderIpcFleetTable(ipcState.fleet);
      return;
    }

    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted);">
          <div style="display:inline-block;animation:spin 1s linear infinite;margin-right:8px;">⏳</div>
          Đang tải danh sách 146 cấu hình tàu bay trong IPC...
        </td>
      </tr>
    `;

    try {
      let data = null;
      if (!isStaticHost) {
        try {
          const res = await fetch(getIpcApiUrl("/api/ipc/fleet"));
          if (res.ok) data = await res.json();
        } catch (e) {}
      }
      if (!data) {
        const res = await fetch("./db/vjc-ipc-fleet.json");
        if (res.ok) data = await res.json();
      }
      ipcState.fleet = Array.isArray(data) ? data : [];
      renderIpcFleetTable(ipcState.fleet);
      if (counterText) {
        counterText.textContent = `Hiển thị ${ipcState.fleet.length} cấu hình tàu bay`;
      }
    } catch (err) {
      console.error("Error fetching IPC fleet:", err);
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center;padding:24px;color:#fca5a5;">
            Không thể tải danh sách đội bay IPC: ${escapeHtml(err.message)}
          </td>
        </tr>
      `;
    }
  }

  function renderIpcFleetTable(fleetList) {
    const tbody = document.getElementById("ipcFleetTableBody");
    const searchInput = document.getElementById("ipcFleetSearchInput");
    const familySelect = document.getElementById("filterIpcFleetFamily");
    if (!tbody) return;

    const q = searchInput ? searchInput.value.trim().toUpperCase() : "";
    const fam = familySelect ? familySelect.value : "ALL";

    const filtered = (fleetList || []).filter((f) => {
      const family = f.family || f.Family;
      if (fam !== "ALL" && family !== fam) return false;
      if (q) {
        const text = `${f.fsn || f.Fsn} ${f.msn || f.Msn} ${f.reg || f.Registration} ${f.model || f.Model} ${f.engine || f.Engine} ${family}`.toUpperCase();
        if (text.indexOf(q) === -1) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted);">
            Không tìm thấy tàu bay nào khớp với điều kiện lọc.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered.map((f) => {
      const family = f.family || f.Family;
      let famColor = "#93c5fd";
      let famBg = "rgba(59,130,246,0.18)";
      if (family === "A330") { famColor = "#d8b4fe"; famBg = "rgba(168,85,247,0.2)"; }
      else if (family === "A321neo") { famColor = "#34d399"; famBg = "rgba(16,185,129,0.2)"; }

      const regVal = f.reg || f.Registration;
      const isNa = regVal === "n/a" || !regVal;
      const regHtml = isNa
        ? `<span style="color:var(--text-muted);font-style:italic;">n/a (chưa đăng bạ)</span>`
        : `<strong style="color:#60a5fa;font-size:13.5px;">✈️ ${escapeHtml(regVal)}</strong>`;

      return `
        <tr>
          <td><code style="font-weight:800;color:#fff;">${escapeHtml(f.fsn || f.Fsn || "---")}</code></td>
          <td><strong style="color:#fbbf24;">${escapeHtml(f.msn || f.Msn || "---")}</strong></td>
          <td>${regHtml}</td>
          <td><span class="badge badge-standard">${escapeHtml(f.model || f.Model || "---")}</span></td>
          <td style="font-size:12.5px;">${escapeHtml(f.engine || f.Engine || "---")}</td>
          <td style="text-align:right;font-weight:700;color:#c084fc;">
            ${Number(f.lineItemsEffective || f.LineItemsEffective || 0).toLocaleString("en-US")}
          </td>
          <td style="text-align:right;font-weight:700;color:#34d399;">
            ${Number(f.distinctPnEffective || f.DistinctPnEffective || 0).toLocaleString("en-US")}
          </td>
          <td>
            <span class="badge" style="background:${famBg};color:${famColor};font-size:11.5px;">
              ${escapeHtml(family || "---")}
            </span>
          </td>
        </tr>
      `;
    }).join("");
  }

  function exportIpcPartsCsv() {
    if (!ipcState.parts || ipcState.parts.length === 0) {
      showToast("Không có dữ liệu phụ tùng để xuất CSV.");
      return;
    }

    const headers = [
      "Part Number",
      "IPC Reference",
      "All IPC References",
      "Description",
      "MFR",
      "Installed on Fleet",
      "Families",
      "Line Items Effective",
      "Plane Count",
      "Sample Planes",
      "Interchange Count",
      "Interchanges Details",
      "AD Count",
      "Matched ADs"
    ];

    const rows = ipcState.parts.map((p) => {
      const icDetail = (p.interchanges || []).map(ic => `${ic.rel}: ${ic.icPn} (${ic.reason || ""})`).join(" | ");
      const adDetail = (p.matchedAds || []).map(a => `${a.auth} ${a.num}`).join(" | ");
      return [
        `"${(p.pn || "").replace(/"/g, '""')}"`,
        `"${(p.ipcRef || "").replace(/"/g, '""')}"`,
        `"${((p.ipcRefs || []).join(", ")).replace(/"/g, '""')}"`,
        `"${(p.desc || "").replace(/"/g, '""')}"`,
        `"${(p.mfr || "").replace(/"/g, '""')}"`,
        p.installed ? "Yes" : "No",
        `"${(p.families || []).join(", ")}"`,
        p.lineItems || 0,
        p.planeCount || 0,
        `"${(p.samplePlanes || []).join(", ")}"`,
        p.interchangeCount || 0,
        `"${icDetail.replace(/"/g, '""')}"`,
        p.adCount || 0,
        `"${adDetail.replace(/"/g, '""')}"`
      ];
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `VJC_IPC_Parts_Page${ipcState.page}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("✅ Đã xuất danh sách phụ tùng IPC ra file CSV thành công!");
  }

  function initIpcModule() {
    // 1. Sub-tab switching inside unified IPC & Appliances panel
    const btnSubParts = document.getElementById("btnIpcSubParts");
    const btnSubAppliancesPn = document.getElementById("btnIpcSubAppliancesPn");
    const btnSubAppliancesAds = document.getElementById("btnIpcSubAppliancesAds");
    const btnSubFleet = document.getElementById("btnIpcSubFleet");
    const btnSubGuide = document.getElementById("btnIpcSubGuide");

    const panelParts = document.getElementById("ipcSubPanelParts");
    const panelAppliances = document.getElementById("ipcSubPanelAppliances");
    const panelFleet = document.getElementById("ipcSubPanelFleet");
    const panelGuide = document.getElementById("ipcSubPanelGuide");

    function switchIpcSubTab(activeBtn, activePanel) {
      [btnSubParts, btnSubAppliancesPn, btnSubAppliancesAds, btnSubFleet, btnSubGuide].forEach((b) => b && b.classList.remove("active"));
      [panelParts, panelAppliances, panelFleet, panelGuide].forEach((p) => p && (p.style.display = "none"));
      if (activeBtn) activeBtn.classList.add("active");
      if (activePanel) activePanel.style.display = "block";
    }

    if (btnSubParts) {
      btnSubParts.addEventListener("click", () => {
        switchIpcSubTab(btnSubParts, panelParts);
        if (ipcState.parts.length === 0) fetchIpcParts(1);
      });
    }

    if (btnSubAppliancesPn) {
      btnSubAppliancesPn.addEventListener("click", () => {
        switchIpcSubTab(btnSubAppliancesPn, panelAppliances);
        applianceViewMode = "PN";
        const btnPn = document.getElementById("btnViewByPartNumber");
        const btnAds = document.getElementById("btnViewByApplianceAds");
        if (btnPn) { btnPn.className = "btn btn-primary btn-sm"; }
        if (btnAds) { btnAds.className = "btn btn-outline btn-sm"; }
        const tblPn = document.getElementById("tableAppliancesPn");
        const tblAds = document.getElementById("tableAppliancesAds");
        if (tblPn) tblPn.style.display = "";
        if (tblAds) tblAds.style.display = "none";
        filterAndRenderAppliances();
      });
    }

    if (btnSubAppliancesAds) {
      btnSubAppliancesAds.addEventListener("click", () => {
        switchIpcSubTab(btnSubAppliancesAds, panelAppliances);
        applianceViewMode = "AD";
        const btnPn = document.getElementById("btnViewByPartNumber");
        const btnAds = document.getElementById("btnViewByApplianceAds");
        if (btnAds) { btnAds.className = "btn btn-primary btn-sm"; }
        if (btnPn) { btnPn.className = "btn btn-outline btn-sm"; }
        const tblPn = document.getElementById("tableAppliancesPn");
        const tblAds = document.getElementById("tableAppliancesAds");
        if (tblPn) tblPn.style.display = "none";
        if (tblAds) tblAds.style.display = "";
        filterAndRenderAppliances();
      });
    }

    if (btnSubFleet) {
      btnSubFleet.addEventListener("click", () => {
        switchIpcSubTab(btnSubFleet, panelFleet);
        fetchIpcFleet();
      });
    }

    if (btnSubGuide) {
      btnSubGuide.addEventListener("click", () => {
        switchIpcSubTab(btnSubGuide, panelGuide);
      });
    }

    const navTabAppliances = document.getElementById("navTabAppliances");
    if (navTabAppliances) {
      navTabAppliances.addEventListener("click", () => {
        const navIpc = document.getElementById("navTabIpc");
        if (navIpc) navIpc.click();
        if (btnSubAppliancesPn) btnSubAppliancesPn.click();
      });
    }

    // 1.5 Click handlers for IPC KPI Cards (Stay within IPC tab, no jumping to main tab)
    const cardTotPn = document.getElementById("cardIpcTotalPn");
    if (cardTotPn) {
      cardTotPn.addEventListener("click", () => {
        if (btnSubParts) btnSubParts.click();
        const inp = document.getElementById("ipcSearchInput");
        if (inp) inp.value = "";
        const fFam = document.getElementById("filterIpcFamily");
        if (fFam) fFam.value = "ALL";
        const fAta = document.getElementById("filterIpcAta");
        if (fAta) fAta.value = "ALL";
        const fRel = document.getElementById("filterIpcRelation");
        if (fRel) fRel.value = "ALL";
        const fInst = document.getElementById("filterIpcInstalled");
        if (fInst) fInst.value = "ALL";
        const fAd = document.getElementById("filterIpcAdStatus");
        if (fAd) fAd.value = "ALL";
        applyPartsSearch();
        showToast("📦 Danh mục đầy đủ 114,648 Part Numbers trong IPC");
      });
    }

    const cardIc = document.getElementById("cardIpcInterchanges");
    if (cardIc) {
      cardIc.addEventListener("click", () => {
        if (btnSubParts) btnSubParts.click();
        const fRel = document.getElementById("filterIpcRelation");
        if (fRel) fRel.value = "2WAY";
        const fAd = document.getElementById("filterIpcAdStatus");
        if (fAd) fAd.value = "ALL";
        const fAta = document.getElementById("filterIpcAta");
        if (fAta) fAta.value = "ALL";
        applyPartsSearch();
        showToast("↔️ Đang lọc danh mục linh kiện thay thế 2 chiều (2-Way Interchange)");
      });
    }

    const cardFleet = document.getElementById("cardIpcFleet");
    if (cardFleet) {
      cardFleet.addEventListener("click", () => {
        if (btnSubFleet) btnSubFleet.click();
      });
    }

    const cardMatchedAds = document.getElementById("cardIpcMatchedAds");
    if (cardMatchedAds) {
      cardMatchedAds.addEventListener("click", () => {
        if (btnSubParts) btnSubParts.click();
        const fAd = document.getElementById("filterIpcAdStatus");
        if (fAd) fAd.value = "YES";
        const fRel = document.getElementById("filterIpcRelation");
        if (fRel) fRel.value = "ALL";
        const fAta = document.getElementById("filterIpcAta");
        if (fAta) fAta.value = "ALL";
        applyPartsSearch();
        showToast("⚠️ Đang lọc danh sách 222 Part Numbers có Airworthiness Directives (AD)");
      });
    }

    // 2. Search & Filter Handlers for Parts
    const searchInput = document.getElementById("ipcSearchInput");
    const btnSearch = document.getElementById("btnIpcSearch");
    const filterFamily = document.getElementById("filterIpcFamily");
    const filterPlane = document.getElementById("filterIpcPlane");
    const filterRelation = document.getElementById("filterIpcRelation");
    const filterInstalled = document.getElementById("filterIpcInstalled");
    const filterAdStatus = document.getElementById("filterIpcAdStatus");
    const filterAta = document.getElementById("filterIpcAta");
    const filterPartType = document.getElementById("filterIpcPartType");
    const btnReset = document.getElementById("btnResetIpcFilters");

    async function populateIpcPlaneDropdown() {
      const sel = document.getElementById("filterIpcPlane");
      if (!sel) return;
      try {
        if (!ipcState.fleet || ipcState.fleet.length === 0) {
          let data = null;
          if (!isStaticHost) {
            try {
              const res = await fetch(getIpcApiUrl("/api/ipc/fleet"));
              if (res.ok) data = await res.json();
            } catch (e) {}
          }
          if (!data) {
            const res = await fetch("./db/vjc-ipc-fleet.json");
            if (res.ok) data = await res.json();
          }
          ipcState.fleet = Array.isArray(data) ? data : [];
        }

        const selectedFamily = (filterFamily?.value || "ALL").toUpperCase();
        const a330 = [];
        const ceo = [];
        const neo = [];

        (ipcState.fleet || []).forEach((f) => {
          const reg = f.reg || f.Reg || "";
          if (!reg) return;
          const fam = (f.family || f.Family || "").toUpperCase();
          const msn = f.msn || f.MSN || "";
          const fsn = f.fsn || f.FSN || "";
          const label = `${reg} (MSN ${msn} • FSN ${fsn})`;

          if (fam.includes("A330")) {
            if (selectedFamily === "ALL" || selectedFamily === "A330") a330.push({ reg, label });
          } else if (fam.includes("NEO")) {
            if (selectedFamily === "ALL" || selectedFamily.includes("NEO")) neo.push({ reg, label });
          } else {
            if (selectedFamily === "ALL" || selectedFamily.includes("CEO")) ceo.push({ reg, label });
          }
        });

        a330.sort((a, b) => a.reg.localeCompare(b.reg));
        ceo.sort((a, b) => a.reg.localeCompare(b.reg));
        neo.sort((a, b) => a.reg.localeCompare(b.reg));

        const curVal = sel.value;
        const totalCount = a330.length + ceo.length + neo.length;
        let optHtml = `<option value="ALL">✈️ Tất cả tàu bay (${totalCount} tàu)</option>`;

        if (a330.length > 0) {
          optHtml += `<optgroup label="Airbus A330 (${a330.length} tàu)">${a330.map(p => `<option value="${escapeHtml(p.reg)}">${escapeHtml(p.label)}</option>`).join("")}</optgroup>`;
        }
        if (ceo.length > 0) {
          optHtml += `<optgroup label="Airbus A320ceo & A321ceo (${ceo.length} tàu)">${ceo.map(p => `<option value="${escapeHtml(p.reg)}">${escapeHtml(p.label)}</option>`).join("")}</optgroup>`;
        }
        if (neo.length > 0) {
          optHtml += `<optgroup label="Airbus A321neo (${neo.length} tàu)">${neo.map(p => `<option value="${escapeHtml(p.reg)}">${escapeHtml(p.label)}</option>`).join("")}</optgroup>`;
        }

        sel.innerHTML = optHtml;
        if (curVal && curVal !== "ALL" && sel.querySelector(`option[value="${curVal}"]`)) {
          sel.value = curVal;
        } else {
          sel.value = "ALL";
        }
      } catch (err) {
        console.warn("Could not populate plane dropdown:", err);
      }
    }

    populateIpcPlaneDropdown();

    function applyPartsSearch() {
      ipcState.filters.q = searchInput ? searchInput.value.trim() : "";
      ipcState.filters.family = filterFamily ? filterFamily.value : "ALL";
      ipcState.filters.plane = filterPlane ? filterPlane.value : "ALL";
      ipcState.filters.relation = filterRelation ? filterRelation.value : "ALL";
      ipcState.filters.installed = filterInstalled ? filterInstalled.value : "ALL";
      ipcState.filters.hasAd = filterAdStatus ? filterAdStatus.value : "ALL";
      ipcState.filters.ata = filterAta ? filterAta.value : "ALL";
      ipcState.filters.partType = filterPartType ? filterPartType.value : "ALL";
      fetchIpcParts(1);
    }

    if (btnSearch) btnSearch.addEventListener("click", applyPartsSearch);
    if (searchInput) {
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          applyPartsSearch();
        }
      });
    }

    if (filterFamily) {
      filterFamily.addEventListener("change", () => {
        populateIpcPlaneDropdown();
        applyPartsSearch();
      });
    }

    [filterPlane, filterRelation, filterInstalled, filterAdStatus, filterAta, filterPartType].forEach((sel) => {
      if (sel) sel.addEventListener("change", applyPartsSearch);
    });

    if (btnReset) {
      btnReset.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";
        if (filterFamily) filterFamily.value = "ALL";
        if (filterPlane) filterPlane.value = "ALL";
        if (filterRelation) filterRelation.value = "ALL";
        if (filterInstalled) filterInstalled.value = "ALL";
        if (filterAdStatus) filterAdStatus.value = "ALL";
        if (filterAta) filterAta.value = "ALL";
        if (filterPartType) filterPartType.value = "ALL";
        populateIpcPlaneDropdown();
        applyPartsSearch();
      });
    }

    // 3. Pagination Handlers
    const btnPrev = document.getElementById("btnIpcPrevPage");
    const btnNext = document.getElementById("btnIpcNextPage");
    if (btnPrev) {
      btnPrev.addEventListener("click", () => {
        if (ipcState.page > 1) fetchIpcParts(ipcState.page - 1);
      });
    }
    if (btnNext) {
      btnNext.addEventListener("click", () => {
        const totalPages = Math.ceil(ipcState.totalParts / ipcState.pageSize) || 1;
        if (ipcState.page < totalPages) fetchIpcParts(ipcState.page + 1);
      });
    }

    // 4. Export Excel/CSV
    const btnExport = document.getElementById("btnExportIpcExcel");
    if (btnExport) btnExport.addEventListener("click", exportIpcPartsCsv);

    // 5. Fleet Search Handlers
    const fleetSearch = document.getElementById("ipcFleetSearchInput");
    const fleetFamily = document.getElementById("filterIpcFleetFamily");
    if (fleetSearch) {
      fleetSearch.addEventListener("input", () => renderIpcFleetTable(ipcState.fleet));
    }
    if (fleetFamily) {
      fleetFamily.addEventListener("change", () => renderIpcFleetTable(ipcState.fleet));
    }

    // 6. Modal Close Handlers
    const modal = document.getElementById("ipcPartDetailModal");
    const btnClose1 = document.getElementById("btnCloseIpcModal");
    const btnClose2 = document.getElementById("btnCloseIpcModalBottom");
    [btnClose1, btnClose2].forEach((b) => {
      if (b) b.addEventListener("click", () => modal && modal.classList.remove("open"));
    });
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.classList.remove("open");
      });
    }

    // 7. Auto load stats and first page when navigating to tab-ipc
    const navTabIpc = document.getElementById("navTabIpc");
    if (navTabIpc) {
      navTabIpc.addEventListener("click", () => {
        loadIpcStats();
        if (ipcState.parts.length === 0) fetchIpcParts(1);
      });
    }

    // Initial stats load
    loadIpcStats();
  }


    applyAdminUiState();
    initEvents();
    initPwaSupport();
    loadDatabaseFromServer();
    loadAppliancesCatalog();
    initIpcModule();
  });
})();
