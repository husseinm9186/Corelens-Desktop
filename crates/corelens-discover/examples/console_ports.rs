//! Lists this machine's serial ports the way the terminal's Console button
//! sees them, and says which one it would open without asking. Opens
//! nothing and sends nothing.
//!
//!     cargo run -p corelens-discover --example console_ports
fn main() {
    match corelens_discover::console::ports() {
        Err(e) => eprintln!("{e}"),
        Ok(ports) => {
            if ports.is_empty() {
                println!("No serial ports.");
            }
            for p in &ports {
                println!(
                    "{}{}  {:?}  {}",
                    if p.likely_console { "* " } else { "  " },
                    p.name,
                    p.kind,
                    p.description
                );
            }
            match corelens_discover::console::chosen(&ports) {
                Some(p) => println!("\nConsole would open {} without asking.", p.name),
                None => println!("\nConsole would ask: there is not exactly one USB serial adapter."),
            }
        }
    }
}
