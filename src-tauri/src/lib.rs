use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItemBuilder, MenuItemKind, PredefinedMenuItem, Submenu},
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, Manager, Runtime, WebviewWindowBuilder,
};

#[cfg(not(target_os = "macos"))]
use tauri::menu::AboutMetadata;

#[cfg(target_os = "macos")]
use objc2::{define_class, msg_send, DefinedClass, MainThreadOnly};
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSEvent, NSView, NSWindow};
#[cfg(target_os = "macos")]
use objc2_foundation::MainThreadMarker;
#[cfg(target_os = "macos")]
use tauri::{RunEvent, WindowEvent};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogBuilder, MessageDialogButtons, MessageDialogKind,
};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

const APP_DISPLAY_NAME: &str = "OnlyDM";
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Prevents the startup check and the menu item from opening two update
/// dialogs at the same time.
static UPDATE_CHECK_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

/// Guards against two concurrent attempts to recreate the main window.
static WINDOW_CREATION_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

/// Set while the macOS close button / Cmd+W is tearing the window down. The
/// window is intentionally not hidden anymore: closing it destroys the webview
/// so Instagram's memory is released, and the Dock icon recreates it on demand.
#[cfg(target_os = "macos")]
static WINDOW_CLOSING: AtomicBool = AtomicBool::new(false);

/// A Dock click that arrives while the window is still being destroyed should
/// reopen the app as soon as teardown finishes instead of being lost.
#[cfg(target_os = "macos")]
static RECREATE_AFTER_DESTROY: AtomicBool = AtomicBool::new(false);

/// Last frame observed from move/resize events. An explicit quit (Cmd+Q or the
/// app menu) terminates the process without a close request, so this cached
/// value is what `RunEvent::Exit` persists for the next launch.
#[cfg(target_os = "macos")]
static LAST_WINDOW_GEOMETRY: std::sync::Mutex<Option<WindowGeometry>> = std::sync::Mutex::new(None);

const WINDOW_STATE_FILE: &str = "window-state.json";

/// Native window backgrounds matching Instagram's dark/light page colors. Without
/// an explicit color the WKWebView paints an opaque white canvas until Instagram's
/// first paint, which flashes in dark mode.
const DARK_WINDOW_BACKGROUND: tauri::webview::Color = tauri::webview::Color(0, 0, 0, 255);
const LIGHT_WINDOW_BACKGROUND: tauri::webview::Color = tauri::webview::Color(255, 255, 255, 255);

fn window_background_color(theme: tauri::Theme) -> tauri::webview::Color {
    match theme {
        tauri::Theme::Dark => DARK_WINDOW_BACKGROUND,
        _ => LIGHT_WINDOW_BACKGROUND,
    }
}

#[derive(Clone, Copy)]
struct WindowGeometry {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    fullscreen: bool,
}

struct WindowCreationGuard;

impl Drop for WindowCreationGuard {
    fn drop(&mut self) {
        WINDOW_CREATION_IN_PROGRESS.store(false, Ordering::SeqCst);
    }
}

/// Embedded initialization script for CSS injection, sidebar/bottom gap removal,
/// call/voice button hiding, localized logout UI, and DM + media popup navigation lock.
const INIT_SCRIPT: &str = include_str!("../scripts/inject.js");

/// Debug-only fixture layer used to produce privacy-safe marketing screenshots.
/// It is never embedded in release builds and is only invoked from the
/// "Developer > Prepare Demo Screenshot" menu item.
#[cfg(debug_assertions)]
const DOM_SKELETON_LIB: &str = include_str!("../scripts/dom-skeleton-lib.js");
#[cfg(debug_assertions)]
const SCREENSHOT_MODE_SCRIPT: &str = include_str!("../scripts/screenshot-mode.js");
#[cfg(debug_assertions)]
const DUMP_DOM_SKELETON_SCRIPT: &str = include_str!("../scripts/dump-dom-skeleton.js");

/// Standard desktop User-Agent.
const DESKTOP_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

const LOGOUT_TRIGGER_PATH: &str = "/__ig_dm_logout__";
const LOGIN_REDIRECT_URL: &str =
    "https://www.instagram.com/accounts/login/?next=%2Fdirect%2Finbox%2F";

/// Evaluated when the app menu's "Log Out" item is clicked. Prefers the page's
/// logout routine (which calls Instagram's logout API, invalidating the session
/// server-side) and falls back to the internal trigger that performs native cleanup.
const REQUEST_LOGOUT_SCRIPT: &str = r#"
(function () {
  if (typeof window.__IG_DM_LOGOUT__ === "function") {
    window.__IG_DM_LOGOUT__();
  } else {
    window.location.replace("https://www.instagram.com/__ig_dm_logout__");
  }
})();
"#;

/// Returns `true` if a `window.open` / popup URL on `instagram.com` should stay in-app.
/// User profile URLs (`/<username>/`) and `/explore/` return `false` so they open in the
/// external browser when clicked.
fn is_allowed_instagram_popup_path(path: &str) -> bool {
    let p = path.to_lowercase();
    p.starts_with("/direct")
        || p.starts_with("/p/")
        || p.starts_with("/reel/")
        || p.starts_with("/reels/")
        || p.starts_with("/stories/")
        || p.starts_with("/tv/")
        || p.starts_with("/accounts")
        || p.starts_with("/challenge")
}

