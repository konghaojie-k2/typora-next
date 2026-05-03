//! Plugin extension API (future implementation)

/// Plugin trait for extending editor functionality
pub trait Plugin {
    fn name(&self) -> &str;
    fn on_render(&self, html: &mut String);
    fn on_input(&self, text: &str, state: &mut crate::editor::EditorState);
}

/// Plugin registry
pub struct PluginRegistry {
    plugins: Vec<Box<dyn Plugin>>,
}

impl PluginRegistry {
    pub fn new() -> Self {
        Self { plugins: Vec::new() }
    }

    pub fn register(&mut self, plugin: Box<dyn Plugin>) {
        self.plugins.push(plugin);
    }
}