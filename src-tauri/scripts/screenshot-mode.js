/*
 * OnlyDM demo screenshot mode (debug builds only).
 *
 * This script is evaluated from the native "Developer > Prepare Demo
 * Screenshot" menu item. It never sends data anywhere. Its only job is to
 * replace the contents of the live Instagram DM DOM with deterministic sample
 * data *before* the window is captured.
 *
 * Safety model:
 *   1. Hide the real page immediately.
 *   2. Clone the rendered body, remove executable/live nodes, and swap the
 *      original body out. React can no longer re-render real content into the
 *      sanitized copy.
 *   3. Replace every visible text node and image with fixture data.
 *   4. Verify that no visible text/image can be traced back to the real page.
 *      If verification fails, keep the real page hidden and show a failure
 *      overlay containing only a text-free DOM skeleton.
 *   5. Only after verification passes, reveal the sanitized copy and draw the
 *      two green capture markers. `scripts/prepare-screenshot.py` refuses to
 *      process a capture without those markers.
 *
 * The fixture data intentionally mirrors the sample conversation used on the
 * landing page. Do not put real names, handles, photos, or messages here.
 */
(function () {
  "use strict";

  if (window.__ONLYDM_SCREENSHOT_ACTIVE__) {
    return;
  }
  window.__ONLYDM_SCREENSHOT_ACTIVE__ = true;

  // ---------------------------------------------------------------------------
  // Fixtures
  // ---------------------------------------------------------------------------

  const ACCOUNT_HANDLE = "onlydm";
  const ACCOUNT_INITIALS = "OD";

  const CONTACTS = [
    {
      name: "Elena Rostova",
      handle: "elena_rostova",
      initials: "ER",
      from: "#7c5cff",
      to: "#d9468f",
      preview: "Haha love that! Direct messages only i...",
      time: "",
      status: "Active now",
    },
    {
      name: "Marcus Vance",
      handle: "marcus_vance",
      initials: "MV",
      from: "#2563eb",
      to: "#22d3ee",
      preview: "Shared a reel with you",
      time: "22m",
      status: "",
    },
    {
      name: "Sarah Kim",
      handle: "sarah_kim",
      initials: "SK",
      from: "#0f766e",
      to: "#84cc16",
      preview: "Sounds good, see you tomorrow!",
      time: "2h",
      status: "Active now",
    },
    {
      name: "Jordan Miller",
      handle: "jordan_miller",
      initials: "JM",
      from: "#b45309",
      to: "#f59e0b",
      preview: "Reacted ❤️ to your message",
      time: "5h",
      status: "",
    },
    {
      name: "Clara Bennett",
      handle: "clara_bennett",
      initials: "CB",
      from: "#be185d",
      to: "#f472b6",
      preview: "Sent you a design draft",
      time: "1d",
      status: "",
    },
    {
      name: "Noah Williams",
      handle: "noah_williams",
      initials: "NW",
      from: "#0369a1",
      to: "#38bdf8",
      preview: "The new build is live",
      time: "1d",
      status: "",
    },
    {
      name: "Priya Shah",
      handle: "priya_shah",
      initials: "PS",
      from: "#7e22ce",
      to: "#c084fc",
      preview: "Let me know what you think",
      time: "2d",
      status: "",
    },
    {
      name: "Leo Martins",
      handle: "leo_martins",
      initials: "LM",
      from: "#9a3412",
      to: "#fb923c",
      preview: "Thanks for the feedback!",
      time: "3d",
      status: "",
    },
  ];

  const THREAD_CONTACT = CONTACTS[0];

  const MESSAGES = [
    {
      from: "them",
      text: "The moodboard is looking so good.",
    },
    {
      from: "me",
      text: "Just reviewed them — the lighting is unreal 🔥",
    },
    {
      from: "me",
      text: "Using OnlyDM on desktop. Zero feed, zero rabbit holes.",
    },
    {
      from: "them",
      text: "That natural light is everything.",
    },
    {
      from: "them",
      text: "I love that there is no feed to fall into.",
    },
    {
      from: "me",
      text: "Direct messages only is so much calmer.",
    },
    {
      from: "me",
      text: "Count me in for beta testing 🙌",
    },
    {
      from: "me",
      text: "Sending you the link now.",
    },
    {
      from: "them",
      text: "This is exactly what I needed.",
    },
    {
      from: "them",
      text: "Got it — trying it tonight.",
    },
  ];

  // English labels are kept as-is so the screenshot keeps Instagram's UI
  // wording. Unknown labels are blanked rather than guessed at, which is why
  // the UI may be slightly sparser if Instagram is set to another language.
  const UI_LABELS = new Set([
    "Messages",
    "Requests",
    "Active now",
    "Message",
    "Send",
    "Like",
    "Reply",
    "Shared a post",
    "Preview in app",
    "Seen",
    "Delivered",
    "Sent",
    "Sending",
    "Failed",
    "Today",
    "Yesterday",
    "Search",
    "Notes",
    "More",
    "Settings",
    "Profile",
    "Close",
    "Back",
    "Next",
    "Follow",
    "Following",
    "Info",
    "Loading",
    "Retry",
    "New message",
    "Select",
    "Cancel",
    "Done",
    "Message...",
    // Korean UI labels, so a Korean Instagram session keeps its chrome.
    "메시지",
    "요청",
    "지금 활동 중",
    "메시지 보내기",
    "보내기",
    "좋아요",
    "답장",
    "공유한 게시물",
    "앱에서 미리보기",
    "읽음",
    "전송됨",
    "보내는 중",
    "실패",
    "오늘",
    "어제",
    "검색",
    "노트",
    "더 보기",
    "설정",
    "프로필",
    "닫기",
    "뒤로",
    "다음",
    "팔로우",
    "팔로잉",
    "정보",
    "로딩 중",
    "다시 시도",
    "새 메시지",
    "선택",
    "취소",
    "완료",
  ]);

  // ---------------------------------------------------------------------------
  // Generated images
  // ---------------------------------------------------------------------------

  function makeAvatar(initials, from, to) {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">',
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
      '<stop offset="0" stop-color="' + from + '"/>',
      '<stop offset="1" stop-color="' + to + '"/>',
      "</linearGradient></defs>",
      '<rect width="160" height="160" fill="url(#g)"/>',
      '<circle cx="80" cy="62" r="31" fill="rgba(255,255,255,0.16)"/>',
      '<path d="M26 152c5-40 29-58 54-58s49 18 54 58" fill="rgba(255,255,255,0.10)"/>',
      '<text x="80" y="91" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif" font-size="44" font-weight="600" fill="#fff">' +
        initials +
        "</text>",
      "</svg>",
    ].join("");
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  CONTACTS.forEach(function (contact) {
    contact.avatar = makeAvatar(contact.initials, contact.from, contact.to);
  });
  const ACCOUNT_AVATAR = makeAvatar(
    ACCOUNT_INITIALS,
    "#1f2937",
    "#6d28d9"
  );

  const SHARED_POST_IMAGE =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">',
        "<defs>",
        '<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">',
        '<stop offset="0" stop-color="#d9cbb8"/>',
        '<stop offset="1" stop-color="#b9a78f"/>',
        "</linearGradient>",
        '<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">',
        '<stop offset="0" stop-color="#9a7b5f"/>',
        '<stop offset="1" stop-color="#7c614b"/>',
        "</linearGradient>",
        '<linearGradient id="sun" x1="0" y1="0" x2="1" y2="1">',
        '<stop offset="0" stop-color="#fff4d6" stop-opacity="0.75"/>',
        '<stop offset="1" stop-color="#fff4d6" stop-opacity="0"/>',
        "</linearGradient>",
        "</defs>",
        '<rect width="800" height="600" fill="url(#wall)"/>',
        '<rect y="420" width="800" height="180" fill="url(#floor)"/>',
        '<rect x="505" y="55" width="255" height="285" fill="#cfe3e8" stroke="#6a5540" stroke-width="12"/>',
        '<line x1="632" y1="55" x2="632" y2="340" stroke="#6a5540" stroke-width="8"/>',
        '<line x1="505" y1="197" x2="760" y2="197" stroke="#6a5540" stroke-width="8"/>',
        '<polygon points="505,340 760,340 620,600 250,600" fill="url(#sun)"/>',
        '<rect x="120" y="330" width="450" height="115" rx="22" fill="#8c918d"/>',
        '<rect x="135" y="285" width="420" height="80" rx="18" fill="#9da29e"/>',
        '<rect x="155" y="300" width="180" height="58" rx="12" fill="#b0b5b1"/>',
        '<rect x="350" y="300" width="180" height="58" rx="12" fill="#b0b5b1"/>',
        '<rect x="190" y="420" width="330" height="45" rx="14" fill="#b07a4f"/>',
        '<rect x="220" y="465" width="18" height="38" fill="#8a5c39"/>',
        '<rect x="470" y="465" width="18" height="38" fill="#8a5c39"/>',
        '<rect x="300" y="398" width="58" height="22" rx="6" fill="#d9cbb8"/>',
        '<rect x="365" y="398" width="58" height="22" rx="6" fill="#d9cbb8"/>',
        '<ellipse cx="565" cy="505" rx="180" ry="55" fill="#d9cbb8" opacity="0.55"/>',
        '<path d="M700 455c0-55 10-95 30-125" fill="none" stroke="#4f6b45" stroke-width="9"/>',
        '<path d="M720 365c-25-22-45-20-58-6 18 18 38 22 58 6z" fill="#5f8253"/>',
        '<path d="M722 340c-16-28-8-48 8-58 12 18 10 38-8 58z" fill="#6f955f"/>',
        '<path d="M735 390c22-20 40-18 52-5-15 17-33 21-52 5z" fill="#5f8253"/>',
        '<rect x="680" y="450" width="58" height="52" rx="8" fill="#a5673f"/>',
        '<path d="M640 245c60 0 105 40 105 96" fill="none" stroke="#3f342b" stroke-width="8"/>',
        '<path d="M640 245v-40" fill="none" stroke="#3f342b" stroke-width="8"/>',
        '<circle cx="640" cy="200" r="24" fill="#f2d79b" opacity="0.9"/>',
        '<rect x="80" y="120" width="150" height="200" rx="6" fill="#eadfd0" opacity="0.55"/>',
        '<rect x="100" y="145" width="110" height="150" rx="4" fill="#b9a78f" opacity="0.45"/>',
        "</svg>",
      ].join("")
    );

  const SHARED_POST = {
    handle: THREAD_CONTACT.handle,
    caption: "Shared a post · Preview in app",
    image: SHARED_POST_IMAGE,
  };

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------

  const HIDE_CLASS = "__onlydm-screenshot-hide";
  const SHOW_CLASS = "__onlydm-screenshot-show";
  const GUARD_STYLE_ID = "onlydm-screenshot-guard-style";
  const OVERLAY_ID = "onlydm-screenshot-overlay";

  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function isElementVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    var style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    var opacity = parseFloat(style.opacity || "1");
    return !(opacity > 0 && opacity <= 0.01);
  }

  function isTextVisible(node) {
    var el = node && node.parentElement;
    if (!el) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    var style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    var opacity = parseFloat(style.opacity || "1");
    return !(opacity > 0 && opacity <= 0.01);
  }

  function textNodesIn(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || !node.nodeValue.trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        var parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest("script,style,noscript,template,svg")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function setText(node, value) {
    if (!node) return;
    node.nodeValue = value == null ? "" : String(value);
  }

  function isTransparentColor(color) {
    if (!color) return true;
    if (color === "transparent") return true;
    if (color === "rgba(0, 0, 0, 0)") return true;
    return /^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(color);
  }

  function isUiLabel(text) {
    if (!text) return false;
    var value = text.trim();
    if (UI_LABELS.has(value)) return true;
    if (/^Requests\s*\(\d+\)$/i.test(value)) return true;
    if (/^요청\s*\(\d+\)$/.test(value)) return true;
    if (value === SHARED_POST.caption) return true;
    return false;
  }

  function isSafeText(text) {
    if (!text) return true;
    if (/^[\s\d.,:;!?·•—–\-\/()[\]|]+$/.test(text)) return true;
    if (/^[·•]?\s*\d+\s*[smhdw](?:\s+ago)?$/i.test(text)) return true;
    if (/^\d{1,2}:\d{2}\s*(?:AM|PM)?$/i.test(text)) return true;
    if (
      /^(Seen|Delivered|Sent|Sending|Failed)(?:\s+.*)?$/i.test(text) ||
      /^(읽음|전송됨|보내는 중|실패)(?:\s+.*)?$/.test(text)
    ) {
      return true;
    }
    // Emoji / symbols only (no letters or numbers).
    if (/^[^\p{L}\p{N}]+$/u.test(text)) return true;
    return false;
  }

  function setImage(img, src, alt) {
    img.removeAttribute("srcset");
    img.removeAttribute("sizes");
    img.setAttribute("src", src);
    img.setAttribute("alt", alt || "");
    img.removeAttribute("title");
    img.style.objectFit = "cover";
  }

  function findBubble(el) {
    var current = el;
    for (var i = 0; i < 9 && current && current !== document.body; i += 1) {
      var rect = current.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 16) {
        current = current.parentElement;
        continue;
      }
      // Do not climb into the full thread pane or the page shell.
      if (rect.height > Math.min(260, window.innerHeight * 0.35)) break;
      if (rect.width > window.innerWidth * 0.8) break;
      var style = getComputedStyle(current);
      if (
        style.backgroundImage &&
        style.backgroundImage.indexOf("gradient") !== -1
      ) {
        return current;
      }
      if (
        style.backgroundColor &&
        !isTransparentColor(style.backgroundColor)
      ) {
        return current;
      }
      current = current.parentElement;
    }
    return el.parentElement;
  }

  function isInsideMessageBubble(el) {
    var bubble = findBubble(el);
    if (!bubble) return false;
    var rect = bubble.getBoundingClientRect();
    if (rect.width >= window.innerWidth * 0.8) return false;
    var style = getComputedStyle(bubble);
    if (style.backgroundImage && style.backgroundImage !== "none") {
      return true;
    }
    return !isTransparentColor(style.backgroundColor);
  }

  // ---------------------------------------------------------------------------
  // Text-free DOM skeleton (safe to copy and share)
  // ---------------------------------------------------------------------------

  function buildSkeleton(root) {
    // Provided by dom-skeleton-lib.js, which is concatenated before this
    // script in the debug menu action. Returning null is still safe: the
    // verification result remains authoritative, only the diagnostic payload
    // is omitted.
    if (typeof window.__ONLYDM_BUILD_SKELETON__ === "function") {
      return window.__ONLYDM_BUILD_SKELETON__(root);
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Overlay UI
  // ---------------------------------------------------------------------------

  function removeOverlay() {
    var existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();
  }

  function createOverlayShell(kind) {
    removeOverlay();
    var overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("data-kind", kind);
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "display:flex",
      "flex-direction:column",
      "gap:14px",
      "padding:28px",
      "box-sizing:border-box",
      "background:#0b0b0d",
      "color:#f5f5f7",
      "font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "overflow:auto",
      "pointer-events:auto",
    ].join(";");
    document.documentElement.appendChild(overlay);
    return overlay;
  }

  function showLoadingOverlay() {
    var overlay = createOverlayShell("loading");
    var title = document.createElement("div");
    title.textContent = "Preparing demo screenshot…";
    title.style.cssText = "font-size:20px;font-weight:600;letter-spacing:-0.02em";
    var body = document.createElement("div");
    body.textContent =
      "Waiting for the DM inbox to render. The real page is hidden and will stay hidden unless sanitization succeeds.";
    body.style.cssText = "color:#a1a1aa;max-width:720px";
    overlay.appendChild(title);
    overlay.appendChild(body);
    return overlay;
  }

  function showErrorOverlay(reasons, skeleton) {
    var overlay = createOverlayShell("error");
    var title = document.createElement("div");
    title.textContent = "Screenshot sanitization failed";
    title.style.cssText =
      "font-size:20px;font-weight:600;letter-spacing:-0.02em;color:#fecaca";
    overlay.appendChild(title);

    var intro = document.createElement("div");
    intro.textContent =
      "The real page is still hidden, so nothing was captured. Copy the text-free DOM skeleton below and add the missing selector/label, or reload and try another conversation.";
    intro.style.cssText = "color:#a1a1aa;max-width:820px";
    overlay.appendChild(intro);

    var list = document.createElement("pre");
    list.style.cssText =
      "margin:0;padding:14px;border:1px solid #3f1d1d;border-radius:10px;background:#160b0b;color:#fca5a5;white-space:pre-wrap;max-height:220px;overflow:auto";
    list.textContent = (reasons || [])
      .slice(0, 60)
      .map(function (reason, index) {
        return String(index + 1) + ". " + JSON.stringify(reason);
      })
      .join("\n");
    overlay.appendChild(list);

    var actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:10px;flex-wrap:wrap";

    var copy = document.createElement("button");
    copy.textContent = "Copy DOM skeleton";
    copy.style.cssText =
      "appearance:none;border:1px solid #3f3f46;border-radius:8px;background:#18181b;color:#fafafa;padding:9px 14px;font:inherit;cursor:pointer";
    copy.onclick = function () {
      var json = JSON.stringify(skeleton || {}, null, 2);
      navigator.clipboard
        .writeText(json)
        .then(function () {
          copy.textContent = "Copied";
          setTimeout(function () {
            copy.textContent = "Copy DOM skeleton";
          }, 1600);
        })
        .catch(function () {
          copy.textContent = "Copy failed — select the JSON below";
        });
    };
    actions.appendChild(copy);

    var reset = document.createElement("button");
    reset.textContent = "Reload page";
    reset.style.cssText = copy.style.cssText;
    reset.onclick = function () {
      window.location.reload();
    };
    actions.appendChild(reset);
    overlay.appendChild(actions);

    if (skeleton) {
      var pre = document.createElement("pre");
      pre.style.cssText =
        "margin:0;padding:14px;border:1px solid #27272a;border-radius:10px;background:#111113;color:#d4d4d8;white-space:pre;overflow:auto;max-height:52vh;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace";
      pre.textContent = JSON.stringify(skeleton, null, 2);
      overlay.appendChild(pre);
    }
  }

  // ---------------------------------------------------------------------------
  // Preparation
  // ---------------------------------------------------------------------------

  function installGuardStyle() {
    if (document.getElementById(GUARD_STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = GUARD_STYLE_ID;
    style.textContent = [
      "html." + HIDE_CLASS + " body { visibility:hidden !important; pointer-events:none !important; }",
      "html." + HIDE_CLASS + " body * { visibility:hidden !important; }",
      "html." + SHOW_CLASS + " body { visibility:visible !important; background:#000 !important; pointer-events:none !important; }",
      "html." + SHOW_CLASS + " * { animation:none !important; transition:none !important; caret-color:transparent !important; }",
      "html." + SHOW_CLASS + " ::-webkit-scrollbar { width:0 !important; height:0 !important; }",
      "html." + SHOW_CLASS + " * { scrollbar-width:none !important; }",
      ".__onlydm-scrub-pseudo-bg::before, .__onlydm-scrub-pseudo-bg::after { background-image:none !important; content:none !important; }",
    ].join("\n");
    (document.head || document.documentElement).appendChild(style);
  }

  function findConversationRows(scope, requireVisible) {
    return Array.prototype.slice
      .call(
        (scope || document).querySelectorAll(
          'a[href^="/direct/t/"], div[role="button"]'
        )
      )
      .filter(function (row) {
        if (requireVisible && !isElementVisible(row)) return false;
        var rect = row.getBoundingClientRect();
        return (
          rect.width >= 200 &&
          rect.height >= 56 &&
          rect.height <= 90 &&
          !!row.querySelector("img")
        );
      });
  }

  async function waitForInbox(timeoutMs) {
    var deadline = Date.now() + (timeoutMs || 20000);
    while (Date.now() < deadline) {
      var nav = document.querySelector('[role="navigation"]');
      // The page is deliberately hidden at this point, so geometry is used
      // instead of computed visibility for the readiness check.
      var rows = findConversationRows(nav || document, false);
      var composer = Array.prototype.slice
        .call(
          document.querySelectorAll(
            'textarea, [contenteditable="true"], [role="textbox"]'
          )
        )
        .some(function (el) {
          var rect = el.getBoundingClientRect();
          return (
            rect.left > window.innerWidth * 0.3 &&
            rect.top > window.innerHeight * 0.45
          );
        });
      if (rows.length > 0 && composer) return;
      await wait(250);
    }
    throw new Error(
      "DM inbox was not ready. Open a conversation first, then try again."
    );
  }

  function removeDangerousNodes(clone) {
    var selector = [
      "script",
      "iframe",
      "object",
      "embed",
      "audio",
      "video",
      "source",
      "track",
      'link[rel="preload"]',
      'link[rel="prefetch"]',
      'link[rel="modulepreload"]',
    ].join(",");
    clone.querySelectorAll(selector).forEach(function (el) {
      el.remove();
    });

    // Canvas can contain a live video frame or user content. The clone is not
    // attached yet, so geometry is unavailable; hide every canvas.
    clone.querySelectorAll("canvas").forEach(function (canvas) {
      canvas.style.visibility = "hidden";
    });

    // Inline event handlers are not needed in a static capture.
    [clone].concat(Array.prototype.slice.call(clone.querySelectorAll("*"))).forEach(
      function (el) {
        Array.prototype.slice.call(el.attributes).forEach(function (attr) {
          if (attr.name.toLowerCase().indexOf("on") === 0) {
            el.removeAttribute(attr.name);
          }
        });
      }
    );
  }

  function replaceBody(clone) {
    var oldBody = document.body;
    document.documentElement.replaceChild(clone, oldBody);
    // Drop the original subtree so React never re-renders real content into it.
    try {
      oldBody.replaceChildren();
    } catch (_) {}
  }

  function scrubAttributes(root) {
    var elements = [root].concat(
      Array.prototype.slice.call(root.querySelectorAll("*"))
    );
    elements.forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (attr) {
        var name = attr.name.toLowerCase();
        var value = attr.value;

        if (name.indexOf("on") === 0) {
          el.removeAttribute(attr.name);
          return;
        }
        if (
          name === "srcset" ||
          name === "sizes" ||
          name === "poster" ||
          name === "data-src" ||
          name === "data-srcset" ||
          name === "data-url"
        ) {
          el.removeAttribute(attr.name);
          return;
        }
        if (name === "alt" || name === "title" || name === "aria-label" || name === "placeholder") {
          el.removeAttribute(attr.name);
          return;
        }
        if (name === "value") {
          el.setAttribute("value", "");
          return;
        }
        if (
          (name.indexOf("data-") === 0 || name === "content") &&
          (value.indexOf("http://") !== -1 || value.indexOf("https://") !== -1)
        ) {
          el.removeAttribute(attr.name);
        }
      });

      var styleAttr = el.getAttribute("style");
      if (styleAttr && /https?:\/\//i.test(styleAttr)) {
        [
          "background",
          "backgroundImage",
          "maskImage",
          "webkitMaskImage",
          "borderImageSource",
          "listStyleImage",
          "cursor",
        ].forEach(function (prop) {
          try {
            if (String(el.style[prop] || "").indexOf("http") !== -1) {
              el.style[prop] = "none";
            }
          } catch (_) {}
        });
        if (/https?:\/\//i.test(el.getAttribute("style") || "")) {
          el.removeAttribute("style");
        }
      }
    });

    // Remote raster images can also be embedded inside inline <svg>.
    Array.prototype.slice.call(root.querySelectorAll("image")).forEach(function (image) {
      ["href", "xlink:href"].forEach(function (attr) {
        var value = image.getAttribute(attr) || "";
        if (/^https?:/i.test(value)) image.removeAttribute(attr);
      });
    });
  }

  function replaceSidebarRows(root) {
    var nav = root.querySelector('[role="navigation"]');
    var scope = nav || root;

    // Instagram currently renders each inbox row as a div[role="button"].
    // Older builds used an anchor, so both shapes are accepted.
    var rows = findConversationRows(scope, true);

    rows.sort(function (a, b) {
      return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
    });

    var navRect = nav ? nav.getBoundingClientRect() : null;
    var sidebarRight = navRect
      ? navRect.right + 2
      : rows.length
      ? Math.max.apply(
          null,
          rows.map(function (row) {
            return row.getBoundingClientRect().right;
          })
        ) + 2
      : window.innerWidth * 0.35;

    var activeRow =
      rows.find(function (row) {
        var background = getComputedStyle(row).backgroundColor;
        return !isTransparentColor(background);
      }) || rows[0];

    var otherContacts = CONTACTS.filter(function (contact) {
      return contact !== THREAD_CONTACT;
    });
    var rowContacts = new Map();
    var rowTextNodes = new Set();

    // Map the selected row to the thread contact so the highlight and the
    // thread header show the same person.
    var ordered = activeRow
      ? [activeRow].concat(
          rows.filter(function (row) {
            return row !== activeRow;
          })
        )
      : rows;

    ordered.forEach(function (row, index) {
      var contact =
        index === 0
          ? THREAD_CONTACT
          : otherContacts[(index - 1) % otherContacts.length];
      rowContacts.set(row, contact);

      var texts = textNodesIn(row)
        .filter(isTextVisible)
        .filter(function (node) {
          var rect = node.parentElement.getBoundingClientRect();
          // Drop 1x1 accessibility separators; keep the real visible
          // preview/time text nodes so they can be cleared.
          return rect.width > 2 && rect.height > 2;
        });

      texts.forEach(function (node) {
        rowTextNodes.add(node);
      });

      if (!texts.length) return;

      // The first text node is the display name, the second is the preview.
      // Instagram's timestamp can be an inline abbr/span after that.
      setText(texts[0], contact.name);
      if (texts.length > 1) {
        var preview = contact.preview;
        if (contact.time) preview += " · " + contact.time;
        setText(texts[1], preview);
        for (var i = 2; i < texts.length; i += 1) {
          setText(texts[i], "");
        }
      } else if (contact.time) {
        setText(texts[0], contact.name + " · " + contact.time);
      }
    });

    return {
      rowContacts: rowContacts,
      sidebarRight: sidebarRight,
      rowTextNodes: rowTextNodes,
    };
  }

  function replaceSidebarChrome(root, sidebarRight, rowTextNodes) {
    rowTextNodes = rowTextNodes || new Set();
    var nav = root.querySelector('[role="navigation"]');
    var scope = nav || root;
    var texts = textNodesIn(scope).filter(isTextVisible);
    var messagesLabel = texts.find(function (node) {
      return (
        /^Messages$/i.test((node.nodeValue || "").trim()) ||
        /^메시지$/.test((node.nodeValue || "").trim())
      );
    });
    var messagesTop = messagesLabel
      ? messagesLabel.parentElement.getBoundingClientRect().top
      : 100;

    var topTexts = texts.filter(function (node) {
      if (rowTextNodes.has(node)) return false;
      if (!isTextVisible(node)) return false;
      if (node.parentElement.closest('a[href^="/direct/t/"]')) return false;
      var rect = node.parentElement.getBoundingClientRect();
      if (rect.right > sidebarRight) return false;
      return rect.bottom <= messagesTop + 2;
    });

    if (topTexts.length) {
      setText(topTexts[0], ACCOUNT_HANDLE);
      for (var i = 1; i < topTexts.length; i += 1) {
        setText(topTexts[i], "");
      }
    }

    // Keep known UI labels, blank the rest. Unknown sidebar text is more
    // likely to be a name, handle, or notification than useful chrome.
    texts.forEach(function (node) {
      if (rowTextNodes.has(node)) return;
      var rect = node.parentElement.getBoundingClientRect();
      if (rect.right > sidebarRight) return;
      if (node.parentElement.closest('a[href^="/direct/t/"]')) return;
      var text = (node.nodeValue || "").trim();
      if (!text) return;
      if (text === ACCOUNT_HANDLE) return;
      if (isUiLabel(text) || isSafeText(text)) return;
      setText(node, "");
    });

    // The search field's placeholder is an attribute, not a text node, and
    // scrubAttributes deliberately removed it. Restore a generic label.
    Array.prototype.slice
      .call(scope.querySelectorAll("input"))
      .filter(isElementVisible)
      .forEach(function (input) {
        var rect = input.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 20 && rect.top < 220) {
          input.setAttribute("placeholder", "Search");
        }
      });
  }

  function hideHoverActionGroups(root) {
    // Instagram renders per-message hover actions (react/reply/more) in the
    // DOM at all times. They are not part of the hero screenshot.
    Array.prototype.slice
      .call(root.querySelectorAll('div[role="group"]'))
      .forEach(function (group) {
        var rect = group.getBoundingClientRect();
        if (rect.width > 160 || rect.height > 44) return;
        var buttons = group.querySelectorAll(
          'div[role="button"], button'
        );
        if (buttons.length < 2) return;
        if ((group.innerText || "").trim()) return;
        group.style.display = "none";
      });
  }

  function hideCustomScrollbars(root, sidebarRight) {
    Array.prototype.slice
      .call(root.querySelectorAll("div"))
      .forEach(function (el) {
        var rect = el.getBoundingClientRect();
        if (rect.width < 8 || rect.width > 20 || rect.height < 300) return;
        if ((el.innerText || "").trim()) return;
        if (el.querySelector("img, canvas")) return;
        var nearDivider =
          rect.left > sidebarRight - 24 && rect.left < sidebarRight + 30;
        var nearRightEdge = rect.right > window.innerWidth - 30;
        if (!nearDivider && !nearRightEdge) return;
        el.style.display = "none";
      });
  }

  function findThreadScroller(root, sidebarRight) {
    var candidates = Array.prototype.slice
      .call(root.querySelectorAll("div"))
      .filter(function (el) {
        var style = getComputedStyle(el);
        var rect = el.getBoundingClientRect();
        return (
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          rect.width > (window.innerWidth - sidebarRight) * 0.5 &&
          rect.height > 200 &&
          el.scrollHeight > el.clientHeight
        );
      });

    candidates.sort(function (a, b) {
      return b.scrollHeight - a.scrollHeight;
    });
    if (candidates.length) return candidates[0];

    // Fallback: walk up from a message article to its scrollable ancestor.
    var current = root.querySelector('[role="article"]');
    while (current && current !== root) {
      var style = getComputedStyle(current);
      var rect = current.getBoundingClientRect();
      if (
        (style.overflowY === "auto" || style.overflowY === "scroll") &&
        rect.width > (window.innerWidth - sidebarRight) * 0.5 &&
        current.scrollHeight > current.clientHeight
      ) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function replaceThread(root, sidebarRight) {
    var contact = THREAD_CONTACT;

    // Find the composer before mapping messages. Its top edge is a much more
    // reliable separator than a fixed offset from the bottom of the window.
    var composer = Array.prototype.slice
      .call(
        root.querySelectorAll(
          'textarea, input[type="text"], [contenteditable="true"], [role="textbox"]'
        )
      )
      .filter(isElementVisible)
      .filter(function (el) {
        var rect = el.getBoundingClientRect();
        return rect.left > sidebarRight && rect.top > window.innerHeight * 0.45;
      })[0];
    var composerTop = composer
      ? composer.getBoundingClientRect().top - 12
      : window.innerHeight - 150;

    var composerContainer = composer;
    if (composer) {
      // Walk up to the composer row (but never up to the thread pane), so a
      // separate placeholder text node next to the editable element is
      // included.
      var composerParent = composer.parentElement;
      for (
        var composerDepth = 0;
        composerDepth < 3 && composerParent && composerParent !== root;
        composerDepth += 1
      ) {
        var composerParentRect = composerParent.getBoundingClientRect();
        if (
          composerParentRect.height <= 120 &&
          composerParentRect.width > 100
        ) {
          composerContainer = composerParent;
        }
        composerParent = composerParent.parentElement;
      }
    }

    var texts = textNodesIn(root).filter(isTextVisible);

    var threadTexts = texts.filter(function (node) {
      var rect = node.parentElement.getBoundingClientRect();
      return rect.left > sidebarRight - 2;
    });

    // The shared-post preview can sit close to the header. Find it first so
    // its username is not mistaken for the thread header.
    var sharedLink = root.querySelector(
      'a[href^="/p/"], a[href^="/reel/"], a[href^="/tv/"]'
    );
    var sharedLinkVisible = sharedLink && isElementVisible(sharedLink);
    var handled = new Set();

    var headerTexts = threadTexts.filter(function (node) {
      if (sharedLinkVisible && sharedLink.contains(node.parentElement)) {
        return false;
      }
      var rect = node.parentElement.getBoundingClientRect();
      // Keep this tight: the first message can be clipped right under a
      // 84-100px thread header, and it must not be mistaken for the name.
      return rect.top >= 0 && rect.top < 92 && rect.bottom < 115;
    });

    // Header: first compact text is the contact name, the next is the
    // status. Full-width text at the same y is a system banner (for example
    // "You're friends on Instagram") and is hidden.
    var threadWidth = window.innerWidth - sidebarRight;
    var headerCandidates = headerTexts.filter(function (node) {
      var text = (node.nodeValue || "").trim();
      return text && !isUiLabel(text) && !isSafeText(text);
    });
    var headerCompact = headerCandidates.filter(function (node) {
      return node.parentElement.getBoundingClientRect().width <= threadWidth * 0.5;
    });
    var headerWide = headerCandidates.filter(function (node) {
      return node.parentElement.getBoundingClientRect().width > threadWidth * 0.5;
    });

    if (headerCompact.length) {
      setText(headerCompact[0], contact.name);
      handled.add(headerCompact[0]);
      if (headerCompact.length > 1) {
        setText(headerCompact[1], contact.status || "");
        handled.add(headerCompact[1]);
      }
      for (var h = 2; h < headerCompact.length; h += 1) {
        setText(headerCompact[h], "");
        handled.add(headerCompact[h]);
      }
    }
    headerWide.forEach(function (node) {
      node.parentElement.style.display = "none";
      handled.add(node);
    });

    var headerBottom = 64;
    if (headerCompact.length) {
      headerBottom =
        Math.max.apply(
          null,
          headerCompact.map(function (node) {
            return node.parentElement.getBoundingClientRect().bottom;
          })
        ) + 6;
    }
    var threadTop = headerBottom;

    // Shared post preview.
    if (sharedLinkVisible) {
      var sharedTexts = textNodesIn(sharedLink).filter(isTextVisible);
      var firstName = true;
      sharedTexts.forEach(function (node) {
        var text = (node.nodeValue || "").trim();
        if (isUiLabel(text) || isSafeText(text)) return;
        if (firstName) {
          setText(node, contact.handle);
          firstName = false;
        } else {
          setText(node, SHARED_POST.caption);
        }
        handled.add(node);
      });

      Array.prototype.slice
        .call(sharedLink.querySelectorAll("img"))
        .filter(isElementVisible)
        .forEach(function (img) {
          var rect = img.getBoundingClientRect();
          if (rect.width <= 80 && rect.height <= 80) {
            setImage(img, contact.avatar, contact.name);
          } else {
            setImage(img, SHARED_POST.image, "Shared post");
          }
        });
    }

    // Instagram puts full-width date separators between message days. They
    // are not messages; replace them with neutral labels so they cannot carry
    // a real timestamp.
    var dateLabels = threadTexts
      .filter(function (node) {
        if (handled.has(node)) return false;
        if (sharedLinkVisible && sharedLink.contains(node.parentElement)) {
          return false;
        }
        if (composerContainer && composerContainer.contains(node.parentElement)) {
          return false;
        }
        var rect = node.parentElement.getBoundingClientRect();
        if (rect.top < threadTop || rect.top >= composerTop) return false;
        if (rect.height > 44) return false;
        if (rect.width < (window.innerWidth - sidebarRight) * 0.5) {
          return false;
        }
        var text = (node.nodeValue || "").trim();
        if (!text || isUiLabel(text) || isSafeText(text)) return false;
        return true;
      })
      .sort(function (a, b) {
        return (
          a.parentElement.getBoundingClientRect().top -
          b.parentElement.getBoundingClientRect().top
        );
      });

    dateLabels.forEach(function (node) {
      setText(node, "Today");
      handled.add(node);
    });

    // Remaining thread text, grouped by message bubble. Geometry is not used
    // here: the thread may be scrolled, and replacing short messages with
    // longer fixtures shifts later bubbles. If it is inside a colored bubble,
    // it is a message and must be replaced.
    var candidates = threadTexts.filter(function (node) {
      if (handled.has(node)) return false;
      if (composerContainer && composerContainer.contains(node.parentElement)) {
        return false;
      }
      if (sharedLinkVisible && sharedLink.contains(node.parentElement)) {
        return false;
      }
      if (!isInsideMessageBubble(node.parentElement)) return false;
      var text = (node.nodeValue || "").trim();
      if (isUiLabel(text)) return false;
      return true;
    });

    var groups = new Map();
    candidates.forEach(function (node) {
      var bubble = findBubble(node.parentElement);
      if (!bubble) return;
      if (
        sharedLinkVisible &&
        (bubble === sharedLink ||
          bubble.contains(sharedLink) ||
          sharedLink.contains(bubble))
      ) {
        return;
      }
      if (!groups.has(bubble)) groups.set(bubble, []);
      groups.get(bubble).push(node);
    });

    // Capture geometry before changing any text. Replacing a short message
    // with a longer fixture grows the thread and shifts later groups down;
    // using live rects here used to skip those later groups as "below the
    // composer" and leave their real text to be blanked.
    var sortedGroups = Array.from(groups.entries())
      .map(function (entry) {
        return {
          bubble: entry[0],
          nodes: entry[1],
          rect: entry[0].getBoundingClientRect(),
        };
      })
      .sort(function (a, b) {
        return a.rect.top - b.rect.top;
      });

    var counters = { me: 0, them: 0 };
    var threadCenter = (sidebarRight + window.innerWidth) / 2;
    sortedGroups.forEach(function (entry) {
      var bubbleRect = entry.rect;
      var nodes = entry.nodes;
      var from =
        bubbleRect.left + bubbleRect.width / 2 > threadCenter
          ? "me"
          : "them";
      var list = MESSAGES.filter(function (message) {
        return message.from === from;
      });
      if (!list.length) {
        nodes.forEach(function (node) {
          setText(node, "");
        });
        return;
      }
      var fixture = list[counters[from] % list.length];
      counters[from] += 1;

      setText(nodes[0], fixture.text);
      for (var i = 1; i < nodes.length; i += 1) {
        setText(nodes[i], "");
      }
    });

    // Composer.
    if (composer) {
      if (
        composer instanceof HTMLTextAreaElement ||
        composer instanceof HTMLInputElement
      ) {
        composer.value = "";
        composer.setAttribute("placeholder", "Message " + contact.name + "...");
        composer.removeAttribute("aria-label");
      } else {
        composer.setAttribute("contenteditable", "false");
        composer.setAttribute("aria-label", "Message " + contact.name + "...");
        composer.setAttribute("data-placeholder", "Message " + contact.name + "...");
      }
    }

    var composerTexts = composerContainer
      ? textNodesIn(composerContainer).filter(isTextVisible)
      : [];
    composerTexts.forEach(function (node, index) {
      setText(
        node,
        index === 0 ? "Message " + contact.name + "..." : ""
      );
      handled.add(node);
    });

    return {
      contact: contact,
      composerTop: composerTop,
    };
  }

  function replaceImages(root, context) {
    var contact = context.contact;
    var rowContacts = context.rowContacts;
    var sidebarRight = context.sidebarRight;
    var composerTop = context.composerTop;

    Array.prototype.slice
      .call(root.querySelectorAll("img"))
      .filter(isElementVisible)
      .forEach(function (img) {
        var rect = img.getBoundingClientRect();
        var row = img.closest(
          'a[href^="/direct/t/"], div[role="button"]'
        );
        if (row && !rowContacts.has(row)) {
          // A nested avatar/story button is not the inbox row.
          row = row.parentElement
            ? row.parentElement.closest(
                'a[href^="/direct/t/"], div[role="button"]'
              )
            : null;
        }
        if (row && !rowContacts.has(row)) row = null;
        var shared = img.closest(
          'a[href^="/p/"], a[href^="/reel/"], a[href^="/tv/"]'
        );
        var inChrome =
          rect.top >= composerTop ||
          (rect.top < 110 && rect.left > sidebarRight);
        var avatar = contact.avatar;
        var alt = contact.name;

        // Small <img> elements in the header/composer are UI icons. Leaving
        // them alone keeps the send/emoji/info buttons looking right; they do
        // not contain personal data.
        if (
          inChrome &&
          !row &&
          !shared &&
          rect.width <= 24 &&
          rect.height <= 24
        ) {
          img.setAttribute("alt", "");
          img.removeAttribute("title");
          return;
        }

        if (row && rowContacts.has(row)) {
          var rowContact = rowContacts.get(row);
          avatar = rowContact.avatar;
          alt = rowContact.name;
        } else if (rect.width > 160 || rect.height > 160) {
          avatar = SHARED_POST.image;
          alt = "Shared post";
        } else if (shared) {
          avatar =
            rect.width <= 80 && rect.height <= 80
              ? contact.avatar
              : SHARED_POST.image;
          alt = rect.width <= 80 && rect.height <= 80 ? contact.name : "Shared post";
        } else if (rect.top < 110 && rect.left < sidebarRight) {
          avatar = ACCOUNT_AVATAR;
          alt = "OnlyDM demo";
        }

        setImage(img, avatar, alt);
      });

    // CSS background images can also hold profile photos or post previews.
    var elements = Array.prototype.slice
      .call(root.querySelectorAll("*"))
      .filter(isElementVisible);
    elements.forEach(function (el) {
      var style = getComputedStyle(el);
      var bg = style.backgroundImage || "";
      if (bg.indexOf("http") === -1) return;
      var rect = el.getBoundingClientRect();
      if (rect.width <= 24 && rect.height <= 24) return;
      var src =
        rect.width > 160 || rect.height > 160
          ? SHARED_POST.image
          : contact.avatar;
      el.style.backgroundImage = 'url("' + src + '")';
      el.style.backgroundSize = "cover";
      el.style.backgroundPosition = "center";
    });

    // Pseudo-element backgrounds/content cannot be edited directly. Disable
    // them on any element that still references a remote resource.
    elements.forEach(function (el) {
      ["::before", "::after"].forEach(function (pseudo) {
        var style = getComputedStyle(el, pseudo);
        if (
          (style.backgroundImage && style.backgroundImage.indexOf("http") !== -1) ||
          (style.content && style.content.indexOf("http") !== -1)
        ) {
          el.classList.add("__onlydm-scrub-pseudo-bg");
        }
      });
    });
  }

  function blankUnknownText(root, context) {
    var allowed = allowedTextSet(context.contact);
    var texts = textNodesIn(root).filter(isTextVisible);
    texts.forEach(function (node) {
      var text = (node.nodeValue || "").trim();
      if (!text) return;
      if (allowed.has(text) || isUiLabel(text) || isSafeText(text)) return;
      setText(node, "");
    });
  }

  function allowedTextSet(contact) {
    var set = new Set();
    set.add(ACCOUNT_HANDLE);
    set.add(SHARED_POST.handle);
    set.add(SHARED_POST.caption);
    set.add("Message " + contact.name + "...");
    CONTACTS.forEach(function (item) {
      [item.name, item.handle, item.preview, item.time, item.status].forEach(
        function (value) {
          if (value) set.add(value);
        }
      );
      if (item.preview) {
        set.add(item.preview);
        if (item.time) set.add(item.preview + " · " + item.time);
      }
    });
    MESSAGES.forEach(function (message) {
      set.add(message.text);
    });
    return set;
  }

  function verify(root, contact) {
    var reasons = [];
    var allowed = allowedTextSet(contact);
    var texts = textNodesIn(root).filter(isTextVisible);

    texts.forEach(function (node) {
      var text = (node.nodeValue || "").trim();
      if (!text) return;
      if (allowed.has(text) || isUiLabel(text) || isSafeText(text)) return;
      var el = node.parentElement;
      var rect = el.getBoundingClientRect();
      reasons.push({
        type: "text",
        tag: el.tagName.toLowerCase(),
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        length: text.length,
        cls:
          (el.getAttribute("class") || "")
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .join(" ") || undefined,
      });
    });

    Array.prototype.slice
      .call(root.querySelectorAll("img"))
      .filter(isElementVisible)
      .forEach(function (img) {
        var src = img.getAttribute("src") || "";
        if (src.indexOf("data:") === 0 || src.indexOf("blob:") === 0) return;
        var rect = img.getBoundingClientRect();
        reasons.push({
          type: "image",
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      });

    Array.prototype.slice
      .call(root.querySelectorAll("*"))
      .filter(isElementVisible)
      .forEach(function (el) {
        var bg = getComputedStyle(el).backgroundImage || "";
        if (bg.indexOf("http") !== -1) {
          var rect = el.getBoundingClientRect();
          reasons.push({
            type: "background",
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }
        ["::before", "::after"].forEach(function (pseudo) {
          var style = getComputedStyle(el, pseudo);
          if (
            (style.backgroundImage && style.backgroundImage.indexOf("http") !== -1) ||
            (style.content && style.content.indexOf("http") !== -1)
          ) {
            var pseudoRect = el.getBoundingClientRect();
            reasons.push({
              type: "pseudo",
              pseudo: pseudo,
              x: Math.round(pseudoRect.x),
              y: Math.round(pseudoRect.y),
              width: Math.round(pseudoRect.width),
              height: Math.round(pseudoRect.height),
            });
          }
        });
      });

    Array.prototype.slice
      .call(root.querySelectorAll("image"))
      .forEach(function (image) {
        ["href", "xlink:href"].forEach(function (attr) {
          var value = image.getAttribute(attr) || "";
          if (/^https?:/i.test(value)) {
            reasons.push({ type: "svg-image", attr: attr });
          }
        });
      });

    Array.prototype.slice
      .call(root.querySelectorAll("a[href]"))
      .forEach(function (a) {
        var href = a.getAttribute("href") || "";
        if (href !== "#" && href.charAt(0) !== "#") {
          reasons.push({ type: "href", tag: "a" });
        }
      });

    Array.prototype.slice
      .call(root.querySelectorAll("input, textarea"))
      .forEach(function (input) {
        if (input.value && input.value.trim()) {
          reasons.push({ type: "input-value", tag: input.tagName.toLowerCase() });
        }
      });

    if (document.title !== "OnlyDM") {
      reasons.push({ type: "document-title" });
    }

    return reasons;
  }

  function neutralizeLinks(root) {
    Array.prototype.slice
      .call(root.querySelectorAll("a[href]"))
      .forEach(function (a) {
        a.setAttribute("href", "#");
      });
  }

  function addCaptureMarkers() {
    ["top", "bottom"].forEach(function (position) {
      var marker = document.createElement("div");
      marker.setAttribute("data-onlydm-screenshot-marker", position);
      marker.style.cssText = [
        "position:fixed",
        position + ":0",
        "left:0",
        "right:0",
        "height:2px",
        "background:#00ff00",
        "z-index:2147483647",
        "pointer-events:none",
      ].join(";");
      document.documentElement.appendChild(marker);
    });
  }

  async function prepare() {
    if (window.__ONLYDM_SCREENSHOT_READY__) {
      return;
    }

    installGuardStyle();
    document.documentElement.classList.add(HIDE_CLASS);
    showLoadingOverlay();

    try {
      await waitForInbox(20000);

      var clone = document.body.cloneNode(true);
      removeDangerousNodes(clone);
      replaceBody(clone);

      // Measurements require a laid-out, visible tree. The opaque loading
      // overlay still covers the entire viewport, so revealing the clone here
      // cannot expose the real page. If anything below throws, the catch block
      // hides the body again before showing the error overlay.
      document.documentElement.classList.remove(HIDE_CLASS);

      // From this point on, document.body is a static clone. React no longer
      // owns it, so real data cannot be re-rendered back into the page.
      var root = document.body;
      scrubAttributes(root);

      var sidebar = replaceSidebarRows(root);
      replaceSidebarChrome(
        root,
        sidebar.sidebarRight,
        sidebar.rowTextNodes
      );
      var thread = replaceThread(root, sidebar.sidebarRight);
      replaceImages(root, {
        contact: thread.contact,
        composerTop: thread.composerTop,
        sidebarRight: sidebar.sidebarRight,
        rowContacts: sidebar.rowContacts,
      });
      blankUnknownText(root, thread);
      hideHoverActionGroups(root);
      hideCustomScrollbars(root, sidebar.sidebarRight);

      var scroller = findThreadScroller(root, sidebar.sidebarRight);
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight;
      }

      neutralizeLinks(root);

      document.title = "OnlyDM";

      var skeleton = buildSkeleton(root);
      var reasons = verify(root, thread.contact);

      if (reasons.length) {
        document.documentElement.classList.add(HIDE_CLASS);
        showErrorOverlay(reasons, skeleton);
        console.warn("[OnlyDM] Screenshot sanitization failed", reasons);
        return;
      }

      document.documentElement.classList.add(SHOW_CLASS);
      addCaptureMarkers();
      removeOverlay();
      window.__ONLYDM_SCREENSHOT_READY__ = true;
      console.info("[OnlyDM] Demo screenshot ready");
    } catch (error) {
      var message =
        error && error.message ? error.message : "Unknown screenshot error";
      console.error("[OnlyDM] Screenshot preparation failed", error);
      // Hide the body before removing the opaque loading overlay. The error
      // overlay is a child of <html>, not <body>, so it stays visible.
      document.documentElement.classList.add(HIDE_CLASS);
      showErrorOverlay([{ type: "exception", message: message }], null);
    }
  }

  prepare();
})();