/// Classifies `on_navigation` events (which include automatic background `<iframe>`s
/// such as `/common/referer_frame.php` and `/paid_ads/generete_pixels/`).
/// All `*.instagram.com` (except `l.instagram.com` link shims) and background Meta sync
/// iframes are allowed silently so background frames never pop open the PC browser.
fn classify_frame_navigation(url: &Url) -> NavigationAction {
    let scheme = url.scheme();

    if scheme == "about" || scheme == "blob" || scheme == "data" {
        return NavigationAction::Allow;
    }

    if scheme != "http" && scheme != "https" {
        return NavigationAction::OpenExternal(url.to_string());
    }

    let Some(host) = url.host_str().map(|h| h.to_lowercase()) else {
        return NavigationAction::Allow;
    };

    let path = url.path();
    let lower_path = path.to_lowercase();

    // Special internal signal triggered by the in-app Logout button
    if (host == "instagram.com" || host.ends_with(".instagram.com")) && path == LOGOUT_TRIGGER_PATH
    {
        return NavigationAction::Logout;
    }

    // Unwrap Instagram's outbound link shim `l.instagram.com/?u=<encoded_url>`
    if host == "l.instagram.com" {
        if let Some((_, target)) = url.query_pairs().find(|(k, _)| k == "u") {
            return NavigationAction::OpenExternal(target.into_owned());
        }
        return NavigationAction::OpenExternal(url.to_string());
    }

    // Allow all `instagram.com` frame navigations & background iframes (`/paid_ads/...`,
    // `/common/referer_frame.php`, etc.). User profile clicks are intercepted in JS and
    // routed via `window.open` -> `on_new_window`.
    if host == "instagram.com" || host.ends_with(".instagram.com") {
        return NavigationAction::Allow;
    }

    // Allow background Meta / Facebook login_sync & pixel iframes and static CDNs
    if (host == "facebook.com" || host.ends_with(".facebook.com"))
        && (lower_path.contains("login_sync")
            || lower_path.contains("/instagram/")
            || lower_path.contains("/plugins/")
            || lower_path.contains("/common/")
            || lower_path.contains("pixel")
            || lower_path.ends_with(".php")
            || lower_path.contains("/tr"))
    {
        return NavigationAction::Allow;
    }

    if host.ends_with(".fbcdn.net")
        || host.ends_with(".cdninstagram.com")
        || host.ends_with(".facebook.net")
    {
        return NavigationAction::Allow;
    }

    NavigationAction::OpenExternal(url.to_string())
}

/// Classifies `on_new_window` events (`window.open` / `target="_blank"`, including
/// profile links and external links forwarded by `inject.js`).
fn classify_popup_window(url: &Url) -> NavigationAction {
    let scheme = url.scheme();
    if scheme == "about" || scheme == "blob" || scheme == "data" {
        return NavigationAction::Allow;
    }

    if scheme != "http" && scheme != "https" {
        return NavigationAction::OpenExternal(url.to_string());
    }

    let Some(host) = url.host_str().map(|h| h.to_lowercase()) else {
        return NavigationAction::Allow;
    };

    let path = url.path();

    if (host == "instagram.com" || host.ends_with(".instagram.com")) && path == LOGOUT_TRIGGER_PATH
    {
        return NavigationAction::Logout;
    }

    if host == "l.instagram.com" {
        if let Some((_, target)) = url.query_pairs().find(|(k, _)| k == "u") {
            return NavigationAction::OpenExternal(target.into_owned());
        }
        return NavigationAction::OpenExternal(url.to_string());
    }

    if host == "instagram.com" || host.ends_with(".instagram.com") {
        if is_allowed_instagram_popup_path(path) {
            return NavigationAction::Allow;
        }
        return NavigationAction::OpenExternal(url.to_string());
    }

    NavigationAction::OpenExternal(url.to_string())
}

enum NavigationAction {
    Allow,
    Logout,
    OpenExternal(String),
}

/// Opens an external URL using Tauri's Shell plugin.
#[allow(deprecated)]
fn open_in_system_browser(app_handle: &AppHandle, target_url: &str) {
    if let Err(err) = app_handle.shell().open(target_url, None) {
        eprintln!("Failed to open external URL '{}': {}", target_url, err);
    }
}

#[cfg(target_os = "macos")]
const ABOUT_COPYRIGHT_TEXT: &str = "© 2026 PW486";

#[cfg(target_os = "macos")]
const ABOUT_TEXT_FONT_SIZE: f64 = 11.0;

/// Shows the standard macOS About panel with attributed credits, so the
/// copyright and Donate links are clickable while keeping the native panel.
#[cfg(target_os = "macos")]
fn show_about_panel(app: &AppHandle) {
    let bundle_version = app
        .config()
        .bundle
        .macos
        .bundle_version
        .clone()
        .unwrap_or_default();

    if let Err(err) = app.run_on_main_thread(move || {
        show_about_panel_on_main_thread(&bundle_version);
    }) {
        eprintln!("Failed to open About panel: {err}");
    }
}

// The standard About panel only hosts text/attachments in its credits area, so
// the Donate link is embedded as a bitmap of a real AppKit push button. The
// bitmap has to be re-rendered when the system appearance changes because
// AppKit only restyles its own controls, not our cached image.
#[cfg(target_os = "macos")]
fn about_donate_image(
    mtm: MainThreadMarker,
) -> Option<objc2::rc::Retained<objc2_app_kit::NSImage>> {
    use objc2::AnyThread;
    use objc2_app_kit::{NSBezelStyle, NSButton, NSControlSize, NSFont, NSImage};
    use objc2_foundation::NSString;

    unsafe {
        let button = NSButton::buttonWithTitle_target_action(
            &NSString::from_str("♥ Donate"),
            None,
            None,
            mtm,
        );
        button.setBezelStyle(NSBezelStyle::Push);
        button.setControlSize(NSControlSize::Small);
        button.setFont(Some(&NSFont::systemFontOfSize(ABOUT_TEXT_FONT_SIZE)));
        button.sizeToFit();

        let bounds = button.bounds();
        button
            .bitmapImageRepForCachingDisplayInRect(bounds)
            .map(|representation| {
                button.cacheDisplayInRect_toBitmapImageRep(bounds, &representation);
                let image = NSImage::initWithSize(NSImage::alloc(), bounds.size);
                image.addRepresentation(&representation);
                image
            })
    }
}

#[cfg(target_os = "macos")]
fn about_link_attributes() -> objc2::rc::Retained<
    objc2_foundation::NSDictionary<
        objc2_foundation::NSAttributedStringKey,
        objc2::runtime::AnyObject,
    >,
> {
    use objc2::{rc::Retained, runtime::AnyObject};
    use objc2_app_kit::{
        NSColor, NSCursor, NSCursorAttributeName, NSForegroundColorAttributeName,
        NSUnderlineStyleAttributeName,
    };
    use objc2_foundation::{NSDictionary, NSNumber, NSString};

    let label: Retained<AnyObject> = unsafe { Retained::cast_unchecked(NSColor::labelColor()) };
    let underline: Retained<AnyObject> =
        unsafe { Retained::cast_unchecked(NSNumber::new_usize(1)) };
    let cursor: Retained<AnyObject> =
        unsafe { Retained::cast_unchecked(NSCursor::pointingHandCursor()) };
    let link_keys: [&NSString; 3] = unsafe {
        [
            NSForegroundColorAttributeName,
            NSUnderlineStyleAttributeName,
            NSCursorAttributeName,
        ]
    };

    NSDictionary::from_retained_objects(&link_keys, &[label, underline, cursor])
}

