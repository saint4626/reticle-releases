fn main() {
    // Load .env and pass variables to the compiler via cargo:rustc-env
    if let Ok(iter) = dotenvy::dotenv_iter() {
        for item in iter {
            if let Ok((key, val)) = item {
                println!("cargo:rustc-env={}={}", key, val);
            }
        }
    }

    // Re-run if .env changes
    println!("cargo:rerun-if-changed=.env");

    tauri_build::build()
}
