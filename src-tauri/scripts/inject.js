(function () {
  "use strict";

  // Run only once in the top-level window (never inside sub-iframes or duplicate evals)
  if (window !== window.top || window.__IG_DM_INITIALIZED__) {
    return;
  }
  window.__IG_DM_INITIALIZED__ = true;

  // If Instagram redirects to the home feed `/` after logging in, immediately
  // redirect back to `/direct/inbox/` so the app always stays on DM.
  if (window.location.pathname === "/") {
    window.location.replace("https://www.instagram.com/direct/inbox/");
    return;
  }

  const STYLE_ID = "ig-dm-desktop-custom-css";
  const LOGOUT_BTN_ID = "ig-dm-logout-btn";
  const LOGOUT_MODAL_ID = "ig-dm-logout-modal-backdrop";
  const ACCOUNT_LOCK_ATTR = "data-ig-dm-account-locked";

  // Block Instagram's incoming-call ringtone without affecting voice messages or
  // other media. The call modal uses an autoplaying, looping <audio> element.
  try {
    const originalMediaPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.tagName === "AUDIO" && this.autoplay && this.loop) {
        try {
          this.muted = true;
        } catch (_) {}
        return Promise.resolve();
      }
      return originalMediaPlay.apply(this, arguments);
    };
  } catch (_) {}

  // Cache mapping profile image `src` -> conversation partner display name
  const avatarNameCache = new Map();

  // Localized strings for the Logout button & confirmation modal based on Instagram/browser language
  const LOGOUT_I18N = {
    ko: {
      tooltip: "로그아웃",
      title: "로그아웃 하시겠습니까?",
      desc: "현재 인스타그램 계정에서 로그아웃합니다.",
      confirm: "로그아웃",
      loggingOut: "로그아웃 중...",
      cancel: "취소",
    },
    en: {
      tooltip: "Log out",
      title: "Log out of Instagram?",
      desc: "You will be logged out of your current Instagram account.",
      confirm: "Log out",
      loggingOut: "Logging out...",
      cancel: "Cancel",
    },
    ja: {
      tooltip: "ログアウト",
      title: "Instagramからログアウトしますか？",
      desc: "現在のInstagramアカウントからログアウトします。",
      confirm: "ログアウト",
      loggingOut: "ログアウト中...",
      cancel: "キャンセル",
    },
    zh: {
      tooltip: "退出登录",
      title: "要退出 Instagram 吗？",
      desc: "你将退出当前登录的 Instagram 账户。",
      confirm: "退出登录",
      loggingOut: "正在退出...",
      cancel: "取消",
    },
    "zh-tw": {
      tooltip: "登出",
      title: "要登出 Instagram 嗎？",
      desc: "你將會登出目前的 Instagram 帳號。",
      confirm: "登出",
      loggingOut: "正在登出...",
      cancel: "取消",
    },
    "zh-hk": {
      tooltip: "登出",
      title: "要登出 Instagram 嗎？",
      desc: "你將會登出目前的 Instagram 帳戶。",
      confirm: "登出",
      loggingOut: "正在登出...",
      cancel: "取消",
    },
    es: {
      tooltip: "Salir",
      title: "¿Salir de Instagram?",
      desc: "Se cerrará la sesión de tu cuenta actual de Instagram.",
      confirm: "Salir",
      loggingOut: "Saliendo...",
      cancel: "Cancelar",
    },
    fr: {
      tooltip: "Se déconnecter",
      title: "Se déconnecter d’Instagram ?",
      desc: "Vous serez déconnecté(e) de votre compte Instagram actuel.",
      confirm: "Se déconnecter",
      loggingOut: "Déconnexion...",
      cancel: "Annuler",
    },
    de: {
      tooltip: "Abmelden",
      title: "Bei Instagram abmelden?",
      desc: "Du wirst von deinem aktuellen Instagram-Konto abgemeldet.",
      confirm: "Abmelden",
      loggingOut: "Abmeldung läuft...",
      cancel: "Abbrechen",
    },
    pt: {
      tooltip: "Sair",
      title: "Sair do Instagram?",
      desc: "Você sairá da sua conta atual do Instagram.",
      confirm: "Sair",
      loggingOut: "Saindo...",
      cancel: "Cancelar",
    },
    it: {
      tooltip: "Esci",
      title: "Uscire da Instagram?",
      desc: "Uscirai dal tuo account Instagram attuale.",
      confirm: "Esci",
      loggingOut: "Uscita in corso...",
      cancel: "Annulla",
    },
    ru: {
      tooltip: "Выйти",
      title: "Выйти из Instagram?",
      desc: "Вы выйдете из своего текущего аккаунта Instagram.",
      confirm: "Выйти",
      loggingOut: "Выход...",
      cancel: "Отмена",
    },
    vi: {
      tooltip: "Đăng xuất",
      title: "Đăng xuất khỏi Instagram?",
      desc: "Bạn sẽ đăng xuất khỏi tài khoản Instagram hiện tại.",
      confirm: "Đăng xuất",
      loggingOut: "Đang đăng xuất...",
      cancel: "Hủy",
    },
    th: {
      tooltip: "ออกจากระบบ",
      title: "ออกจากระบบ Instagram ใช่ไหม?",
      desc: "คุณจะออกจากระบบบัญชี Instagram ปัจจุบันของคุณ",
      confirm: "ออกจากระบบ",
      loggingOut: "กำลังออกจากระบบ...",
      cancel: "ยกเลิก",
    },
    id: {
      tooltip: "Keluar",
      title: "Keluar dari Instagram?",
      desc: "Anda akan keluar dari akun Instagram saat ini.",
      confirm: "Keluar",
      loggingOut: "Keluar...",
      cancel: "Batal",
    },
    tr: {
      tooltip: "Çıkış Yap",
      title: "Instagram'dan çıkış yapılsın mı?",
      desc: "Mevcut Instagram hesabınızdan çıkış yapacaksınız.",
      confirm: "Çıkış Yap",
      loggingOut: "Çıkış yapılıyor...",
      cancel: "İptal",
    },
  };

  /**
   * Resolves the localized Logout string bundle matching Instagram's `<html lang="...">`
   * attribute (user's Instagram language setting) with fallback to `navigator.language`.
   */
  function getLogoutStrings() {
    const rawLang = (
      (document.documentElement && document.documentElement.getAttribute("lang")) ||
      navigator.language ||
      "en"
    )
      .trim()
      .toLowerCase();

    if (LOGOUT_I18N[rawLang]) {
      return LOGOUT_I18N[rawLang];
    }

    const baseLang = rawLang.split("-")[0];
    if (LOGOUT_I18N[baseLang]) {
      return LOGOUT_I18N[baseLang];
    }

    return LOGOUT_I18N.en;
  }

  // Selectors that only exist in the global Instagram navigation bar / sidebar
  const GLOBAL_NAV_SELECTORS = [
    'a[href="/explore/"]',
    'a[href="/reels/"]',
    'svg[aria-label="Explore"]',
    'svg[aria-label="Reels"]',
    'svg[aria-label="Home"]',
    'svg[aria-label="Also from Meta"]',
    'svg[aria-label="Meta의 다른 앱"]',
    'svg[aria-label="탐색 탭"]',
    'svg[aria-label="릴스"]',
    'svg[aria-label="홈"]',
    'a[href*="threads.net"]',
    'a[href*="threads.com"]',
  ].join(", ");

  // Selectors for Audio Call, Video Call, and Voice Clip / Voice Message icons to hide
  const CALL_AND_VOICE_ICON_SELECTORS = [
    'svg[aria-label="Audio call"]',
    'svg[aria-label="Audio Call"]',
    'svg[aria-label="음성 통화"]',
    'svg[aria-label="음성통화"]',
    'svg[aria-label="音声通話"]',
    'svg[aria-label="Video call"]',
    'svg[aria-label="Video Call"]',
    'svg[aria-label="영상 통화"]',
    'svg[aria-label="영상통화"]',
    'svg[aria-label="ビデオ通話"]',
    'svg[aria-label="Voice Clip"]',
    'svg[aria-label="Voice clip"]',
    'svg[aria-label="Voice message"]',
    'svg[aria-label="음성 클립"]',
    'svg[aria-label="음성클립"]',
    'svg[aria-label="음성 메시지"]',
    'svg[aria-label="음성메시지"]',
    'svg[aria-label="ボイスクリップ"]',
  ].join(", ");

  const CUSTOM_CSS = `
    /* ==========================================================================
       1. Zero Out Global Sidebar/Bottom-Bar Variables & Hide Global Nav
       ========================================================================== */

    :root,
    html,
    body,
    * {
      --nav-narrow-width: 0px !important;
      --nav-medium-width: 0px !important;
      --nav-wide-width: 0px !important;
      --mobile-nav-height: 0px !important;
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
    }

    [data-ig-dm-hidden-nav="true"],
    nav[role="navigation"]:not(main[role="main"] *),
    footer[role="contentinfo"],
    footer {
      display: none !important;
      width: 0px !important;
      min-width: 0px !important;
      max-width: 0px !important;
      height: 0px !important;
      min-height: 0px !important;
      max-height: 0px !important;
      flex: 0 0 0px !important;
      margin: 0px !important;
      padding: 0px !important;
      border: none !important;
      overflow: hidden !important;
      pointer-events: none !important;
    }

    /* Hide Audio Call, Video Call, and Voice Message buttons */
    [role="button"]:not(:has([role="button"])):has(${CALL_AND_VOICE_ICON_SELECTORS}),
    button:has(${CALL_AND_VOICE_ICON_SELECTORS}),
    [data-ig-dm-hidden-feature="true"] {
      display: none !important;
      width: 0px !important;
      min-width: 0px !important;
      max-width: 0px !important;
      height: 0px !important;
      margin: 0px !important;
      padding: 0px !important;
      overflow: hidden !important;
      pointer-events: none !important;
    }

    /* Hide mobile/web "Use the App" promotional banners outside main */
    div[role="banner"]:not(main[role="main"] *):has(
      a[href*="applink.instagram.com"],
      a[href*="play.google.com"],
      a[href*="itunes.apple.com"]
    ) {
      display: none !important;
    }

    /* ==========================================================================
       2. Expand Primary DM Layout to Full Window Width (Preserve Natural Heights)
       ========================================================================== */

    html,
    body {
      width: 100vw !important;
      max-width: 100vw !important;
      height: 100vh !important;
      margin: 0px !important;
      padding: 0px !important;
      overflow-x: hidden !important;
    }

    [data-ig-dm-main-ancestor="true"],
    div:has(main[role="main"]),
    section:has(main[role="main"]) {
      margin-left: 0px !important;
      margin-right: 0px !important;
      padding-left: 0px !important;
      padding-right: 0px !important;
      padding-bottom: 0px !important;
      left: 0px !important;
      inset-inline-start: 0px !important;
      width: 100% !important;
      max-width: 100vw !important;
      box-sizing: border-box !important;
    }

    main[role="main"] {
      flex: 1 1 auto !important;
      width: 100% !important;
      min-width: 0px !important;
      max-width: 100vw !important;
      height: 100vh !important;
      margin: 0px !important;
      padding: 0px !important;
    }

    /* ==========================================================================
       3. DM Conversation List: Disable Story Ring Click Hijack & Show Compact Name
       ========================================================================== */

    [data-ig-dm-thread-row="true"] {
      pointer-events: auto !important;
      cursor: pointer !important;
    }

    [data-ig-dm-thread-row="true"] *,
    main[role="main"] div[role="navigation"] [role="button"] [role="button"],
    main[role="main"] div[role="navigation"] [role="button"] canvas,
    main[role="main"] div[role="navigation"] [role="button"] img,
    main[role="main"] [role="button"] [role="button"]:has(img, canvas),
    main[role="main"] [role="button"] canvas {
      pointer-events: none !important;
    }

    /* Stack avatar and partner name vertically when in narrow (< 900px) compact mode */
    [data-ig-dm-thread-row="true"][data-ig-dm-compact="true"] {
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      padding-top: 6px !important;
      padding-bottom: 6px !important;
    }

    .ig-dm-compact-name {
      display: none;
      font-size: 11px;
      font-weight: 500;
      line-height: 1.25;
      color: rgb(var(--ig-primary-text, 245, 245, 245));
      text-align: center;
      max-width: 78px;
      margin: 4px auto 0 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      pointer-events: none !important;
      user-select: none;
    }

    [data-ig-dm-compact="true"] .ig-dm-compact-name {
      display: block !important;
    }

    /* ==========================================================================
       4. In-App Logout Button & Confirmation Modal Styles
       ========================================================================== */

    #${LOGOUT_BTN_ID} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      margin-left: 6px;
      padding: 0;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: rgb(var(--ig-primary-icon, 245, 245, 245));
      cursor: pointer;
      transform-origin: center;
      transition: transform 0.15s ease-out, opacity 0.15s ease-out;
      flex-shrink: 0;
    }

    /* Match Instagram's "New message" hover: no background, icon grows slightly. */
    #${LOGOUT_BTN_ID}:hover {
      background-color: transparent;
      opacity: 1;
      transform: scale(1.05);
    }

    #${LOGOUT_BTN_ID}:active {
      opacity: 0.7;
    }

    #${LOGOUT_MODAL_ID} {
      position: fixed;
      inset: 0;
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(2px);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    .ig-dm-logout-dialog {
      width: 280px;
      background-color: rgb(var(--ig-elevated-background, 38, 38, 38));
      color: rgb(var(--ig-primary-text, 245, 245, 245));
      border-radius: 12px;
      overflow: hidden;
      text-align: center;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    }

    .ig-dm-logout-title {
      padding: 22px 20px 8px;
      font-size: 16px;
      font-weight: 600;
    }

    .ig-dm-logout-desc {
      padding: 0 20px 20px;
      font-size: 13px;
      color: rgb(var(--ig-secondary-text, 168, 168, 168));
    }

    .ig-dm-logout-action {
      display: block;
      width: 100%;
      padding: 13px 16px;
      border: none;
      border-top: 1px solid rgba(128, 128, 128, 0.22);
      background: transparent;
      font-size: 14px;
      cursor: pointer;
    }

    .ig-dm-logout-action:hover {
      background-color: rgba(128, 128, 128, 0.12);
    }

    .ig-dm-logout-confirm {
      color: #ed4956;
      font-weight: 700;
    }

    .ig-dm-logout-cancel {
      color: rgb(var(--ig-primary-text, 245, 245, 245));
      font-weight: 400;
    }

    /* ==========================================================================
       5. Single-Account Mode: Non-Clickable DM Header Username
       ========================================================================== */

    [data-ig-dm-account-locked="true"],
    [data-ig-dm-account-locked="true"]:hover,
    [data-ig-dm-account-locked="true"]:active,
    [data-ig-dm-account-locked="true"]:focus,
    [data-ig-dm-account-locked="true"]:focus-visible,
    [data-ig-dm-account-locked="true"] *,
    [data-ig-dm-account-locked="true"]:hover *,
    [data-ig-dm-account-locked="true"]:active *,
    [data-ig-dm-account-locked="true"]:focus *,
    [data-ig-dm-account-locked="true"]:focus-visible * {
      background-color: transparent !important;
      box-shadow: none !important;
      color: rgb(var(--ig-primary-text, 245, 245, 245)) !important;
      cursor: default !important;
      opacity: 1 !important;
      outline: none !important;
      text-decoration: none !important;
      -webkit-tap-highlight-color: transparent !important;
      -webkit-text-fill-color: rgb(var(--ig-primary-text, 245, 245, 245)) !important;
    }

    [data-ig-dm-account-locked="true"]::before,
    [data-ig-dm-account-locked="true"]::after,
    [data-ig-dm-account-locked="true"] *::before,
    [data-ig-dm-account-locked="true"] *::after {
      background-color: transparent !important;
      box-shadow: none !important;
      opacity: 1 !important;
    }

    [data-ig-dm-account-locked="true"] svg {
      display: none !important;
    }

    /* ==========================================================================
       6. Hide Incoming Audio/Video Call Modal
       ========================================================================== */

    /* The incoming call modal is the only dialog with an autoplaying/looping ringtone. */
    div[role="dialog"][aria-modal="true"]:has(audio[autoplay][loop]),
    [data-ig-dm-call-suppressed="true"] {
      display: none !important;
    }

    audio[autoplay][loop] {
      display: none !important;
    }
  `;

  /**
   * Returns `true` if a URL is allowed to remain inside the DM app webview:
   * - `/direct/*` (DM inbox & threads)
   * - `/p/*`, `/reel/*`, `/reels/*`, `/stories/*`, `/tv/*` (shared Post/Reel/Story popups)
   * - Authentication & internal paths (`/accounts/*`, `/challenge/*`, `/common/*`, `.php`, etc.)
   */
  function isAllowedInAppUrl(urlObj) {
    if (!urlObj) return true;
    const host = (urlObj.hostname || "").toLowerCase();
    if (host !== "instagram.com" && !host.endsWith(".instagram.com")) {
      return false;
    }
    if (host === "l.instagram.com") {
      return false;
    }

    const p = (urlObj.pathname || "/").toLowerCase();
    if (
      p === "/__ig_dm_logout__" ||
      p.endsWith(".php") ||
      p.startsWith("/direct") ||
      p.startsWith("/p/") ||
      p.startsWith("/reel/") ||
      p.startsWith("/reels/") ||
      p.startsWith("/stories/") ||
      p.startsWith("/tv/") ||
      p.startsWith("/accounts") ||
      p.startsWith("/challenge") ||
      p.startsWith("/consent") ||
      p.startsWith("/two_factor") ||
      p.startsWith("/paid_ads") ||
      p.startsWith("/common/") ||
      p.startsWith("/qp/") ||
      p.startsWith("/web/") ||
      p.startsWith("/session/") ||
      p.startsWith("/fxcal") ||
      p.startsWith("/oauth")
    ) {
      return true;
    }

    // User profile URLs on Instagram have a single path segment (`/<username>/` or `/<username>`).
    // Any multi-segment internal path (2+ segments) that is not `/explore/` is allowed in-app.
    const segments = p.split("/").filter(Boolean);
    if (segments.length >= 2 && segments[0] !== "explore") {
      return true;
    }

    return false;
  }

  function openExternally(targetUrl) {
    try {
      window.open(targetUrl, "_blank", "noopener,noreferrer");
    } catch (_) {
      window.location.assign(targetUrl);
    }
  }

  function getCookie(name) {
    const match = document.cookie.match(
      new RegExp("(?:^|;\\s*)" + name + "=([^;]*)")
    );
    return match ? decodeURIComponent(match[1]) : "";
  }

  async function executeLogout() {
    try {
      const csrfToken = getCookie("csrftoken");
      await fetch("https://www.instagram.com/api/v1/web/accounts/logout/ajax/", {
        method: "POST",
        headers: {
          "X-CSRFToken": csrfToken,
          "X-IG-App-ID": "936619743392459",
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        credentials: "include",
      });
    } catch (_) {}

    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch (_) {}

    window.location.replace("https://www.instagram.com/__ig_dm_logout__");
  }

  // Lets the native "Instagram DM > Log Out" menu item reuse this same
  // server-side logout + storage clear flow instead of only wiping local cookies.
  window.__IG_DM_LOGOUT__ = executeLogout;

  /**
   * Opens the localized in-app Logout confirmation dialog matching the user's language setting.
   */
  function showLogoutModal() {
    if (document.getElementById(LOGOUT_MODAL_ID)) return;

    const i18n = getLogoutStrings();
    const backdrop = document.createElement("div");
    backdrop.id = LOGOUT_MODAL_ID;
    backdrop.innerHTML = `
      <div class="ig-dm-logout-dialog" role="dialog" aria-modal="true">
        <div class="ig-dm-logout-title"></div>
        <div class="ig-dm-logout-desc"></div>
        <button type="button" class="ig-dm-logout-action ig-dm-logout-confirm"></button>
        <button type="button" class="ig-dm-logout-action ig-dm-logout-cancel"></button>
      </div>
    `;

    const titleEl = backdrop.querySelector(".ig-dm-logout-title");
    const descEl = backdrop.querySelector(".ig-dm-logout-desc");
    const confirmBtn = backdrop.querySelector(".ig-dm-logout-confirm");
    const cancelBtn = backdrop.querySelector(".ig-dm-logout-cancel");

    titleEl.textContent = i18n.title;
    descEl.textContent = i18n.desc;
    confirmBtn.textContent = i18n.confirm;
    cancelBtn.textContent = i18n.cancel;

    confirmBtn.addEventListener("click", () => {
      confirmBtn.textContent = i18n.loggingOut;
      confirmBtn.disabled = true;
      executeLogout();
    });

    cancelBtn.addEventListener("click", () => {
      backdrop.remove();
    });

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        backdrop.remove();
      }
    });

    document.body.appendChild(backdrop);
  }

  /**
   * Finds the "New message" compose button in the DM left panel header across all languages.
   */
  function findComposeButton() {
    // 1. Try common localized aria-labels
    const byLabel = document.querySelector(
      [
        'svg[aria-label="New message"]',
        'svg[aria-label="새로운 메시지"]',
        'svg[aria-label="新規メッセージ"]',
        'svg[aria-label="新消息"]',
        'svg[aria-label="新訊息"]',
        'svg[aria-label="Nuevo mensaje"]',
        'svg[aria-label="Nouveau message"]',
        'svg[aria-label="Neue Nachricht"]',
        'svg[aria-label="Nova mensagem"]',
      ].join(", ")
    );
    if (byLabel) {
      return byLabel.closest('[role="button"], button, a');
    }

    // 2. Language-independent fallback: find the compose SVG icon in the top-left DM header
    const mainEl = document.querySelector('main[role="main"]');
    if (!mainEl) return null;
    const dmNav = mainEl.querySelector('div[role="navigation"]') || mainEl;
    const svgs = dmNav.querySelectorAll("svg");
    for (let i = 0; i < svgs.length; i++) {
      const svg = svgs[i];
      const rect = svg.getBoundingClientRect();
      if (rect.top >= 8 && rect.top <= 75 && rect.left >= 60 && rect.left <= 420) {
        const path = svg.querySelector('path[d^="M12.202"], path[d*="M16.792"]');
        if (path) {
          return svg.closest('[role="button"], button, a');
        }
      }
    }
    return null;
  }

  /**
   * Injects the Logout icon button into the DM left header (right next to the
   * "New message" icon button) when on `/direct/*`, and keeps its tooltip synced
   * with the user's active language.
   */
  function ensureLogoutButton() {
    if (!window.location.pathname.startsWith("/direct")) {
      const existing = document.getElementById(LOGOUT_BTN_ID);
      if (existing) existing.remove();
      return;
    }

    const i18n = getLogoutStrings();
    const existingBtn = document.getElementById(LOGOUT_BTN_ID);
    if (existingBtn) {
      if (existingBtn.title !== i18n.tooltip) {
        existingBtn.title = i18n.tooltip;
        existingBtn.setAttribute("aria-label", i18n.tooltip);
      }
      return;
    }

    const composeBtn = findComposeButton();
    if (!composeBtn || !composeBtn.parentElement) return;

    const headerActionContainer = composeBtn.parentElement;
    headerActionContainer.style.setProperty("display", "flex", "important");
    headerActionContainer.style.setProperty("align-items", "center", "important");
    // Instagram turns this wrapper full-width in its narrow layouts. Centering keeps
    // the New message + logout pair in the middle of the header instead of at its left edge.
    headerActionContainer.style.setProperty("justify-content", "center", "important");

    const logoutBtn = document.createElement("button");
    logoutBtn.id = LOGOUT_BTN_ID;
    logoutBtn.type = "button";
    logoutBtn.title = i18n.tooltip;
    logoutBtn.setAttribute("aria-label", i18n.tooltip);
    logoutBtn.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
    `;

    logoutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showLogoutModal();
    });

    headerActionContainer.appendChild(logoutBtn);
  }

  /**
   * Returns true when an SVG is Instagram's small "down chevron" icon used by
   * the DM account switcher. Its label may be localized, so match common
   * translations in addition to the English aria-label/title.
   */
  function isDownChevronIcon(svg) {
    const titleEl = svg.querySelector("title");
    const label = [
      svg.getAttribute("aria-label"),
      svg.getAttribute("title"),
      titleEl ? titleEl.textContent : "",
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return /chevron|arrow|화살표|矢印|箭头|箭頭|flecha|flèche|pfeil|seta/.test(label);
  }

  /**
   * Single-account mode: disables the username/account switcher at the top of
   * the DM conversation list. The chevron is hidden via CSS and activation is
   * blocked in the capture phase so Instagram's React handler never runs.
   */
  function lockDmAccountSwitcher() {
    if (!window.location.pathname.startsWith("/direct")) return;

    const mainEl = document.querySelector('main[role="main"]');
    if (!mainEl) return;
    const dmNav = mainEl.querySelector('div[role="navigation"]') || mainEl;

    const composeBtn = findComposeButton();
    const composeRect = composeBtn ? composeBtn.getBoundingClientRect() : null;
    const candidates = dmNav.querySelectorAll('[role="button"], button, a[href]');

    let target = null;
    let fallback = null;

    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (el.id === LOGOUT_BTN_ID) continue;
      if (el.closest(`[${ACCOUNT_LOCK_ATTR}="true"]`)) continue;
      if (el.closest('[data-ig-dm-thread-row="true"]')) continue;
      if (el.querySelector("img, canvas")) continue;
      if (composeBtn && (el === composeBtn || el.contains(composeBtn) || composeBtn.contains(el))) {
        continue;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.left > 460) continue;

      // Keep the search in the same header row as the "New message" button.
      if (composeRect) {
        if (rect.bottom < composeRect.top - 8 || rect.top > composeRect.bottom + 8) {
          continue;
        }
      } else if (rect.top > 110) {
        continue;
      }

      const text = (el.textContent || "").trim();
      if (!text || text.length > 40) continue;

      const svgs = el.querySelectorAll("svg");
      if (svgs.length === 0) continue;

      let hasChevron = false;
      for (let j = 0; j < svgs.length; j++) {
        if (isDownChevronIcon(svgs[j])) {
          hasChevron = true;
          break;
        }
      }

      if (hasChevron) {
        target = el;
        break;
      }
      if (!fallback) fallback = el;
    }

    const lockTarget = target || fallback;
    if (!lockTarget) return;

    lockTarget.setAttribute(ACCOUNT_LOCK_ATTR, "true");
    lockTarget.setAttribute("aria-disabled", "true");
    lockTarget.setAttribute("tabindex", "-1");
  }

  /**
   * Finds the full-screen backdrop mask that belongs to the incoming-call modal.
   * The mask is a fixed, viewport-sized sibling of the dialog inside the modal
   * layer, so hiding the dialog alone would leave the dark overlay (and its
   * click blocking) on screen.
   */
  function findCallBackdrop(dialog) {
    let node = dialog.parentElement;
    let depth = 0;

    while (node && node !== document.body && depth < 12) {
      const children = node.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child === dialog || child.contains(dialog)) continue;

        const style = window.getComputedStyle(child);
        if (style.position !== "fixed" || style.pointerEvents === "none") continue;

        const rect = child.getBoundingClientRect();
        if (
          rect.width >= window.innerWidth * 0.9 &&
          rect.height >= window.innerHeight * 0.9
        ) {
          return child;
        }
      }

      node = node.parentElement;
      depth++;
    }

    return null;
  }

  /**
   * Hides incoming audio/video call modals and silences their ringtone, without
   * sending any decline/ack action. The call therefore keeps ringing on the
   * account's other devices/browsers where it can be answered normally.
   */
  function suppressIncomingCalls() {
    const ringtones = document.querySelectorAll("audio[autoplay][loop]");
    for (let i = 0; i < ringtones.length; i++) {
      const ringtone = ringtones[i];

      // Silence the local ringtone only. Keep the autoplay/loop attributes
      // intact so the CSS `:has(audio[autoplay][loop])` rule keeps matching.
      try {
        ringtone.muted = true;
        ringtone.pause();
      } catch (_) {}

      const dialog = ringtone.closest('[role="dialog"], [aria-modal="true"]');
      if (!dialog) continue;

      dialog.setAttribute("data-ig-dm-call-suppressed", "true");

      const backdrop = findCallBackdrop(dialog);
      if (backdrop) {
        backdrop.setAttribute("data-ig-dm-call-suppressed", "true");
      }
    }
  }

  /**
   * Intercept `history.pushState` and `history.replaceState` so client-side React Router
   * navigations to user profiles (`/<username>/`) or non-DM pages open in the external
   * system browser, while allowing `/direct/*` and shared media popups (`/p/`, `/reel/`,
   * `/stories/`) to open inside the app.
   */
  (function lockSpaRouterToDmAndMediaPopups() {
    const origPushState = window.history.pushState.bind(window.history);
    const origReplaceState = window.history.replaceState.bind(window.history);

    window.history.pushState = function (state, title, url) {
      if (url) {
        try {
          const resolved = new URL(String(url), window.location.origin);
          if (!isAllowedInAppUrl(resolved)) {
            if (
              (resolved.hostname === "www.instagram.com" ||
                resolved.hostname === "instagram.com") &&
              resolved.pathname === "/"
            ) {
              return origPushState(state, title, "/direct/inbox/");
            }
            openExternally(resolved.toString());
            return;
          }
        } catch (_) {}
      }
      return origPushState(state, title, url);
    };

    window.history.replaceState = function (state, title, url) {
      if (url) {
        try {
          const resolved = new URL(String(url), window.location.origin);
          if (!isAllowedInAppUrl(resolved)) {
            if (
              (resolved.hostname === "www.instagram.com" ||
                resolved.hostname === "instagram.com") &&
              resolved.pathname === "/"
            ) {
              return origReplaceState(state, title, "/direct/inbox/");
            }
            openExternally(resolved.toString());
            return;
          }
        } catch (_) {}
      }
      return origReplaceState(state, title, url);
    };
  })();

  function injectStyles() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      const target = document.head || document.documentElement;
      if (!target) return;
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.type = "text/css";
      style.appendChild(document.createTextNode(CUSTOM_CSS));
      target.appendChild(style);
    }
  }

  /**
   * Hides Audio Call, Video Call, and Voice Clip / Voice Message buttons in DOM.
   */
  function hideCallAndVoiceButtons() {
    const icons = document.querySelectorAll(CALL_AND_VOICE_ICON_SELECTORS);
    for (let i = 0; i < icons.length; i++) {
      const icon = icons[i];
      const btn = icon.closest('[role="button"], button');
      if (btn && !btn.getAttribute("data-ig-dm-thread-row")) {
        btn.setAttribute("data-ig-dm-hidden-feature", "true");
      } else {
        icon.setAttribute("data-ig-dm-hidden-feature", "true");
      }
    }
  }

  /**
   * Lightweight O(1) scrollbar clipper: walks up at most 8 parent nodes from a single
   * DM thread row to find the vertical scroll container and clips its right scrollbar
   * edge without scanning thousands of DOM nodes.
   */
  function clipDmListScrollbar(sampleRowBtn, mainEl) {
    if (!sampleRowBtn || !mainEl) return;

    let el = sampleRowBtn.parentElement;
    for (let depth = 0; el && el !== mainEl && depth < 10; depth++, el = el.parentElement) {
      if (el.getAttribute("data-ig-dm-scroll-clipped") === "true") {
        return;
      }

      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY;
      if (
        (overflowY === "scroll" || overflowY === "auto") &&
        el.scrollHeight > el.clientHeight
      ) {
        const parent = el.parentElement;
        if (parent && parent !== mainEl) {
          el.setAttribute("data-ig-dm-scroll-clipped", "true");
          parent.style.setProperty("overflow-x", "hidden", "important");
          el.style.setProperty("scrollbar-width", "none", "important");
          el.style.setProperty("width", "calc(100% + 20px)", "important");
          el.style.setProperty("max-width", "calc(100% + 20px)", "important");
          el.style.setProperty("margin-right", "-20px", "important");
          el.style.setProperty("padding-right", "20px", "important");
          el.style.setProperty("box-sizing", "border-box", "important");
        }
        return;
      }
    }
  }

  /**
   * Geometrically closes any ~48px bottom gap inside `main[role="main"]` when the
   * window is narrowed (< 768px).
   */
  function closeBottomGapAroundElement(startEl, mainEl) {
    if (!startEl || !mainEl) return;

    const vh = window.innerHeight;
    let el = startEl;

    while (el && el !== document.body && el !== document.documentElement) {
      const r = el.getBoundingClientRect();

      if (r.height > 200 && r.bottom >= vh - 90 && r.bottom < vh - 1) {
        let hasVisibleFollowingSibling = false;
        let nextSib = el.nextElementSibling;
        while (nextSib) {
          if (nextSib.getAttribute("data-ig-dm-hidden-nav") !== "true") {
            const nsRect = nextSib.getBoundingClientRect();
            const hasInput = Boolean(
              nextSib.querySelector('[role="textbox"], textarea, input')
            );
            if (
              !hasInput &&
              nsRect.height > 0 &&
              nsRect.height <= 85 &&
              nsRect.bottom >= vh - 15 &&
              nsRect.width >= window.innerWidth * 0.5
            ) {
              nextSib.setAttribute("data-ig-dm-hidden-nav", "true");
            } else if (nsRect.height > 2 && nsRect.top >= r.bottom - 5) {
              hasVisibleFollowingSibling = true;
              break;
            }
          }
          nextSib = nextSib.nextElementSibling;
        }

        if (!hasVisibleFollowingSibling) {
          const topOffset = Math.max(0, Math.round(r.top));
          const exactHeight =
            topOffset <= 2 ? "100vh" : `calc(100vh - ${topOffset}px)`;
          el.style.setProperty("height", exactHeight, "important");
          el.style.setProperty("min-height", exactHeight, "important");
          el.style.setProperty("max-height", exactHeight, "important");
          el.style.setProperty("margin-bottom", "0px", "important");
          el.style.setProperty("padding-bottom", "0px", "important");
        }
      }

      if (el === mainEl) break;
      el = el.parentElement;
    }
  }

  /**
   * Eliminates the global navigation sidebar/bottom-bar and any left/bottom blank space.
   */
  function hideGlobalNavigationAndEliminateBlankSpace() {
    const mainEl = document.querySelector('main[role="main"]');
    if (!mainEl) return;

    // 1. Find global navigation candidates and hide their entire top-level branch
    const candidates = Array.from(document.querySelectorAll(GLOBAL_NAV_SELECTORS));

    const textElements = document.querySelectorAll("span, div, a");
    for (let i = 0; i < textElements.length; i++) {
      const el = textElements[i];
      if (el.childElementCount === 0 && el.textContent) {
        const text = el.textContent.trim();
        if (text === "Also from Meta" || text === "Meta의 다른 앱") {
          candidates.push(el);
        }
      }
    }

    for (const node of candidates) {
      if (mainEl.contains(node)) continue;

      let branch = node;
      while (
        branch.parentElement &&
        branch.parentElement !== document.body &&
        branch.parentElement !== document.documentElement &&
        !branch.parentElement.contains(mainEl)
      ) {
        branch = branch.parentElement;
      }

      if (branch && !branch.contains(mainEl)) {
        branch.setAttribute("data-ig-dm-hidden-nav", "true");
      }
    }

    // 2. Walk up starting from `dmNav` (inside `mainEl`) all the way to `<body>`.
    const dmNav = mainEl.querySelector('div[role="navigation"]');
    let curr = dmNav || mainEl;

    while (curr && curr !== document.body && curr !== document.documentElement) {
      const isInsideMain = mainEl.contains(curr) && curr !== mainEl;

      if (!isInsideMain) {
        curr.setAttribute("data-ig-dm-main-ancestor", "true");
        curr.style.setProperty("margin-left", "0px", "important");
        curr.style.setProperty("margin-right", "0px", "important");
        curr.style.setProperty("padding-left", "0px", "important");
        curr.style.setProperty("padding-right", "0px", "important");
        curr.style.setProperty("padding-bottom", "0px", "important");
        curr.style.setProperty("left", "0px", "important");
        curr.style.setProperty("inset-inline-start", "0px", "important");
        curr.style.setProperty("width", "100%", "important");
        curr.style.setProperty("max-width", "100vw", "important");
      } else {
        curr.style.setProperty("margin-left", "0px", "important");
        curr.style.setProperty("padding-left", "0px", "important");
        curr.style.setProperty("left", "0px", "important");
        curr.style.setProperty("inset-inline-start", "0px", "important");
      }

      const parent = curr.parentElement;
      if (parent) {
        const currRect = curr.getBoundingClientRect();
        for (let i = 0; i < parent.children.length; i++) {
          const sib = parent.children[i];
          if (sib === curr || sib.contains(mainEl) || (dmNav && sib.contains(dmNav))) {
            continue;
          }

          const tag = sib.tagName;
          if (tag === "SCRIPT" || tag === "STYLE" || tag === "LINK" || tag === "NOSCRIPT") {
            continue;
          }

          const hasGlobalNav = Boolean(sib.querySelector(GLOBAL_NAV_SELECTORS));

          // Protect active modal dialogs (e.g. shared Post/Reel/Story popup, Logout modal)
          const isModalPortal =
            sib.id === LOGOUT_MODAL_ID ||
            (!hasGlobalNav &&
              (sib.getAttribute("role") === "dialog" ||
                Boolean(
                  sib.querySelector(
                    '[role="dialog"], [role="menu"], [role="listbox"], [aria-modal="true"]'
                  )
                )));

          if (isModalPortal) {
            if (sib.getAttribute("data-ig-dm-hidden-nav") === "true") {
              sib.removeAttribute("data-ig-dm-hidden-nav");
            }
            continue;
          }

          const precedesCurr = Boolean(
            sib.compareDocumentPosition(curr) & Node.DOCUMENT_POSITION_FOLLOWING
          );
          const sibRect = sib.getBoundingClientRect();

          const sitsToLeft =
            (!mainEl.contains(parent) || precedesCurr) &&
            sibRect.width > 0 &&
            sibRect.width <= 360 &&
            sibRect.left <= 10 &&
            (currRect.left >= sibRect.width - 5 || precedesCurr);

          const hasChatInput = Boolean(
            sib.querySelector('[role="textbox"], textarea, input')
          );
          const sitsAtBottom =
            !hasChatInput &&
            sibRect.height > 0 &&
            sibRect.height <= 85 &&
            sibRect.bottom >= window.innerHeight - 15 &&
            sibRect.width >= window.innerWidth * 0.5;

          if (sitsToLeft || sitsAtBottom || hasGlobalNav) {
            sib.setAttribute("data-ig-dm-hidden-nav", "true");
          }
        }
      }

      curr = parent;
    }

    // 3. Geometrically close any ~48px bottom gap inside `main[role="main"]`
    if (dmNav) {
      closeBottomGapAroundElement(dmNav, mainEl);
    }
    const chatTextbox = mainEl.querySelector('[role="textbox"]');
    if (chatTextbox) {
      closeBottomGapAroundElement(chatTextbox.parentElement, mainEl);
    }
  }

  function isGenericAltText(text) {
    if (!text) return true;
    const lower = text.trim().toLowerCase();
    return (
      lower.includes("user-profile") ||
      lower.includes("profile-picture") ||
      lower.includes("profile_picture") ||
      lower === "user avatar" ||
      lower === "유저 아바타" ||
      lower === "프로필 사진" ||
      lower === "profile picture" ||
      lower === "avatar"
    );
  }

  function extractNameFromReactFiber(rowBtn) {
    try {
      const keys = Object.keys(rowBtn);
      let fiberKey = null;
      for (let i = 0; i < keys.length; i++) {
        if (
          keys[i].startsWith("__reactFiber$") ||
          keys[i].startsWith("__reactInternalInstance$")
        ) {
          fiberKey = keys[i];
          break;
        }
      }
      if (!fiberKey) return "";

      let fiber = rowBtn[fiberKey];
      for (let depth = 0; fiber && depth < 15; depth++, fiber = fiber.return) {
        const props = fiber.memoizedProps;
        if (!props || typeof props !== "object") continue;

        const directCandidates = [
          props.threadTitle,
          props.thread_title,
          props.threadName,
          props.displayName,
          props.fullName,
          props.full_name,
          props.username,
          props.name,
          props.title,
        ];
        for (let i = 0; i < directCandidates.length; i++) {
          const val = directCandidates[i];
          if (typeof val === "string" && val.trim() && !isGenericAltText(val)) {
            return val.trim();
          }
        }

        const nestedObj = props.thread || props.user || props.otherUser || props.recipient;
        if (nestedObj && typeof nestedObj === "object") {
          const nestedName =
            nestedObj.thread_title ||
            nestedObj.threadTitle ||
            nestedObj.full_name ||
            nestedObj.fullName ||
            nestedObj.username ||
            nestedObj.name;
          if (typeof nestedName === "string" && nestedName.trim()) {
            return nestedName.trim();
          }
        }
      }
    } catch (_) {
      // Ignore React fiber traversal errors
    }
    return "";
  }

  function resolvePartnerName(rowBtn, isCompact) {
    const imgs = rowBtn.querySelectorAll("img");
    const primarySrc = imgs.length > 0 ? imgs[0].getAttribute("src") : "";

    if (!isCompact) {
      const spans = rowBtn.querySelectorAll('span[dir="auto"], span');
      for (let i = 0; i < spans.length; i++) {
        if (spans[i].classList.contains("ig-dm-compact-name")) continue;
        const text = (spans[i].textContent || "").trim();
        if (
          text &&
          text.length >= 1 &&
          text.length <= 40 &&
          !text.includes("·") &&
          !isGenericAltText(text)
        ) {
          if (primarySrc) avatarNameCache.set(primarySrc, text);
          rowBtn.setAttribute("data-ig-dm-partner-name", text);
          return text;
        }
      }
    }

    const cachedAttr = rowBtn.getAttribute("data-ig-dm-partner-name");
    if (cachedAttr && !isGenericAltText(cachedAttr)) {
      return cachedAttr;
    }
    if (primarySrc && avatarNameCache.has(primarySrc)) {
      const cachedMap = avatarNameCache.get(primarySrc);
      if (cachedMap && !isGenericAltText(cachedMap)) {
        rowBtn.setAttribute("data-ig-dm-partner-name", cachedMap);
        return cachedMap;
      }
    }

    const fiberName = extractNameFromReactFiber(rowBtn);
    if (fiberName) {
      if (primarySrc) avatarNameCache.set(primarySrc, fiberName);
      rowBtn.setAttribute("data-ig-dm-partner-name", fiberName);
      return fiberName;
    }

    const spans = rowBtn.querySelectorAll('span[dir="auto"], span');
    for (let i = 0; i < spans.length; i++) {
      if (spans[i].classList.contains("ig-dm-compact-name")) continue;
      const text = (spans[i].textContent || "").trim();
      if (text && text.length >= 1 && text.length <= 40 && !isGenericAltText(text)) {
        if (primarySrc) avatarNameCache.set(primarySrc, text);
        rowBtn.setAttribute("data-ig-dm-partner-name", text);
        return text;
      }
    }

    for (let i = 0; i < imgs.length; i++) {
      const rawAlt = (imgs[i].getAttribute("alt") || "").trim();
      if (!rawAlt || isGenericAltText(rawAlt)) continue;
      const cleaned = rawAlt
        .replace(/님의 프로필 사진$/, "")
        .replace(/의 프로필 사진$/, "")
        .replace(/'s profile picture$/i, "")
        .replace(/ profile picture$/i, "")
        .trim();
      if (cleaned && !isGenericAltText(cleaned)) {
        if (primarySrc) avatarNameCache.set(primarySrc, cleaned);
        rowBtn.setAttribute("data-ig-dm-partner-name", cleaned);
        return cleaned;
      }
    }

    return "";
  }

  function enhanceDmConversationList() {
    const mainEl = document.querySelector('main[role="main"]');
    if (!mainEl) return;

    const dmNav = mainEl.querySelector('div[role="navigation"]') || mainEl;
    const allButtons = dmNav.querySelectorAll('[role="button"]');
    let sampleRowBtn = null;

    for (let i = 0; i < allButtons.length; i++) {
      const btn = allButtons[i];

      if (btn.parentElement && btn.parentElement.closest('[role="button"]')) {
        continue;
      }

      const avatarImg = btn.querySelector("img");
      if (!avatarImg) continue;

      const rect = btn.getBoundingClientRect();
      if (rect.height < 44 || rect.height > 130 || rect.left > 420) {
        continue;
      }

      if (!sampleRowBtn) {
        sampleRowBtn = btn;
      }

      btn.setAttribute("data-ig-dm-thread-row", "true");

      const isCompact = rect.width > 0 && rect.width <= 150;
      const name = resolvePartnerName(btn, isCompact);

      if (isCompact) {
        btn.setAttribute("data-ig-dm-compact", "true");
        let badge = btn.querySelector(".ig-dm-compact-name");
        if (name) {
          if (!badge) {
            badge = document.createElement("div");
            badge.className = "ig-dm-compact-name";
            btn.appendChild(badge);
          }
          if (badge.textContent !== name) {
            badge.textContent = name;
          }
        } else if (badge) {
          badge.remove();
        }
      } else {
        btn.removeAttribute("data-ig-dm-compact");
      }
    }

    if (sampleRowBtn) {
      clipDmListScrollbar(sampleRowBtn, mainEl);
      closeBottomGapAroundElement(sampleRowBtn, mainEl);
    }
  }

  function applyOptimizations() {
    if (window.location.pathname === "/") {
      window.location.replace("https://www.instagram.com/direct/inbox/");
      return;
    }
    injectStyles();
    hideCallAndVoiceButtons();
    ensureLogoutButton();
    lockDmAccountSwitcher();
    suppressIncomingCalls();
    hideGlobalNavigationAndEliminateBlankSpace();
    enhanceDmConversationList();
  }

  // Run immediately, on DOMContentLoaded, and on window resize
  applyOptimizations();
  window.addEventListener("DOMContentLoaded", applyOptimizations, { once: true });
  window.addEventListener("resize", () => {
    hideCallAndVoiceButtons();
    ensureLogoutButton();
    lockDmAccountSwitcher();
    hideGlobalNavigationAndEliminateBlankSpace();
    enhanceDmConversationList();
  });

  // Observe DOM mutations for SPA navigation & responsive breakpoint switches
  let rafPending = false;
  const observer = new MutationObserver(() => {
    if (!document.getElementById(STYLE_ID)) {
      injectStyles();
    }
    // Handle the call modal immediately (before the next paint) so the popup
    // never becomes visible and the ringtone is stopped as early as possible.
    suppressIncomingCalls();
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        applyOptimizations();
      });
    }
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["autoplay", "loop"],
    childList: true,
    subtree: true,
  });

  // Intercept clicks on any `<a href>` that points to a user profile (`/<username>/`)
  // or external website and open it in the default system browser, while allowing
  // `/direct/*` and shared media popups (`/p/`, `/reel/`, `/stories/`) in-app.
  document.addEventListener(
    "click",
    (event) => {
      const anchor = event.target.closest && event.target.closest("a[href]");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
        return;
      }

      try {
        const resolved = new URL(href, window.location.origin);
        if (!isAllowedInAppUrl(resolved)) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          openExternally(resolved.toString());
        }
      } catch (_) {
        // Ignore malformed URLs
      }
    },
    true
  );

  // Single-account mode: block any activation of the locked DM account switcher.
  function isLockedAccountActivation(event) {
    const target = event.target;
    return Boolean(
      target &&
        target.closest &&
        target.closest(`[${ACCOUNT_LOCK_ATTR}="true"]`)
    );
  }

  ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
    document.addEventListener(
      type,
      (event) => {
        if (!isLockedAccountActivation(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      },
      true
    );
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") {
        return;
      }
      if (!isLockedAccountActivation(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    },
    true
  );
})();