#[cfg(target_os = "macos")]
fn build_about_credits(
    mtm: MainThreadMarker,
) -> objc2::rc::Retained<objc2_foundation::NSMutableAttributedString> {
    use objc2::{rc::Retained, runtime::AnyObject, AnyThread};
    use objc2_app_kit::{
        NSAttributedStringAttachmentConveniences, NSColor, NSFont, NSFontAttributeName,
        NSForegroundColorAttributeName, NSLinkAttributeName, NSTextAttachment,
    };
    use objc2_foundation::{
        NSAttributedString, NSMutableAttributedString, NSPoint, NSRange, NSRect, NSSize, NSString,
        NSURL,
    };

    const AUTHOR_URL: &str = "https://pw486.github.io/";
    const DONATE_URL: &str = "https://ko-fi.com/pw486/tip";

    let credits_text = NSString::from_str(&format!("{ABOUT_COPYRIGHT_TEXT}   "));
    let credits = NSMutableAttributedString::initWithString(
        NSMutableAttributedString::alloc(),
        &credits_text,
    );

    // Use semantic colors so the text follows a live light/dark switch.
    let font: Retained<AnyObject> =
        unsafe { Retained::cast_unchecked(NSFont::systemFontOfSize(ABOUT_TEXT_FONT_SIZE)) };
    let label: Retained<AnyObject> = unsafe { Retained::cast_unchecked(NSColor::labelColor()) };
    let text_range = NSRange::new(0, credits.length());
    unsafe {
        credits.addAttribute_value_range(NSFontAttributeName, &font, text_range);
        credits.addAttribute_value_range(NSForegroundColorAttributeName, &label, text_range);
    }

    let author_range = credits_text.rangeOfString(&NSString::from_str("PW486"));
    if author_range.length > 0 {
        if let Some(url) = NSURL::URLWithString(&NSString::from_str(AUTHOR_URL)) {
            let value: Retained<AnyObject> = unsafe { Retained::cast_unchecked(url) };
            unsafe {
                credits.addAttribute_value_range(NSLinkAttributeName, &value, author_range);
            }
        }
    }

    if let Some(image) = about_donate_image(mtm) {
        let attachment = NSTextAttachment::new();
        attachment.setImage(Some(&image));
        let size = image.size();
        attachment.setBounds(NSRect::new(
            NSPoint::new(0.0, -6.0),
            NSSize::new(size.width, size.height),
        ));

        let donate_range = NSRange::new(credits.length(), 1);
        let attachment_string = NSAttributedString::attributedStringWithAttachment(&attachment);
        credits.appendAttributedString(&attachment_string);

        if let Some(url) = NSURL::URLWithString(&NSString::from_str(DONATE_URL)) {
            let value: Retained<AnyObject> = unsafe { Retained::cast_unchecked(url) };
            unsafe {
                credits.addAttribute_value_range(NSLinkAttributeName, &value, donate_range);
            }
        }
    }

    credits
}

/// Refreshes the custom credits of an open About panel. Both the copyright
/// color and the Donate button image are appearance-dependent and would keep
/// the theme they were first rendered with otherwise.
#[cfg(target_os = "macos")]
fn refresh_open_about_panel() {
    use objc2_app_kit::NSApplication;

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };

    let app = NSApplication::sharedApplication(mtm);
    let windows = app.windows();

    for index in 0..windows.count() {
        let window = windows.objectAtIndex(index);
        let Some(content) = window.contentView() else {
            continue;
        };

        if !replace_about_credits(&content, mtm) {
            continue;
        }

        let link_attributes = about_link_attributes();
        style_about_panel(&content, &link_attributes);
        content.layoutSubtreeIfNeeded();
        break;
    }
}

#[cfg(target_os = "macos")]
fn replace_about_credits(view: &NSView, mtm: MainThreadMarker) -> bool {
    use objc2_app_kit::NSTextView;

    if let Some(text_view) = view.downcast_ref::<NSTextView>() {
        if text_view
            .string()
            .to_string()
            .contains(ABOUT_COPYRIGHT_TEXT)
        {
            if let Some(storage) = unsafe { text_view.textStorage() } {
                storage.setAttributedString(&build_about_credits(mtm));
            }
            text_view.setNeedsDisplay(true);
            return true;
        }
    }

    let subviews = view.subviews();
    for index in 0..subviews.count() {
        if replace_about_credits(&subviews.objectAtIndex(index), mtm) {
            return true;
        }
    }

    false
}

/// Invisible helper view that lives inside the About panel and reacts to
/// appearance changes. It is kept in the panel's view hierarchy so AppKit
/// delivers `viewDidChangeEffectiveAppearance` for free.
#[cfg(target_os = "macos")]
#[derive(Default)]
struct AboutAppearanceObserverIvars;

#[cfg(target_os = "macos")]
define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[ivars = AboutAppearanceObserverIvars]
    struct AboutAppearanceObserver;

    impl AboutAppearanceObserver {
        #[unsafe(method(viewDidChangeEffectiveAppearance))]
        fn view_did_change_effective_appearance(&self) {
            unsafe {
                let _: () = msg_send![super(self), viewDidChangeEffectiveAppearance];
            }
            refresh_open_about_panel();
        }
    }
);

#[cfg(target_os = "macos")]
impl AboutAppearanceObserver {
    fn new(mtm: MainThreadMarker) -> objc2::rc::Retained<Self> {
        use objc2_foundation::{NSPoint, NSRect, NSSize};

        let this = Self::alloc(mtm).set_ivars(AboutAppearanceObserverIvars);
        unsafe {
            msg_send![
                super(this),
                initWithFrame: NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(0.0, 0.0))
            ]
        }
    }
}

#[cfg(target_os = "macos")]
fn install_about_appearance_observer(content: &NSView, mtm: MainThreadMarker) {
    use objc2::ClassType;
    use objc2_foundation::NSObjectProtocol;

    let subviews = content.subviews();
    for index in 0..subviews.count() {
        if subviews
            .objectAtIndex(index)
            .isKindOfClass(AboutAppearanceObserver::class())
        {
            return;
        }
    }

    let observer = AboutAppearanceObserver::new(mtm);
    content.addSubview(&observer);
}

