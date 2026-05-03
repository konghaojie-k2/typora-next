//! Typora-Next: A WYSIWYG markdown editor with extended syntax support

mod core;
mod editor;

use std::env;
use std::fs;
use std::path::Path;
use std::process;

use crate::core::parser::parse_markdown;
use crate::core::renderer::{render_html_document, render_markdown_with_math};

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 4 || args[1] != "render" {
        print_usage(&args[0]);
        process::exit(1);
    }

    let input_path = &args[2];
    let output_path = &args[3];

    // Validate input file exists
    if !Path::new(input_path).exists() {
        eprintln!("Error: Input file '{}' does not exist", input_path);
        process::exit(1);
    }

    // Read input markdown file
    let markdown_content = match fs::read_to_string(input_path) {
        Ok(content) => content,
        Err(e) => {
            eprintln!("Error reading input file '{}': {}", input_path, e);
            process::exit(1);
        }
    };

    // Check if math rendering is requested (via --math flag or auto-detect)
    let use_math = args.iter().any(|arg| arg == "--math")
        || contains_math(&markdown_content);

    // Render with appropriate method
    let html_output = if use_math {
        render_markdown_with_math(&markdown_content)
    } else {
        // Parse markdown to events
        let events = parse_markdown(&markdown_content);
        // Render to complete HTML document
        render_html_document(&events)
    };

    // Write output HTML file
    match fs::write(output_path, html_output) {
        Ok(_) => {
            println!("Successfully rendered '{}' -> '{}'", input_path, output_path);
            if use_math {
                println!("Math formula rendering enabled (KaTeX)");
            }
        }
        Err(e) => {
            eprintln!("Error writing output file '{}': {}", output_path, e);
            process::exit(1);
        }
    }
}

/// Check if content contains math formulas
fn contains_math(content: &str) -> bool {
    // Check for inline math $...$ or block math $$...$$
    let has_inline = content.split('\n').any(|line| {
        let dollar_count = line.matches('$').count();
        dollar_count >= 2 && !line.contains("$$") // Single $ pairs (not $$)
    });
    let has_block = content.contains("$$");
    has_inline || has_block
}

fn print_usage(program_name: &str) {
    println!("Usage: {} render <input.md> <output.html> [--math]", program_name);
    println!();
    println!("Commands:");
    println!("  render    Render a markdown file to HTML");
    println!();
    println!("Arguments:");
    println!("  input.md     Path to the input markdown file");
    println!("  output.html  Path to the output HTML file");
    println!("  --math       Force enable math formula rendering (auto-detected by default)");
    println!();
    println!("Features:");
    println!("  - Full GFM markdown support (tables, strikethrough, task lists)");
    println!("  - Syntax highlighting with Prism.js");
    println!("  - Math formula rendering with KaTeX (auto-detected)");
    println!();
    println!("Examples:");
    println!("  {} render input.md output.html", program_name);
    println!("  {} render math.md math.html --math", program_name);
}