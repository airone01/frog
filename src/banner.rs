// banner.rs - Being cool is important.
use colored::Colorize;
use palette::{Gradient, LinSrgb, Srgb};

const BANNER: &str = r#"       _ _
    __| (_)___ _ __
   / _` | / -_) '  \
   \__,_|_\___|_|_|_|
 Diem Is an Env Manager"#;

fn create_gradient_line(width: usize, color1: LinSrgb, color2: LinSrgb) -> String {
    let gradient = Gradient::new(vec![color1, color2]);

    let line: String = (0..width)
        .map(|i| {
            let color = gradient.get(i as f32 / width as f32);
            let rgb = Srgb::from_linear(color).into_components();
            format!(
                "\x1b[38;2;{};{};{}m▀\x1b[0m",
                (rgb.0 * 255.0) as u8,
                (rgb.1 * 255.0) as u8,
                (rgb.2 * 255.0) as u8
            )
        })
        .collect();

    line
}

pub fn print_banner() {
    // Define gradient colors
    let purple = LinSrgb::new(0.353, 0.271, 0.996); // #5A45FE
    let blue = LinSrgb::new(0.0, 0.478, 1.0); // #007AFF

    // Print banner with blue color
    for line in BANNER.lines() {
        println!("{}", line.bright_blue());
    }

    // Print bottom gradient
    println!("{}", create_gradient_line(24, blue, purple));
}