#[cfg(target_os = "macos")]
fn show_about_panel_on_main_thread(bundle_version: &str) {
    use objc2::{rc::Retained, runtime::AnyObject, AnyThread};
    use objc2_app_kit::{
        NSAboutPanelOptionApplicationIcon, NSAboutPanelOptionApplicationName,
        NSAboutPanelOptionApplicationVersion, NSAboutPanelOptionCredits, NSAboutPanelOptionVersion,
        NSApplication, NSImage,
    };
    use objc2_foundation::{NSData, NSDictionary, NSString};

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };

    let credits = build_about_credits(mtm);

    // Load the full-size app icon; the default panel icon can be a small
    // generic placeholder when the app is launched outside its bundle.
    let icon = NSImage::initWithData(
        NSImage::alloc(),
        &NSData::with_bytes(include_bytes!("../icons/icon.png")),
    );

    let name: Retained<AnyObject> =
        unsafe { Retained::cast_unchecked(NSString::from_str(APP_DISPLAY_NAME)) };
    let version: Retained<AnyObject> =
        unsafe { Retained::cast_unchecked(NSString::from_str(APP_VERSION)) };
    let attributed_credits: Retained<AnyObject> = unsafe { Retained::cast_unchecked(credits) };

    let mut keys: Vec<&NSString> = unsafe {
        vec![
            NSAboutPanelOptionApplicationName,
            NSAboutPanelOptionApplicationVersion,
            NSAboutPanelOptionCredits,
        ]
    };
    let mut objects = vec![name, version, attributed_credits];

    // An empty value would suppress the panel's CFBundleVersion fallback, so
    // only set the build version when the config actually provides one.
    if !bundle_version.is_empty() {
        keys.push(unsafe { NSAboutPanelOptionVersion });
        objects.push(unsafe { Retained::cast_unchecked(NSString::from_str(bundle_version)) });
    }

    if let Some(icon) = icon {
        keys.push(unsafe { NSAboutPanelOptionApplicationIcon });
        objects.push(unsafe { Retained::cast_unchecked(icon) });
    }

    let options = NSDictionary::from_retained_objects(&keys, &objects);

    let app = NSApplication::sharedApplication(mtm);
    unsafe {
        app.orderFrontStandardAboutPanelWithOptions(&options);
    }

    let link_attributes = about_link_attributes();

    let windows = app.windows();
    for index in 0..windows.count() {
        let window = windows.objectAtIndex(index);
        if let Some(content) = window.contentView() {
            if style_about_panel(&content, &link_attributes) {
                install_about_appearance_observer(&content, mtm);
                // The panel copies its own credits into the text view while it
                // prepares the window, which can drop our link color, so
                // rebuild them once the panel is on screen.
                refresh_open_about_panel();
                break;
            }
        }
    }
}

/// Applies the custom link style and version font to the standard About panel.
#[cfg(target_os = "macos")]
fn style_about_panel(
    view: &objc2_app_kit::NSView,
    link_attributes: &objc2_foundation::NSDictionary<
        objc2_foundation::NSAttributedStringKey,
        objc2::runtime::AnyObject,
    >,
) -> bool {
    use objc2_app_kit::{NSFont, NSTextField, NSTextView};

    let mut changed = false;

    if let Some(text_view) = view.downcast_ref::<NSTextView>() {
        if text_view
            .string()
            .to_string()
            .contains(ABOUT_COPYRIGHT_TEXT)
        {
            unsafe {
                text_view.setLinkTextAttributes(Some(link_attributes));
            }
            text_view.setFont(Some(&NSFont::systemFontOfSize(ABOUT_TEXT_FONT_SIZE)));
            text_view.setNeedsDisplay(true);
            changed = true;
        }
    }

    if let Some(text_field) = view.downcast_ref::<NSTextField>() {
        if text_field.stringValue().to_string().contains(APP_VERSION) {
            text_field.setFont(Some(&NSFont::systemFontOfSize(ABOUT_TEXT_FONT_SIZE)));
            objc2_app_kit::NSView::setNeedsDisplay(text_field, true);
            changed = true;
        }
    }

    let subviews = view.subviews();
    for index in 0..subviews.count() {
        changed |= style_about_panel(&subviews.objectAtIndex(index), link_attributes);
    }

    changed
}

/// Clears all browsing data (including HttpOnly session cookies) and redirects to the login page.
/// This is the final step, run after the page has invalidated the server-side session.
fn finish_native_logout(app_handle: &AppHandle) {
    let handle = app_handle.clone();
    std::thread::spawn(move || {
        if let Some(win) = handle.get_webview_window("main") {
            let _ = win.clear_all_browsing_data();
            if let Ok(login_url) = Url::parse(LOGIN_REDIRECT_URL) {
                let _ = win.navigate(login_url);
            }
        }
    });
}

/// Requests logout through the page's injected `executeLogout()` so Instagram's API
/// invalidates the session first. `clear_all_browsing_data` is asynchronous on macOS,
/// so navigating right after it could reload the still-authenticated inbox, which is
/// why the app menu item previously appeared to need two clicks.
fn request_native_logout(app_handle: &AppHandle) {
    if let Some(win) = app_handle.get_webview_window("main") {
        if win.eval(REQUEST_LOGOUT_SCRIPT).is_ok() {
            return;
        }
    }
    finish_native_logout(app_handle);
}

/// Reads the last saved window geometry, if it is still usable.
fn load_window_geometry(app: &AppHandle) -> Option<WindowGeometry> {
    let path = app.path().app_data_dir().ok()?.join(WINDOW_STATE_FILE);
    let contents = fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&contents).ok()?;

    let geometry = WindowGeometry {
        x: value.get("x")?.as_f64()?,
        y: value.get("y")?.as_f64()?,
        width: value.get("width")?.as_f64()?,
        height: value.get("height")?.as_f64()?,
        fullscreen: value
            .get("fullscreen")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
    };

    let sane = geometry.x.is_finite()
        && geometry.y.is_finite()
        && geometry.width.is_finite()
        && geometry.height.is_finite()
        && geometry.width >= 320.0
        && geometry.height >= 400.0
        && geometry.width <= 20_000.0
        && geometry.height <= 20_000.0;

    sane.then_some(geometry)
}

