fn main() {
  println!("cargo:rerun-if-changed=../dist");
  tauri_build::build()
}
