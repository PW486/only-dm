/*
 * Debug action: build a text-free DOM skeleton and show it in a copyable
 * overlay. Invoked from "Developer > Copy DOM Skeleton".
 *
 * The JSON contains layout structure only. It never contains visible text,
 * message contents, names, handles, image URLs, or alt/aria values.
 */
(function () {
  "use strict";

  if (typeof window.__ONLYDM_BUILD_SKELETON__ !== "function") {
    console.error("[OnlyDM] Skeleton builder is not loaded.");
    return;
  }

  var OVERLAY_ID = "onlydm-dom-skeleton-overlay";
  var existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    existing.remove();
  }

  var skeleton = window.__ONLYDM_BUILD_SKELETON__(document.body);
  var json = JSON.stringify(skeleton, null, 2);
  window.__ONLYDM_LAST_SKELETON__ = skeleton;

  var overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483647",
    "display:flex",
    "flex-direction:column",
    "gap:12px",
    "padding:24px",
    "box-sizing:border-box",
    "background:rgba(9,9,11,0.98)",
    "color:#f5f5f7",
    "font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "overflow:hidden",
  ].join(";");

  var title = document.createElement("div");
  title.textContent = "OnlyDM DOM skeleton (text-free)";
  title.style.cssText = "font-size:20px;font-weight:600;letter-spacing:-0.02em";
  overlay.appendChild(title);

  var summary = document.createElement("div");
  summary.textContent =
    skeleton.items.length +
    " visible elements · viewport " +
    skeleton.viewport.width +
    "×" +
    skeleton.viewport.height +
    " · DPR " +
    (skeleton.devicePixelRatio || 1) +
    (skeleton.truncated ? " · truncated at 3000 items" : "");
  summary.style.cssText = "color:#a1a1aa";
  overlay.appendChild(summary);

  var note = document.createElement("div");
  note.textContent =
    "This JSON contains no names, messages, handles, image URLs, alt text, or aria-label values. Copy it and share it for selector debugging.";
  note.style.cssText = "color:#a1a1aa;max-width:900px";
  overlay.appendChild(note);

  var actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:10px;flex-wrap:wrap";

  var buttonStyle = [
    "appearance:none",
    "border:1px solid #3f3f46",
    "border-radius:8px",
    "background:#18181b",
    "color:#fafafa",
    "padding:9px 14px",
    "font:inherit",
    "cursor:pointer",
  ].join(";");

  function fallbackCopy(text) {
    var textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.cssText =
      "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none";
    document.documentElement.appendChild(textarea);
    textarea.focus();
    textarea.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (_) {}
    textarea.remove();
    return ok;
  }

  function markCopied() {
    copy.textContent = "Copied";
    setTimeout(function () {
      copy.textContent = "Copy JSON";
    }, 1600);
  }

  var copy = document.createElement("button");
  copy.textContent = "Copy JSON";
  copy.style.cssText = buttonStyle;
  copy.onclick = function () {
    navigator.clipboard
      .writeText(json)
      .then(markCopied)
      .catch(function () {
        if (fallbackCopy(json)) {
          markCopied();
        } else {
          copy.textContent = "Copy failed — select the JSON below";
        }
      });
  };
  actions.appendChild(copy);

  var close = document.createElement("button");
  close.textContent = "Close";
  close.style.cssText = buttonStyle;
  close.onclick = function () {
    overlay.remove();
  };
  actions.appendChild(close);

  overlay.appendChild(actions);

  var pre = document.createElement("pre");
  pre.style.cssText = [
    "margin:0",
    "padding:14px",
    "border:1px solid #27272a",
    "border-radius:10px",
    "background:#111113",
    "color:#d4d4d8",
    "white-space:pre",
    "overflow:auto",
    "flex:1",
    "min-height:0",
    "font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace",
  ].join(";");
  pre.textContent = json;
  overlay.appendChild(pre);

  document.documentElement.appendChild(overlay);
  console.info(
    "[OnlyDM] DOM skeleton built:",
    skeleton.items.length,
    "items",
    skeleton.truncated ? "(truncated)" : ""
  );
})();
