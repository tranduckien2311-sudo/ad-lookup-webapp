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
    if (String(ad.adAffectedPart || "").trim()) {
      return "COMPONENT";
    }
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
        /^(7[1-9]|80)\b/.test(ata) ||
        /\b(Powerplant|Engine Turbine)\b/i.test(ata) ||
        (!isAirframeHolder &&
          /\b(CFM56|PW1100G|PW1133G|Trent\s*7|Trent\s*1000|LEAP-1|V2500|Rolls-Royce.*Engines|Pratt\s*&\s*Whitney.*Engines|CFM International|International Aero Engines|Engine Alliance|GE Aviation|General Electric Company Engines|Safran Aircraft Engines|Lycoming|Continental|Turbomeca)\b/i.test(
            sm
          )))
    ) {
      return "ENGINE";
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
      /\bComponent\b|\bAppliance\b/i.test(cat) && !isAirframeHolder ||
      isComponentOem ||
      (!isAirframeHolder && (isComponentSubject || /\b(25|26|34|35|49)\b/.test(ata) && /\bP\/N\b|Part Number/i.test(appTxt)))
    ) {
      return "COMPONENT";
    }

    return "AIRCRAFT";
  }

  function renderAdEngineOrClassHtml(ad) {
    const bucket = classifyAdBucket(ad);
    const eng = String((ad && ad.adExtractedEngines) || "").trim();
    let classHtml = "";
    if (bucket === "ENGINE") {
      classHtml = `<div style="font-size:11.5px;color:#c4b5fd;margin-bottom:3px;"><strong style="color:#c4b5fd;">🔥 Động cơ:</strong> ${escapeHtml(
        eng && eng !== "Theo cấu hình TCDS" ? eng : "Theo model động cơ trong AD"
      )}</div>`;
    } else if (bucket === "COMPONENT") {
      classHtml = `<div style="font-size:11.5px;color:#fcd34d;margin-bottom:3px;"><strong style="color:#fbbf24;">🧩 Phân loại:</strong> Component / Thiết bị (Appliance)</div>`;
    } else if (eng && eng !== "Theo cấu hình TCDS" && !/Không áp dụng|Airframe/i.test(eng)) {
      classHtml = `<div style="font-size:11.5px;color:var(--text-secondary);margin-bottom:3px;"><strong style="color:#c4b5fd;">Động cơ liên quan:</strong> ${escapeHtml(
        eng
      )}</div>`;
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

  // Render grouped Dropdown List for a Superseding AD and its Superseded ADs (each with its own PDF & Verbatim Text!)
  function renderSupersededDropdownHtml(ad, forceOpen) {
    const supList = ad.supersededAds || [];
    if (supList.length === 0) {
      return `<div style="margin-top:5px;"><span class="badge badge-standard" style="opacity:0.75;">AD Độc lập (Không thay thế AD cũ)</span></div>`;
    }

    const isOpenAttr = forceOpen || expandAllSuperseded ? "open" : "";

    const selectOptions = [
      `<option value="CURRENT">🟢 [HIỆN HÀNH - SUPERSEDING] ${escapeHtml(ad.adNumber)} (Eff: ${escapeHtml(
        ad.effectiveDate
      )})</option>`,
      ...supList.map(
        (s, idx) =>
          `<option value="SUP_${idx}">🔴 [SUPERSEDED - BỊ THAY THẾ] ${escapeHtml(
            s.adNumber
          )} (Issued: ${escapeHtml(s.issuedDate || "Historical")} — Có PDF gốc)</option>`
      )
    ].join("");

    const detailItems = supList
      .map(
        (s, idx) => `
        <div class="superseded-item" style="border-left:3px solid #f59e0b;padding-left:8px;">
          <div class="superseded-item-head" style="flex-wrap:wrap;gap:6px;">
            <div style="display:flex;align-items:flex-start;gap:6px;">
              <span class="badge badge-superseded">⚠️ SUPERSEDED</span>
              <span class="superseded-num" style="font-weight:700;color:#fde68a;">${renderAdNumberSplitHtml(
                s,
                true
              )}</span>
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
                supIdx: idx,
                side: "main",
                viewLabel: `📎 PDF ${s.officialFaaAd ? `FAA ${s.officialFaaAd}` : s.adNumber} ↗`,
                uploadLabel: `📤 Upload PDF ${s.officialFaaAd ? `FAA ${s.officialFaaAd}` : s.adNumber}`,
                style: "padding:2px 8px;font-size:11px;border-color:rgba(245,158,11,0.65);color:#fbbf24;font-weight:600;"
              })}
              ${
                s.easaAdNumber && s.officialFaaAd
                  ? renderPdfActionHtml(ad.id, s, {
                      supIdx: idx,
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
            🔗 Chuỗi AD Thay thế &amp; Bị thay thế (Dropdown gom ${supList.length + 1} AD — Đủ PDF AD cũ):
          </label>
          <select class="form-control superseded-chain-select" data-parent-ad-id="${escapeHtml(
            ad.id
          )}" style="padding:5px 8px;font-size:11.5px;border-color:rgba(245,158,11,0.55);background:rgba(15,23,42,0.85);color:#fde68a;font-weight:600;">
            ${selectOptions}
          </select>
        </div>

        <details class="superseded-dropdown" ${isOpenAttr}>
          <summary>
            <span>📂 Xem ${supList.length} AD bị Superseded &amp; File PDF gốc (${supList
      .map((x) => escapeHtml(x.adNumber))
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
    if (/Engine|turbine|HPT|LPT|compressor|HPC|fan blade|borescope|rotor|hub|disk|IBR/i.test(title + " " + abstract)) {
      ata = "72 - Engine Turbine / Compressor / Rotor";
    } else if (/fuel|LPSOV|tank/i.test(abstract)) ata = "28 - Fuel System";
    else if (/flight control|FCPC|ELAC|elevator|flap|slat/i.test(abstract)) ata = "27 - Flight Controls";
    else if (/landing gear|MLG|NLG|bogie|brake/i.test(abstract)) ata = "32 - Landing Gear";
    else if (/overhead stowage|OHSC|slide|door|girt bar/i.test(abstract)) ata = "25 / 52 - Cabin & Doors";
    else if (/radio management|RMP|navigation|radar/i.test(abstract)) ata = "34 - Navigation & Avionics";
    else if (/wing|spigot|fuselage|crack|corrosion/i.test(abstract)) ata = "53 / 57 - Structures";

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
      if (bannerTitle) {
        bannerTitle.textContent = `📅 Đã quét ${r.biweeklyLabel} (${r.windowStart} → ${r.windowEnd}): Cập nhật +${r.faaAdded || 0} FAA AD mới (${r.faaUpdated || 0} chỉnh sửa) & +${r.easaAdded || 0} EASA AD mới (${r.easaUpdated || 0} chỉnh sửa)`;
      }
      if (bannerDesc) {
        bannerDesc.innerHTML = `Lần quét gần nhất: <strong>${escapeHtml(
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

  async function runBiweeklyAdSync() {
    if (!requireAdmin()) return;
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const dayOfYear = Math.floor((now - startOfYear) / 86400000) + 1;
    const bwNum = Math.min(26, Math.max(1, Math.ceil(dayOfYear / 14)));
    const prevBw = bwNum > 1 ? bwNum - 1 : 26;
    const prevYear = bwNum > 1 ? now.getFullYear() : now.getFullYear() - 1;
    const fallbackBwLabel = `Biweekly ${prevYear}-${String(prevBw).padStart(2, "0")} & ${now.getFullYear()}-${String(
      bwNum
    ).padStart(2, "0")}`;
    const windowEnd = now.toISOString().slice(0, 10);
    const windowStart = new Date(now.getTime() - 28 * 86400000).toISOString().slice(0, 10);

    const bannerTitle = document.getElementById("autoBannerTitle");
    if (bannerTitle) {
      bannerTitle.textContent = `⏳ Đang quét EASA / FAA ${fallbackBwLabel} (${windowStart} → ${windowEnd}) & cập nhật CSDL...`;
    }
    showToast(`🔄 Đang quét AD ${fallbackBwLabel} từ EASA Archive & FAA Federal Register...`);

    try {
      const resp = await fetch("./api/sync-biweekly", { method: "POST" });
      if (resp.ok) {
        const db = await resp.json();
        if (db && Array.isArray(db.ads) && db.ads.length > 0) {
          adList = db.ads;
          lastSyncedAt = db.lastSyncedAt || new Date().toLocaleString("vi-VN");
          lastBiweeklyReport = db.lastBiweeklyReport || {
            biweeklyLabel: fallbackBwLabel,
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
            `✅ Đã quét ${r.biweeklyLabel}: +${r.faaAdded} FAA AD (${r.faaUpdated} cập nhật) & +${r.easaAdded} EASA AD (${r.easaUpdated} cập nhật)!`
          );
          return;
        }
      }
    } catch (e) {}

    // Client-side Federal Register biweekly scan fallback (for static GitHub Pages)
    try {
      const frUrl = `https://www.federalregister.gov/api/v1/documents.json?per_page=100&order=newest&conditions%5Bagencies%5D%5B%5D=federal-aviation-administration&conditions%5Btype%5D%5B%5D=RULE&conditions%5Bterm%5D=%22Airworthiness%20Directives%22&conditions%5Bpublication_date%5D%5Bgte%5D=${windowStart}&fields%5B%5D=document_number&fields%5B%5D=title&fields%5B%5D=publication_date&fields%5B%5D=effective_on&fields%5B%5D=pdf_url&fields%5B%5D=html_url&fields%5B%5D=abstract&fields%5B%5D=docket_ids`;
      const frResp = await fetch(frUrl);
      if (frResp.ok) {
        const data = await frResp.json();
        const docs = (data.results || []).filter((d) => String(d.title || "").includes("Airworthiness Directives"));
        const existingDocNums = new Set(adList.map((a) => String(a.docNumber || "")).filter(Boolean));
        const existingFaaNums = new Set(adList.map((a) => String(a.officialFaaAd || "")).filter(Boolean));
        let faaAdded = 0;
        let easaAdded = 0;
        docs.forEach((doc) => {
          const ev = evaluateAdAgainstVjcFleet(doc);
          const dupDoc = doc.document_number && existingDocNums.has(String(doc.document_number));
          const dupFaa = ev.officialFaaAd && existingFaaNums.has(String(ev.officialFaaAd));
          if (!dupDoc && !dupFaa) {
            adList.unshift(ev);
            if (ev.easaAdNumber) easaAdded++;
            faaAdded++;
          }
        });
        lastSyncedAt = new Date().toLocaleString("vi-VN");
        lastBiweeklyReport = {
          biweeklyLabel: fallbackBwLabel,
          windowStart,
          windowEnd,
          scannedAt: lastSyncedAt,
          faaScanned: docs.length,
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
        showToast(`✅ Đã quét ${fallbackBwLabel}: +${faaAdded} FAA AD (kèm ${easaAdded} EASA liên quan)!`);
      }
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
    const sortBy = document.getElementById("sortSelect").value;

    let filtered = adList.filter((ad) => {
      if (auth !== "ALL") {
        const combinedAuth = `${ad.authority} ${ad.authorityDual || ""} ${ad.adNumber}`.toUpperCase();
        if (auth === "EASA" && !combinedAuth.includes("EASA") && !combinedAuth.includes("MCAI")) return false;
        if (auth === "FAA" && !combinedAuth.includes("FAA")) return false;
        if (auth === "CAAV" && !combinedAuth.includes("CAAV")) return false;
      }
      if (app !== "ALL" && ad.applicabilityStatus !== app) return false;

      if (adTypeFilter !== "ALL") {
        const bucket = classifyAdBucket(ad);
        if (adTypeFilter === "NON_AIRCRAFT") {
          if (bucket === "AIRCRAFT") return false;
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
          ? `<span class="badge status-closed" style="font-size:12px;padding:4px 10px;">✅ APPLICABLE</span>`
          : `<span class="badge status-overdue" style="font-size:12px;padding:4px 10px;background:rgba(148,163,184,0.15);color:#cbd5e1;border-color:#475569;">🚫 NOT APPLICABLE</span>`;

        const supQuickPdfs =
          hasSup
            ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;">
                 ${supList
                   .map((s, sIdx) =>
                     renderPdfActionHtml(ad.id, s, {
                       supIdx: sIdx,
                       side: "main",
                       viewLabel: `📎 PDF ${s.adNumber} ↗`,
                       uploadLabel: `📤 Upload ${s.adNumber}`,
                       style: "font-size:10.5px;padding:2px 6px;border-color:rgba(245,158,11,0.55);color:#fbbf24;",
                       title: `Mở PDF gốc của AD bị thay thế ${s.adNumber}`
                     })
                   )
                   .join("")}
               </div>`
            : "";

        const splitInfo = getSplitAdParts(ad);

        if (splitInfo.isDual) {
          const easaFirst = isEasaPrimaryDual(ad);
          const easaEff = ad.easaEffectiveDate || ad.effectiveDate || "-";
          const easaIss = ad.easaIssuedDate || ad.issueDate || "-";
          const easaSubj = ad.easaSubject || ad.subject || "";
          const easaSum = ad.easaSummary || ad.summary || "";
          const easaMod = ad.easaModels || ad.adExtractedModels || "";
          const firstSideLabel = easaFirst ? splitInfo.easaLabel : splitInfo.faaLabel;
          const easaSupWarn = ad.easaSupersededBy
            ? `<div style="margin-top:4px;"><span class="badge badge-superseded" style="font-size:10px;">⚠️ EASA Superseded by ${escapeHtml(
                ad.easaSupersededBy
              )}</span></div>`
            : "";

          const renderDualFaaRow = (isFirst) => `
          <tr class="dual-row-faa ${isFirst ? "dual-row-top" : "dual-row-bottom"}" data-ad-id="${escapeHtml(ad.id)}" data-ad-side="faa" style="${isApp ? "" : "opacity:0.92;"}">
            <td data-label="Số hiệu AD (FAA)" style="min-width:265px;">
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
                         ${hasSup ? `<span class="badge badge-superseding">🔗 Supersedes ${supList.length} AD</span>` : ""}
                       </div>
                       ${renderSupersededDropdownHtml(ad, matchedSupInSearch)}
                     </div>`
                  : `<div class="desktop-only-cell-extras" style="font-size:11px;color:var(--text-muted);margin-top:4px;">
                       ↳ Cùng nội dung với <strong>${escapeHtml(firstSideLabel)}</strong>
                     </div>`
              }
            </td>
            <td data-label="Cơ quan & PDF FAA" onclick="event.stopPropagation();" style="min-width:195px;">
              <div><span class="badge badge-faa">🇺🇸 FAA</span></div>
              <div style="margin-top:7px;display:flex;flex-direction:column;gap:5px;">
                ${renderPdfActionHtml(ad.id, ad, {
                  side: "faa",
                  viewLabel: "📎 PDF FAA AD ↗",
                  uploadLabel: "📤 Upload PDF FAA",
                  style: "font-size:11.5px;padding:4px 8px;border-color:rgba(59,130,246,0.5);color:#60a5fa;text-align:left;"
                })}
                ${isFirst ? supQuickPdfs : ""}
              </div>
            </td>
            <td data-label="Tàu bay, Động cơ & MSN" style="min-width:265px;">
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
            <td data-label="Nội dung FAA AD" style="min-width:420px;max-width:560px;">
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
            <td data-label="Số hiệu AD (EASA)" style="min-width:265px;">
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
                         ${hasSup ? `<span class="badge badge-superseding">🔗 Supersedes ${supList.length} AD</span>` : ""}
                       </div>
                       ${easaSupWarn}
                       ${renderSupersededDropdownHtml(ad, matchedSupInSearch)}
                     </div>`
                  : `<div class="desktop-only-cell-extras" style="font-size:11px;color:var(--text-muted);margin-top:4px;">
                       ↳ Cùng nội dung với <strong>${escapeHtml(firstSideLabel)}</strong>
                       ${easaSupWarn}
                     </div>`
              }
            </td>
            <td data-label="Cơ quan & PDF EASA" onclick="event.stopPropagation();" style="min-width:195px;">
              <div><span class="badge badge-easa">🇪🇺 EASA</span></div>
              <div style="margin-top:7px;display:flex;flex-direction:column;gap:5px;">
                ${renderPdfActionHtml(ad.id, ad, {
                  side: "easa",
                  viewLabel: "📎 PDF EASA AD ↗",
                  uploadLabel: "📤 Upload PDF EASA",
                  style: "font-size:11.5px;padding:4px 8px;border-color:rgba(16,185,129,0.55);color:#34d399;text-align:left;"
                })}
                ${isFirst ? supQuickPdfs : ""}
              </div>
            </td>
            <td data-label="Tàu bay & Động cơ (EASA)" style="min-width:265px;">
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
            <td data-label="Nội dung EASA AD" style="min-width:420px;max-width:560px;">
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
            <td data-label="Số hiệu AD" style="min-width:265px;">
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
            <td data-label="Cơ quan & PDF" onclick="event.stopPropagation();" style="min-width:195px;">
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
            <td data-label="Tàu bay, Động cơ & MSN" style="min-width:265px;">
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
            <td data-label="Nội dung AD" style="min-width:420px;max-width:560px;">
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
              </div>`;
            return `
            <div class="dash-card" style="border-left:5px solid #10b981;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;border-bottom:1px solid var(--border-color);padding-bottom:10px;margin-bottom:12px;">
                <div style="flex:1;">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
                    <span class="badge status-closed" style="font-size:12px;">✅ APPLICABLE (${fleetArr.length}/${fleetList.length} TÀU VJC)</span>
                    ${getAuthorityBadge(ad)}
                    <span class="badge badge-superseding">🔗 Cặp AD Song Song (2 dòng ${easaFirst ? "EASA &amp; FAA" : "FAA &amp; EASA"})</span>
                  </div>
                  ${supList.length > 0 ? renderSupersededDropdownHtml(ad, false) : ""}
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
                    <span class="badge status-closed" style="font-size:12px;">✅ APPLICABLE (${fleetArr.length}/${fleetList.length} TÀU VJC)</span>
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
            <td data-label="AD áp dụng"><span class="badge status-closed">${appAdsCount} AD Applicable</span></td>
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
      ["✅ Applicable (Áp dụng đội bay 108 tàu VJC)", adList.filter((a) => a.applicabilityStatus === "Applicable").length],
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

  // Open Detail Modal: Displays 100% Verbatim Text + Official PDF for Current (EASA/FAA side) and any Superseded AD!
  async function openAdModal(adId, supIdx = null, adSide = null) {
    const ad = adList.find((x) => x.id === adId);
    if (!ad) return;
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

    document.getElementById("modalBadges").innerHTML = `
      ${
        isViewingSup
          ? `<span class="badge badge-superseded" style="font-size:12px;">⚠️ ĐANG XEM AD BỊ THAY THẾ (SUPERSEDED BY ${escapeHtml(
              ad.adNumber
            )})</span>`
          : `<span class="badge ${isApp ? "status-closed" : "status-overdue"}">${escapeHtml(
              ad.applicabilityStatus.toUpperCase()
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
    const switcherHtml =
      splitInfo.isDual || supList.length > 0
        ? `
        <div class="detail-box" style="border-color:rgba(245,158,11,0.65);background:rgba(15,23,42,0.85);">
          <div class="label" style="color:#fbbf24;font-size:12px;margin-bottom:8px;">
            🔗 CHUYỂN ĐỔI XEM PDF &amp; NGUYÊN VĂN (${splitInfo.isDual ? "FAA ↔ EASA" : "HIỆN HÀNH"}${
              supList.length > 0 ? ` + ${supList.length} AD BỊ SUPERSEDED` : ""
            }):
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${
              splitInfo.isDual
                ? (() => {
                    const faaBtn = `<button type="button" class="btn ${
                      isDualFaaView ? "btn-primary" : "btn-outline"
                    } btn-sm modal-switch-doc-btn" data-sup-idx="" data-ad-side="faa">
                     🇺🇸 [FAA] ${escapeHtml(splitInfo.faaLabel)} (Eff: ${escapeHtml(ad.effectiveDate)})
                   </button>`;
                    const easaBtn = `<button type="button" class="btn ${
                      isDualEasaView ? "btn-primary" : "btn-outline"
                    } btn-sm modal-switch-doc-btn" data-sup-idx="" data-ad-side="easa" style="${
                      isDualEasaView
                        ? "background:#059669;border-color:#10b981;"
                        : "border-color:rgba(16,185,129,0.55);color:#34d399;"
                    }">
                     🇪🇺 [EASA] ${escapeHtml(splitInfo.easaLabel)} (Eff: ${escapeHtml(
                      ad.easaEffectiveDate || ad.effectiveDate
                    )})
                   </button>`;
                    return easaFirst ? easaBtn + faaBtn : faaBtn + easaBtn;
                  })()
                : `<button type="button" class="btn ${
                    !isViewingSup ? "btn-primary" : "btn-outline"
                  } btn-sm modal-switch-doc-btn" data-sup-idx="" data-ad-side="faa">
                     🟢 [HIỆN HÀNH] ${escapeHtml(ad.adNumber)} (Eff: ${escapeHtml(ad.effectiveDate)})
                   </button>`
            }
            ${supList
              .map(
                (s, idx) => `
              <button type="button" class="btn ${
                activeSupIdx === idx ? "btn-primary" : "btn-outline"
              } btn-sm modal-switch-doc-btn" data-sup-idx="${idx}" data-ad-side="faa" style="${
                  activeSupIdx === idx
                    ? "background:#d97706;border-color:#f59e0b;"
                    : "border-color:rgba(245,158,11,0.55);color:#fde68a;"
                }">
                🔴 [SUPERSEDED] ${escapeHtml(s.adNumber)} (Issued: ${escapeHtml(
                  s.issuedDate || "Historical"
                )})
              </button>
              <a href="${escapeHtml(
                getSafePdfUrl(s)
              )}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="border-color:rgba(59,130,246,0.5);color:#60a5fa;">
                📎 Mở PDF ${escapeHtml(s.adNumber)} ↗
              </a>`
              )
              .join("")}
          </div>
        </div>`
        : "";

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

    document.getElementById("modalBodyContent").innerHTML = `
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
            ${isApp ? `✅ Applicable (${(ad.affectedFleet || []).length}/${fleetList.length} tàu VJC)` : "🚫 Not Applicable"}
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
    updateKpis();
    renderAdTable();
    renderAutoEvaluationsTab();
    renderFleetTab();
    renderDashboard();
  }

  function initEvents() {
    document.querySelectorAll(".nav-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".nav-tab").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        const target = document.getElementById(btn.getAttribute("data-tab"));
        if (target) target.classList.add("active");
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

    // When selecting a Superseded AD in the dropdown, open the details box or open its PDF/Text in modal
    document.body.addEventListener("change", (e) => {
      if (e.target.classList.contains("superseded-chain-select")) {
        const wrapper = e.target.closest(".superseded-group-wrapper");
        const parentAdId = e.target.getAttribute("data-parent-ad-id");
        const val = e.target.value;
        if (wrapper) {
          const det = wrapper.querySelector("details.superseded-dropdown");
          if (det && val !== "CURRENT") {
            det.open = true;
          }
        }
        if (parentAdId && val.startsWith("SUP_")) {
          const supIdx = Number(val.replace("SUP_", ""));
          openAdModal(parentAdId, supIdx);
        }
      }
    });

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

    // KPI Quick Filters
    document.querySelectorAll(".kpi-card").forEach((card) => {
      card.addEventListener("click", () => {
        const qf = card.getAttribute("data-QuickFilter");
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
    applyAdminUiState();
    initEvents();
    initPwaSupport();
    loadDatabaseFromServer();
  });
})();
