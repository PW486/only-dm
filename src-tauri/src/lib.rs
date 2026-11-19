use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{AboutMetadata, Menu, MenuItemBuilder, MenuItemKind, PredefinedMenuItem, Submenu},
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, Manager, Runtime, WebviewWindowBuilder,
};

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

/// Standard desktop User-Agent.
#[cfg(target_os = "macos")]
const DESKTOP_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

#[cfg(target_os = "windows")]
const DESKTOP_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

#[cfg(target_os = "linux")]
const DESKTOP_USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

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
/// (including in the "About OnlyDM" dialog) instead of the Cargo package slug.
fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    // `default_window_icon` resolves to the first PNG in `bundle.icon` (32x32), which the
    // standard About panel would draw at its natural 32pt size. Load the full-size app icon
    // instead so it fills the panel's 64pt icon slot.
    let about_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")).ok();

    let about_metadata = AboutMetadata {
        name: Some(APP_DISPLAY_NAME.to_string()),
        version: Some(APP_VERSION.to_string()),
        // Build number shown in parentheses: "Version 0.1.0 (1)".
        short_version: app.config().bundle.macos.bundle_version.clone(),
        icon: about_icon,
        ..Default::default()
    };

    let check_updates_item =
        MenuItemBuilder::with_id("check-updates", "Check for Updates...").build(app)?;

    let logout_item = MenuItemBuilder::with_id("logout", "Log Out")
        .accelerator("CmdOrCtrl+Shift+L")
        .build(app)?;

    let app_submenu = Submenu::with_id_and_items(
        app,
        "app-menu",
        APP_DISPLAY_NAME,
        true,
        &[
            &PredefinedMenuItem::about(
                app,
                Some(&format!("About {}", APP_DISPLAY_NAME)),
                Some(about_metadata),
            )?,
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

    Menu::with_items(app, &[&app_submenu, &edit_submenu, &window_submenu])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .menu(build_app_menu)
        .on_menu_event(|app, event| {
            if event.id() == "logout" {
                request_native_logout(app);
            } else if event.id() == "check-updates" {
                spawn_update_check(app.clone(), true);
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
            WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                // Remember the live frame; quitting the app does not emit a
                // close request, so this is the only chance to see the value.
                if !WINDOW_CLOSING.load(Ordering::SeqCst) {
                    if let Some(geometry) = capture_window_geometry(window) {
                        if let Ok(mut cached) = LAST_WINDOW_GEOMETRY.lock() {
                            *cached = Some(geometry);
                        }
                    }
                }
            }
            WindowEvent::ThemeChanged(theme) => {
                // Keep the native background in sync so a later recreation or
                // overscroll never exposes the previous theme's color.
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