/// Persists the window geometry for the next recreation (Dock click or app launch).
#[cfg(target_os = "macos")]
fn save_window_geometry(app: &AppHandle, geometry: WindowGeometry) {
    let app_data_dir = match app.path().app_data_dir() {
        Ok(dir) => dir,
        Err(err) => {
            eprintln!("Failed to resolve app_data_dir for window state: {err}");
            return;
        }
    };

    if let Err(err) = fs::create_dir_all(&app_data_dir) {
        eprintln!("Failed to create app_data_dir for window state: {err}");
        return;
    }

    let payload = serde_json::json!({
        "x": geometry.x,
        "y": geometry.y,
        "width": geometry.width,
        "height": geometry.height,
        "fullscreen": geometry.fullscreen,
    });

    if let Err(err) = fs::write(app_data_dir.join(WINDOW_STATE_FILE), payload.to_string()) {
        eprintln!("Failed to save window state: {err}");
    }
}

/// Captures logical window bounds, taking the current display scale into account.
#[cfg(target_os = "macos")]
fn capture_window_geometry<R: Runtime>(window: &tauri::Window<R>) -> Option<WindowGeometry> {
    let scale_factor = window.scale_factor().ok()?;
    if !scale_factor.is_finite() || scale_factor <= 0.0 {
        return None;
    }

    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;

    Some(WindowGeometry {
        x: position.x as f64 / scale_factor,
        y: position.y as f64 / scale_factor,
        width: size.width as f64 / scale_factor,
        height: size.height as f64 / scale_factor,
        fullscreen: window.is_fullscreen().unwrap_or(false),
    })
}

#[cfg(target_os = "macos")]
fn remember_window_geometry<R: Runtime>(window: &tauri::Window<R>) {
    // Quitting the app does not emit a close request, so this is the only
    // chance to see the live frame.
    if WINDOW_CLOSING.load(Ordering::SeqCst) {
        return;
    }
    if let Some(geometry) = capture_window_geometry(window) {
        if let Ok(mut cached) = LAST_WINDOW_GEOMETRY.lock() {
            *cached = Some(geometry);
        }
    }
}

// A native drag handle for the hidden titlebar. The window is moved directly
// from mouse-dragged events instead of handing the mouse-down to AppKit's
// `performWindowDragWithEvent:`. On fast drags that modal move loop can see the
// mouse-up before the move has started and log "Window move completed without
// beginning" (and swallow the drag), so a plain frame-origin update is both
// deterministic and warning-free.
#[cfg(target_os = "macos")]
struct TitlebarDragState {
    start_mouse: objc2_foundation::NSPoint,
    start_origin: objc2_foundation::NSPoint,
}

#[cfg(target_os = "macos")]
#[derive(Default)]
struct TitlebarDragViewIvars {
    drag: std::cell::RefCell<Option<TitlebarDragState>>,
}

#[cfg(target_os = "macos")]
define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[ivars = TitlebarDragViewIvars]
    struct TitlebarDragView;

    impl TitlebarDragView {
        #[unsafe(method(acceptsFirstMouse:))]
        fn accepts_first_mouse(&self, _event: Option<&NSEvent>) -> bool {
            true
        }

        #[unsafe(method(mouseDown:))]
        fn mouse_down(&self, event: &NSEvent) {
            if event.clickCount() == 2 {
                self.ivars().drag.borrow_mut().take();
                if let Some(window) = self.window() {
                    window.performZoom(None);
                }
                return;
            }
            let Some(window) = self.window() else {
                return;
            };
            *self.ivars().drag.borrow_mut() = Some(TitlebarDragState {
                start_mouse: window.convertPointToScreen(event.locationInWindow()),
                start_origin: window.frame().origin,
            });
        }

        #[unsafe(method(mouseDragged:))]
        fn mouse_dragged(&self, event: &NSEvent) {
            let Some(window) = self.window() else {
                return;
            };
            let (start_mouse, start_origin) = {
                let drag = self.ivars().drag.borrow();
                let Some(state) = drag.as_ref() else {
                    return;
                };
                (state.start_mouse, state.start_origin)
            };

            // Use the event's own location instead of `NSEvent::mouseLocation()`:
            // fast flicks can be delivered after the pointer has already moved
            // on, which makes the global mouse location lag behind the event.
            let current = window.convertPointToScreen(event.locationInWindow());
            let dx = current.x - start_mouse.x;
            let dy = current.y - start_mouse.y;
            if dx.abs() < 1.0 && dy.abs() < 1.0 {
                return;
            }
            window.setFrameOrigin(objc2_foundation::NSPoint::new(
                start_origin.x + dx,
                start_origin.y + dy,
            ));
        }

        #[unsafe(method(mouseUp:))]
        fn mouse_up(&self, event: &NSEvent) {
            let Some(window) = self.window() else {
                return;
            };
            let Some(state) = self.ivars().drag.borrow_mut().take() else {
                return;
            };

            // A very fast flick can be coalesced into mouse-down + mouse-up
            // without any mouse-dragged event. Apply the final delta so the
            // window still follows the pointer instead of swallowing the drag.
            let current = window.convertPointToScreen(event.locationInWindow());
            let dx = current.x - state.start_mouse.x;
            let dy = current.y - state.start_mouse.y;
            if dx.abs() >= 1.0 || dy.abs() >= 1.0 {
                window.setFrameOrigin(objc2_foundation::NSPoint::new(
                    state.start_origin.x + dx,
                    state.start_origin.y + dy,
                ));
            }
        }
    }
);

#[cfg(target_os = "macos")]
impl TitlebarDragView {
    fn new(mtm: MainThreadMarker, frame: objc2_foundation::NSRect) -> objc2::rc::Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(TitlebarDragViewIvars::default());
        unsafe { msg_send![super(this), initWithFrame: frame] }
    }
}

#[cfg(target_os = "macos")]
const TITLEBAR_DRAG_VIEW_WIDTH: f64 = 353.0;
#[cfg(target_os = "macos")]
const TITLEBAR_DRAG_VIEW_COMPACT_WIDTH: f64 = 72.0;
#[cfg(target_os = "macos")]
const TITLEBAR_DRAG_VIEW_HEIGHT: f64 = 54.0;
#[cfg(target_os = "macos")]
const TITLEBAR_DRAG_VIEW_COMPACT_BREAKPOINT: f64 = 900.0;

