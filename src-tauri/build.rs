fn main() {
  println!("cargo:rerun-if-changed=../dist");
  println!("cargo:rerun-if-changed=skills");

  // Copy bundled skills (src-tauri/skills/) to target/release/skills/ so
  // the runtime can find them next to the exe. Phase D: skills are the
  // primary way the agent receives task-specific guidance.
  let src_skills = std::path::Path::new("skills");
  if src_skills.exists() {
    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    let target_dir = std::path::Path::new("target").join(&profile);
    // For release, target_dir is target/release; for debug, target/debug
    // Either way, copy next to where the exe lands.
    let dst_skills = target_dir.join("skills");
    if let Err(e) = copy_dir_recursive(src_skills, &dst_skills) {
      eprintln!("cargo:warning=Failed to copy skills to {}: {}", dst_skills.display(), e);
    }
  }

  tauri_build::build()
}

/// Copy a directory tree (one level of files + recursive subdirs).
/// No-op if src is a file. Used for the skills bundle.
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
  if src.is_file() {
    if let Some(parent) = dst.parent() {
      std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(src, dst)?;
    return Ok(());
  }
  if !src.is_dir() {
    return Ok(());
  }
  std::fs::create_dir_all(dst)?;
  for entry in std::fs::read_dir(src)? {
    let entry = entry?;
    let file_type = entry.file_type()?;
    let src_path = entry.path();
    let dst_path = dst.join(entry.file_name());
    if file_type.is_dir() {
      copy_dir_recursive(&src_path, &dst_path)?;
    } else if file_type.is_file() {
      std::fs::copy(&src_path, &dst_path)?;
    }
  }
  Ok(())
}
