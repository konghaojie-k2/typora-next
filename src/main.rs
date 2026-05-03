//! Typora-Next: A WYSIWYG markdown editor with extended syntax support

mod core;
mod editor;

use std::env;
use std::fs;
use std::path::Path;
use std::process;

use crate::core::parser::parse_markdown;
use crate::core::renderer::render_html_document;

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

    // Parse markdown to events
    let events = parse_markdown(&markdown_content);

    // Render to complete HTML document
    let html_output = render_html_document(&events);

    // Write output HTML file
    match fs::write(output_path, html_output) {
        Ok(_) => {
            println!("Successfully rendered '{}' -> '{}'", input_path, output_path);
        }
        Err(e) => {
            eprintln!("Error writing output file '{}': {}", output_path, e);
            process::exit(1);
        }
    }
}

fn print_usage(program_name: &str) {
    println!("Usage: {} render <input.md> <output.html>", program_name);
    println!();
    println!("Commands:");
    println!("  render    Render a markdown file to HTML");
    println!();
    println!("Arguments:");
    println!("  input.md     Path to the input markdown file");
    println!("  output.html  Path to the output HTML file");
    println!();
    println!("Examples:");
    println!("  {} render input.md output.html", program_name);
    println!("  {} render sample.md sample.html", program_name);
}