/// Keeps the native drag handle over the top strip. It is hidden in fullscreen
/// and outside the DM routes where a page control may occupy the same corner;
/// compact DM layouts use a narrower handle over the icon rail.
#[cfg(target_os = "macos")]
fn sync_titlebar_drag_view(window: &tauri::WebviewWindow) {
    use objc2::ClassType;
    use objc2_app_kit::NSAutoresizingMaskOptions;
    use objc2_foundation::{NSObjectProtocol, NSPoint, NSRect, NSSize};

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let Ok(ns_window) = window.ns_window() else {
        return;
    };
    let ns_window = unsafe { &*(ns_window.cast::<NSWindow>()) };
    // The native titlebar drag must not race the manual frame updates; it is
    // also the only remaining path that can emit "Window move completed
    // without beginning" on fast flicks.
    ns_window.setMovable(false);
    let Some(content) = ns_window.contentView() else {
        return;
    };

    let logical_width = window
        .inner_size()
        .ok()
        .zip(window.scale_factor().ok())
        .map(|(size, scale)| size.width as f64 / scale)
        .unwrap_or(f64::INFINITY);
    let path = window
        .url()
        .map(|url| url.path().to_string())
        .unwrap_or_default();
    let is_dm = path == "/direct" || path.starts_with("/direct/");
    let is_inbox = path == "/direct/inbox" || path == "/direct/inbox/";
    let compact = logical_width < TITLEBAR_DRAG_VIEW_COMPACT_BREAKPOINT;
    let hidden = window.is_fullscreen().unwrap_or(false) || !is_dm;

    // The inbox has no chat header, so the whole top strip can be a native
    // drag handle. Chat and Requests pages keep it over the rail only; the
    // compact layout has a narrow icon rail, so use a smaller handle there.
    let view_width = if is_inbox {
        content.bounds().size.width
    } else if compact {
        TITLEBAR_DRAG_VIEW_COMPACT_WIDTH
    } else {
        TITLEBAR_DRAG_VIEW_WIDTH
    };

    let subviews = content.subviews();
    for index in 0..subviews.count() {
        let view = subviews.objectAtIndex(index);
        if view.isKindOfClass(TitlebarDragView::class()) {
            view.setHidden(hidden);
            if !hidden {
                let bounds = content.bounds();
                view.setFrame(NSRect::new(
                    NSPoint::new(0.0, bounds.size.height - TITLEBAR_DRAG_VIEW_HEIGHT),
                    NSSize::new(view_width, TITLEBAR_DRAG_VIEW_HEIGHT),
                ));
            }
            return;
        }
    }

    let bounds = content.bounds();
    let view = TitlebarDragView::new(
        mtm,
        NSRect::new(
            NSPoint::new(0.0, bounds.size.height - TITLEBAR_DRAG_VIEW_HEIGHT),
            NSSize::new(view_width, TITLEBAR_DRAG_VIEW_HEIGHT),
        ),
    );
    view.setAutoresizingMask(NSAutoresizingMaskOptions::ViewMinYMargin);
    view.setHidden(hidden);
    content.addSubview(&view);
}

/// SPA thread routes (opening a chat, Requests, returning to the inbox) do not
/// fire a page-load or resize event, so watch the webview URL and resize the
/// native drag handle when the route changes.
#[cfg(target_os = "macos")]
fn spawn_titlebar_drag_sync(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last_path = String::new();
        loop {
            let Some(window) = app.get_webview_window("main") else {
                break;
            };
            let Ok(url) = window.url() else {
                break;
            };
            let path = url.path().to_string();
            if path != last_path {
                last_path = path;
                let app_handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if let Some(win) = app_handle.get_webview_window("main") {
                        sync_titlebar_drag_view(&win);
                    }
                });
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
    });
}

/// Creates the main webview window. Called once from setup and again every time
/// the user reopens the app from the Dock after closing its window.
fn create_main_window(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window("main").is_some() {
        return Ok(());
    }

    if WINDOW_CREATION_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let _creation_guard = WindowCreationGuard;

    let persistent_data_dir = app.path().app_data_dir()?.join("webview-data");
    fs::create_dir_all(&persistent_data_dir)?;

    let mut window_config = app
        .config()
        .app
        .windows
        .first()
        .expect("Missing main window configuration in tauri.conf.json")
        .clone();

    // Build hidden so the native window/WebView background can be matched to the
    // system appearance before the first frame is composited. Showing it right
    // away afterwards keeps launch latency imperceptible.
    window_config.visible = false;

    if let Some(geometry) = load_window_geometry(app) {
        window_config.fullscreen = geometry.fullscreen;
        window_config.center = false;
        window_config.x = Some(geometry.x);
        window_config.y = Some(geometry.y);

        // Restore the last visible frame even if the window was zoomed. Applying
        // the native `maximized` flag while the window is still hidden makes
        // AppKit zoom from the centered default frame and drops it at the wrong
        // position, so the saved frame is restored directly instead.
        //
        // A fullscreen window keeps the configured default size so leaving
        // fullscreen still lands at a sane size; its saved origin is enough to
        // re-enter fullscreen on the display it was last used on.
        if !geometry.fullscreen {
            window_config.width = geometry.width;
            window_config.height = geometry.height;
        }
    }

    let nav_handle = app.clone();
    let popup_handle = app.clone();

    let mut builder = WebviewWindowBuilder::from_config(app, &window_config)?
        .user_agent(DESKTOP_USER_AGENT)
        .data_directory(persistent_data_dir)
        .incognito(false)
        .initialization_script(INIT_SCRIPT);

    if let Some(default_icon) = app.default_window_icon().cloned() {
        builder = builder.icon(default_icon)?;
    }

    let window = builder
        .on_page_load(|window, payload| {
            let is_login_page = payload.url().path().starts_with("/accounts/login");
            set_logout_menu_enabled(window.app_handle(), !is_login_page);
            if payload.event() == PageLoadEvent::Finished {
                let _ = window.eval(INIT_SCRIPT);
            }
            #[cfg(target_os = "macos")]
            {
                let window_handle = window.clone();
                let handle = window_handle.clone();
                let _ = window_handle.run_on_main_thread(move || {
                    sync_titlebar_drag_view(&handle);
                });
            }
        })
        .on_navigation(move |url| match classify_frame_navigation(url) {
            NavigationAction::Allow => true,
            NavigationAction::Logout => {
                finish_native_logout(&nav_handle);
                false
            }
            NavigationAction::OpenExternal(external_url) => {
                open_in_system_browser(&nav_handle, &external_url);
                false
            }
        })
        .on_new_window(move |url, _features| match classify_popup_window(&url) {
            NavigationAction::Allow => {
                if let Some(win) = popup_handle.get_webview_window("main") {
                    let _ = win.navigate(url);
                }
                NewWindowResponse::Deny
            }
            NavigationAction::Logout => {
                finish_native_logout(&popup_handle);
                NewWindowResponse::Deny
            }
            NavigationAction::OpenExternal(external_url) => {
                open_in_system_browser(&popup_handle, &external_url);
                NewWindowResponse::Deny
            }
        })
        .build()?;

    #[cfg(target_os = "macos")]
    sync_titlebar_drag_view(&window);
    #[cfg(target_os = "macos")]
    spawn_titlebar_drag_sync(app.clone());

    // The titlebar is transparent (see titleBarStyle in tauri.conf.json), so the
    // window background is also what the titlebar displays. Set it before
    // showing and keep it in sync in the ThemeChanged handler below.
    let theme = window.theme().unwrap_or(tauri::Theme::Light);
    let _ = window.set_background_color(Some(window_background_color(theme)));
    let _ = window.show();
    let _ = window.set_focus();

    Ok(())
}

