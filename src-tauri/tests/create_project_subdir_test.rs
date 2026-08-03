//! Integration tests for `create_project_subdir` (learning project folder creation).
//!
//! Regression: the Windows folder picker can return a path that does not
//! exist (user typed a new folder name, or picked a stale remembered folder).
//! The command must create missing parents recursively instead of failing
//! with "父目录不存在" after the user already picked a save location.
//!
//! The module is `#[path]`-included rather than imported via `app_lib`:
//! linking app_lib pulls in Tauri/WebView2 and the test exe fails to start
//! in some Windows environments.

#[path = "../src/learning_paths.rs"]
mod learning_paths;

use learning_paths::create_project_subdir_impl;

/// Unique temp root per test run, cleaned up by each test.
fn temp_root(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "typora-next-create-subdir-{}-{}",
        tag,
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

#[test]
fn creates_missing_parent_recursively() {
    let root = temp_root("missing-parent");
    let parent = root.join("a").join("b"); // two levels deep, neither exists

    let created = create_project_subdir_impl(parent.display().to_string(), "My Goal".to_string())
        .expect("should create missing parent instead of erroring");

    let created_path = std::path::PathBuf::from(&created);
    assert!(created_path.is_dir());
    assert_eq!(created_path.parent().unwrap(), parent);
    assert_eq!(created_path.file_name().unwrap(), "my-goal");

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn appends_numeric_suffix_on_collision() {
    let root = temp_root("collision");
    std::fs::create_dir_all(root.join("owl-web-ontology")).unwrap();

    let created =
        create_project_subdir_impl(root.display().to_string(), "owl-web-ontology".to_string())
            .expect("should succeed with suffix");

    assert!(created.ends_with("owl-web-ontology-2"));

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn errors_when_parent_is_a_file() {
    let root = temp_root("parent-is-file");
    std::fs::create_dir_all(&root).unwrap();
    let file = root.join("not-a-dir.txt");
    std::fs::write(&file, "x").unwrap();

    let err = create_project_subdir_impl(file.display().to_string(), "slug".to_string())
        .expect_err("file as parent must be rejected");

    assert!(err.contains("不是目录"), "unexpected error: {}", err);

    let _ = std::fs::remove_dir_all(&root);
}
