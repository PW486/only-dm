use std::fs;
use tauri::{
    menu::{AboutMetadata, Menu, MenuItemBuilder, MenuItemKind, PredefinedMenuItem, Submenu},
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, Manager, RunEvent, Runtime, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_shell::ShellExt;
use url::Url;

const APP_DISPLAY_NAME: &str = "Instagram DM";
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

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
const LOGIN_REDIRECT_URL: &str = "https://www.instagram.com/accounts/login/?next=%2Fdirect%2Finbox%2F";

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
    if (host == "instagram.com" || host.ends_with(".instagram.com")) && path == LOGOUT_TRIGGER_PATH {
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

    if (host == "instagram.com" || host.ends_with(".instagram.com")) && path == LOGOUT_TRIGGER_PATH {
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

/// Builds the application menu bar with "Instagram DM" as the explicit display name
/// (including in the "About Instagram DM" dialog) instead of the Cargo package slug.
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
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .menu(|app| build_app_menu(app))
        .on_menu_event(|app, event| {
            if event.id() == "logout" {
                request_native_logout(app);
            }
        })
        .on_window_event(|window, event| {
            // Like KakaoTalk / WhatsApp on macOS: closing the window (red X button or Cmd+W)
            // hides the window instead of quitting the app so it can be reopened from the Dock.
            if let WindowEvent::CloseRequested { api, .. } = event {
                #[cfg(target_os = "macos")]
                {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let app_handle = app.handle().clone();

            // 1. Resolve and create a persistent WebView data directory for cookies & localStorage
            let persistent_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app_data_dir")
                .join("webview-data");

            fs::create_dir_all(&persistent_data_dir)
                .expect("Failed to create persistent webview data directory");

            // 2. Load the window configuration from tauri.conf.json
            let window_config = app
                .config()
                .app
                .windows
                .first()
                .expect("Missing main window configuration in tauri.conf.json")
                .clone();

            let nav_handle = app_handle.clone();
            let popup_handle = app_handle.clone();

            // 3. Build the WebView window with persistent storage, CSS injection, and link guards
            let mut builder = WebviewWindowBuilder::from_config(&app_handle, &window_config)?
                .user_agent(DESKTOP_USER_AGENT)
                .data_directory(persistent_data_dir)
                .incognito(false)
                .initialization_script(INIT_SCRIPT);

            if let Some(default_icon) = app.default_window_icon().cloned() {
                builder = builder.icon(default_icon)?;
            }

            builder
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

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Instagram DM application");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = event {
            if let Some(win) = app_handle.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }
    });
}