/// Enables or disables the app menu's "Log Out" item. The item is disabled on the
/// login screen, where there is no session to end.
fn set_logout_menu_enabled<R: Runtime>(app: &AppHandle<R>, enabled: bool) {
    let Some(menu) = app.menu() else { return };
    let Some(MenuItemKind::Submenu(app_menu)) = menu.get("app-menu") else {
        return;
    };
    if let Some(MenuItemKind::MenuItem(logout_item)) = app_menu.get("logout") {
        let _ = logout_item.set_enabled(enabled);
    }
}

/// Builds a native message dialog. Attaching the main window makes macOS draw a
/// modern NSAlert sheet with the app icon; without a parent the dialog falls back
/// to the legacy CFUserNotification alert and its dated "!" bubble icon.
fn message_dialog<R: Runtime>(
    app: &AppHandle<R>,
    message: impl Into<String>,
    title: &str,
) -> MessageDialogBuilder<R> {
    let dialog = app.dialog().message(message).title(title);
    match app.get_webview_window("main") {
        Some(window) => dialog.parent(&window),
        None => dialog,
    }
}

fn show_update_error(app: &AppHandle, err: &impl std::fmt::Display) {
    message_dialog(
        app,
        format!("Could not update OnlyDM.\n\n{err}"),
        "Update Error",
    )
    .kind(MessageDialogKind::Error)
    .buttons(MessageDialogButtons::Ok)
    .blocking_show();
}

/// Spawns an update check off the main thread. `interactive` controls whether
/// "already up to date" and network errors are shown to the user.
fn spawn_update_check(app: AppHandle, interactive: bool) {
    if UPDATE_CHECK_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        check_for_updates(app, interactive).await;
        UPDATE_CHECK_IN_PROGRESS.store(false, Ordering::SeqCst);
    });
}

async fn check_for_updates(app: AppHandle, interactive: bool) {
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(err) => {
            if interactive {
                show_update_error(&app, &err);
            } else {
                eprintln!("Failed to initialize updater: {err}");
            }
            return;
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            let notes = update.body.as_deref().unwrap_or("").trim();
            let mut message = format!(
                "OnlyDM {} is available. You are running {}.",
                update.version, update.current_version
            );

            if !notes.is_empty() {
                let summary: String = notes.chars().take(1200).collect();
                message.push_str("\n\n");
                message.push_str(&summary);
            }

            let should_update = message_dialog(&app, message, "Update Available")
                .kind(MessageDialogKind::Info)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Update Now".to_string(),
                    "Later".to_string(),
                ))
                .blocking_show();

            if !should_update {
                return;
            }

            match update.download_and_install(|_, _| {}, || {}).await {
                Ok(()) => {
                    message_dialog(
                        &app,
                        "The update was installed successfully. OnlyDM will now restart.",
                        "Update Installed",
                    )
                    .kind(MessageDialogKind::Info)
                    .buttons(MessageDialogButtons::OkCustom("Restart".to_string()))
                    .blocking_show();
                    app.restart();
                }
                Err(err) => show_update_error(&app, &err),
            }
        }
        Ok(None) => {
            if interactive {
                message_dialog(
                    &app,
                    format!("OnlyDM {APP_VERSION} is up to date."),
                    "No Updates Available",
                )
                .kind(MessageDialogKind::Info)
                .buttons(MessageDialogButtons::Ok)
                .blocking_show();
            }
        }
        Err(err) => {
            if interactive {
                show_update_error(&app, &err);
            } else {
                eprintln!("Update check failed: {err}");
            }
        }
    }
}

