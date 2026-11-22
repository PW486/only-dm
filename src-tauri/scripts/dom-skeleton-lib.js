/*
 * Text-free DOM skeleton builder shared by the debug screenshot tools.
 *
 * The output intentionally contains NO visible text, NO href/URL values, and
 * NO alt/aria/title/placeholder values. It is safe to copy and share while
 * debugging selectors against a live Instagram session.
 */
(function () {
  "use strict";

  if (window.__ONLYDM_SKELETON_LIB__) {
    return;
  }
  window.__ONLYDM_SKELETON_LIB__ = true;

  function hrefPattern(href) {
    if (!href) return "";
    if (href.indexOf("/direct/t/") === 0) return "/direct/t/:id";
    if (href.indexOf("/direct/inbox") === 0) return "/direct/inbox";
    if (href.charAt(0) === "/") return "/:path";
    return ":external";
  }

  function isTransparentColor(color) {
    if (!color) return true;
    if (color === "transparent") return true;
    if (color === "rgba(0, 0, 0, 0)") return true;
    return /^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(color);
  }

  function backgroundKind(style) {
    var image = style.backgroundImage || "";
    if (image && image !== "none") {
      return image.indexOf("gradient") !== -1 ? "gradient" : "image";
    }
    if (!isTransparentColor(style.backgroundColor)) {
      return "color";
    }
    return "";
  }

  window.__ONLYDM_BUILD_SKELETON__ = function (root) {
    var items = [];
    var MAX_ITEMS = 3000;

    function walk(el, depth) {
      if (!(el instanceof Element) || items.length >= MAX_ITEMS) return;

      var tag = el.tagName.toLowerCase();
      if (
        tag === "script" ||
        tag === "style" ||
        tag === "noscript" ||
        tag === "template"
      ) {
        return;
      }

      var rect = el.getBoundingClientRect();
      var style = getComputedStyle(el);
      if (
        rect.width < 1 ||
        rect.height < 1 ||
        style.display === "none" ||
        style.visibility === "hidden"
      ) {
        return;
      }

      var directText = 0;
      for (var i = 0; i < el.childNodes.length; i += 1) {
        var child = el.childNodes[i];
        if (child.nodeType === Node.TEXT_NODE) {
          directText += (child.nodeValue || "").trim().length;
        }
      }

      var href = el.getAttribute("href") || "";
      var img =
        tag === "img"
          ? {
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              hasAlt: el.hasAttribute("alt"),
              hasSrcSet: el.hasAttribute("srcset"),
            }
          : undefined;

      if (
        directText > 0 ||
        el.hasAttribute("role") ||
        href ||
        img ||
        el.hasAttribute("aria-label") ||
        el.hasAttribute("placeholder") ||
        el.children.length === 0
      ) {
        items.push({
          depth: depth,
          tag: tag,
          role: el.getAttribute("role") || undefined,
          dir: el.getAttribute("dir") || undefined,
          aria: el.hasAttribute("aria-label") ? "present" : undefined,
          title: el.hasAttribute("title") ? "present" : undefined,
          placeholder: el.hasAttribute("placeholder") ? "present" : undefined,
          testid: el.getAttribute("data-testid") || undefined,
          href: href ? hrefPattern(href) : undefined,
          cls:
            (el.getAttribute("class") || "")
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 6)
              .join(" ") || undefined,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          textLen: directText || undefined,
          children: el.children.length || undefined,
          font:
            directText > 0
              ? {
                  weight: style.fontWeight,
                  size: style.fontSize,
                }
              : undefined,
          bg: backgroundKind(style) || undefined,
          bgColor:
            backgroundKind(style) === "color" ? style.backgroundColor : undefined,
          overflowY:
            style.overflowY && style.overflowY !== "visible"
              ? style.overflowY
              : undefined,
          img: img,
        });
      }

      for (var j = 0; j < el.children.length; j += 1) {
        walk(el.children[j], depth + 1);
      }
    }

    walk(root, 0);

    return {
      generatedAt: new Date().toISOString(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      items: items,
      truncated: items.length >= MAX_ITEMS,
    };
  };
})();
