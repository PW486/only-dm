fn main() {
    println!("cargo:rerun-if-changed=scripts/inject.js");
    println!("cargo:rerun-if-changed=Info.plist");
    println!("cargo:rerun-if-changed=icons/icon.icns");
    println!("cargo:rerun-if-changed=icons/icon.png");

    // Embed Info.plist into the Mach-O binary on macOS
    #[cfg(target_os = "macos")]
    {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        let plist_path = std::path::Path::new(&manifest_dir).join("Info.plist");
        println!(
            "cargo:rustc-link-arg=-Wl,-sectcreate,__TEXT,__info_plist,{}",
            plist_path.display()
        );
    }

    tauri_build::build()
}