/// Builds the application menu bar with "OnlyDM" as the explicit display name
/// (including in the "About OnlyDM" panel) instead of the Cargo package slug.
fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    // macOS needs a custom item so the About panel can receive attributed
    // credits with clickable links; other platforms keep the predefined panel.
    #[cfg(target_os = "macos")]
    let about_item =
        MenuItemBuilder::with_id("about", format!("About {}", APP_DISPLAY_NAME)).build(app)?;
    #[cfg(not(target_os = "macos"))]
    let about_item = PredefinedMenuItem::about(
        app,
        Some(&format!("About {}", APP_DISPLAY_NAME)),
        Some(AboutMetadata {
            name: Some(APP_DISPLAY_NAME.to_string()),
            version: Some(APP_VERSION.to_string()),
            // Build number shown in parentheses: "Version 0.1.0 (1)".
            short_version: app.config().bundle.macos.bundle_version.clone(),
            // Use the full-size icon rather than the 32x32 default window icon.
            icon: tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")).ok(),
            ..Default::default()
        }),
    )?;

    let check_updates_item =
        MenuItemBuilder::with_id("check-updates", "Check for Updates...").build(app)?;

    let logout_item = MenuItemBuilder::with_id("logout", "Log Out")
        .accelerator("Cmd+Shift+L")
        .build(app)?;

    let app_submenu = Submenu::with_id_and_items(
        app,
        "app-menu",
        APP_DISPLAY_NAME,
        true,
        &[
            &about_item,
            &check_updates_item,
            &PredefinedMenuItem::separator(app)?,
            &logout_item,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some(&format!("Hide {}", APP_DISPLAY_NAME)))?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some(&format!("Quit {}", APP_DISPLAY_NAME)))?,
        ],
    )?;

    let edit_submenu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let window_submenu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    // Marketing screenshot helpers are only available in debug builds. They
    // sanitize the live DM DOM locally before capture; release bundles neither
    // expose the menu nor embed the script.
    #[cfg(debug_assertions)]
    let developer_submenu = Submenu::with_items(
        app,
        "Developer",
        true,
        &[
            &MenuItemBuilder::with_id("prepare-screenshot", "Prepare Demo Screenshot")
                .build(app)?,
            &MenuItemBuilder::with_id("reset-screenshot", "Reset Demo Screenshot").build(app)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItemBuilder::with_id("dump-dom-skeleton", "Copy DOM Skeleton").build(app)?,
        ],
    )?;

    let mut menu_items: Vec<&dyn tauri::menu::IsMenuItem<R>> =
        vec![&app_submenu, &edit_submenu, &window_submenu];
    #[cfg(debug_assertions)]
    menu_items.push(&developer_submenu);

    Menu::with_items(app, &menu_items)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .menu(build_app_menu)
        .on_menu_event(|app, event| {
            if event.id() == "about" {
                #[cfg(target_os = "macos")]
                show_about_panel(app);
            } else if event.id() == "logout" {
                request_native_logout(app);
            } else if event.id() == "check-updates" {
                spawn_update_check(app.clone(), true);
            } else {
                #[cfg(debug_assertions)]
                if event.id() == "prepare-screenshot" {
                    if let Some(window) = app.get_webview_window("main") {
                        let script = format!("{}\n{}", DOM_SKELETON_LIB, SCREENSHOT_MODE_SCRIPT);
                        let _ = window.eval(script);
                    }
                } else if event.id() == "reset-screenshot" {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.eval("window.location.reload();");
                    }
                } else if event.id() == "dump-dom-skeleton" {
                    if let Some(window) = app.get_webview_window("main") {
                        let script = format!("{}\n{}", DOM_SKELETON_LIB, DUMP_DOM_SKELETON_SCRIPT);
                        let _ = window.eval(script);
                    }
                }
            }
        });

    #[cfg(target_os = "macos")]
    let builder = builder.on_window_event(|window, event| {
        match event {
            WindowEvent::CloseRequested { .. } => {
                // Do not prevent the close: destroying the window also destroys the
                // WKWebView and releases Instagram's page memory. The app itself stays
                // alive via the ExitRequested handler below and is recreated on reopen.
                WINDOW_CLOSING.store(true, Ordering::SeqCst);
                if let Some(geometry) = capture_window_geometry(window) {
                    save_window_geometry(window.app_handle(), geometry);
                }
            }
            WindowEvent::Destroyed => {
                WINDOW_CLOSING.store(false, Ordering::SeqCst);
                set_logout_menu_enabled(window.app_handle(), false);

                if RECREATE_AFTER_DESTROY.swap(false, Ordering::SeqCst) {
                    let app_handle = window.app_handle().clone();
                    let recreate_handle = app_handle.clone();
                    let _ = app_handle.run_on_main_thread(move || {
                        if let Err(err) = create_main_window(&recreate_handle) {
                            eprintln!("Failed to recreate main window: {err}");
                        }
                    });
                }
            }
            WindowEvent::Moved(_) => remember_window_geometry(window),
            WindowEvent::Resized(_) => {
                remember_window_geometry(window);

                let app_handle = window.app_handle().clone();
                let handle = app_handle.clone();
                let _ = app_handle.run_on_main_thread(move || {
                    if let Some(win) = handle.get_webview_window("main") {
                        sync_titlebar_drag_view(&win);
                    }
                });
            }
            WindowEvent::ThemeChanged(theme) => {
                // The transparent titlebar shows the window background, so this
                // also restyles it live and keeps overscroll from exposing the
                // previous theme's color.
                if let Some(win) = window.app_handle().get_webview_window("main") {
                    let _ = win.set_background_color(Some(window_background_color(*theme)));
                }
            }
            _ => {}
        }
    });

    let app = builder
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Builds the main window, restores its last geometry, and wires up the
            // persistent WebView data directory, CSS injection, and link guards.
            create_main_window(&app_handle)?;

            // Check for updates once per launch in release builds. The check is
            // asynchronous and silent when offline or already up to date.
            #[cfg(not(debug_assertions))]
            spawn_update_check(app_handle.clone(), false);

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building OnlyDM application");

    app.run(|_app_handle, _event| {
        #[cfg(target_os = "macos")]
        match _event {
            RunEvent::ExitRequested {
                code: None, api, ..
            } => {
                // The last window was destroyed (red X / Cmd+W). Keep the process
                // alive so the Dock icon can recreate it later. Explicit exits such
                // as Cmd+Q carry a code and are allowed through.
                api.prevent_exit();
            }
            RunEvent::ExitRequested { code: Some(_), .. } => {
                // Do not recreate a window while an explicit quit/restart is running.
                RECREATE_AFTER_DESTROY.store(false, Ordering::SeqCst);
            }
            RunEvent::Exit => {
                // Cmd+Q / "Quit OnlyDM" does not emit CloseRequested, so persist
                // the last observed frame; otherwise quitting after moving or
                // resizing restores the geometry from the previous close.
                let geometry = _app_handle
                    .get_webview_window("main")
                    .and_then(|webview| capture_window_geometry(&webview.as_ref().window()))
                    .or_else(|| LAST_WINDOW_GEOMETRY.lock().ok().and_then(|cached| *cached));

                if let Some(geometry) = geometry {
                    save_window_geometry(_app_handle, geometry);
                }
            }
            RunEvent::Reopen { .. } => {
                if let Some(win) = _app_handle.get_webview_window("main") {
                    if WINDOW_CLOSING.load(Ordering::SeqCst) {
                        RECREATE_AFTER_DESTROY.store(true, Ordering::SeqCst);
                    } else {
                        let _ = win.show();
                        let _ = win.unminimize();
                        let _ = win.set_focus();
                    }
                } else if let Err(err) = create_main_window(_app_handle) {
                    eprintln!("Failed to recreate main window: {err}");
                }
            }
            _ => {}
        }
    });
}
