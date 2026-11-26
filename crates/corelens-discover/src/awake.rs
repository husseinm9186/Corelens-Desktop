//! Keeping a device's command line awake without typing into it.
//!
//! An SSH keepalive keeps the connection and any NAT in between alive, but a
//! device's own idle timer (`exec-timeout` on Cisco, its kin elsewhere)
//! counts only what arrives in the session, and logs an idle session out
//! regardless. So on each keepalive tick the session may be sent a space and
//! a backspace, which a line editor turns into nothing at all.
//!
//! The danger is the one that made the keepalive never write to the shell: a
//! keystroke landing in somebody's half-typed command, a pager, or a
//! question. So the nudge goes only when the line is a bare prompt — the last
//! thing the device printed ends in `#`, `>` or `$`, with nothing after it —
//! and nothing was typed since the last tick. Anything else on the line and
//! nothing is sent. Never a newline.

/// What is sent: a space, then a backspace that takes it away.
pub const NUDGE: &[u8] = b" \x08";

/// The longest line kept; a prompt is far shorter.
const MAX_LINE: usize = 512;

#[derive(Debug, Clone, Copy, PartialEq)]
enum Escape {
    None,
    /// After ESC.
    Start,
    /// Inside `ESC [ … final`.
    Csi,
    /// Inside `ESC ] … BEL` or `ESC ] … ESC \`.
    Osc,
}

/// Watches a session's output for a bare prompt, and says when the command
/// line may be nudged.
#[derive(Debug, Clone)]
pub struct KeepAwake {
    enabled: bool,
    /// The current last line, as the screen shows it.
    line: Vec<u8>,
    escape: Escape,
    /// Something was typed since the last tick.
    typed: bool,
}

impl KeepAwake {
    pub fn new(enabled: bool) -> Self {
        KeepAwake { enabled, line: Vec::new(), escape: Escape::None, typed: false }
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    /// Something the person sent. Their typing resets the device's timer by
    /// itself, and a tick right after it must not land in the middle of it.
    pub fn typed(&mut self) {
        self.typed = true;
    }

    /// Output from the device.
    pub fn saw(&mut self, bytes: &[u8]) {
        for &b in bytes {
            match self.escape {
                Escape::Start => {
                    self.escape = match b {
                        b'[' => Escape::Csi,
                        b']' => Escape::Osc,
                        _ => Escape::None,
                    };
                    continue;
                }
                Escape::Csi => {
                    if (0x40..=0x7e).contains(&b) {
                        self.escape = Escape::None;
                    }
                    continue;
                }
                Escape::Osc => {
                    if b == 0x07 {
                        self.escape = Escape::None;
                    } else if b == 0x1b {
                        self.escape = Escape::Start;
                    }
                    continue;
                }
                Escape::None => {}
            }
            match b {
                0x1b => self.escape = Escape::Start,
                b'\n' | b'\r' => self.line.clear(),
                0x08 => {
                    self.line.pop();
                }
                b if b < 0x20 || b == 0x7f => {}
                b => {
                    if self.line.len() >= MAX_LINE {
                        self.line.remove(0);
                    }
                    self.line.push(b);
                }
            }
        }
    }

    /// Whether the line is a bare prompt.
    pub fn at_prompt(&self) -> bool {
        let text = String::from_utf8_lossy(&self.line);
        // A trailing space after the prompt character is how some devices
        // draw it; spaces before it are part of the prompt.
        let text = text.trim_end_matches(' ');
        if text.is_empty() || text.len() > 128 {
            return false;
        }
        let lower = text.to_ascii_lowercase();
        if lower.contains("more") {
            return false;
        }
        matches!(text.chars().last(), Some('#' | '>' | '$'))
    }

    /// Called on each keepalive tick: what to send, if anything.
    pub fn nudge(&mut self) -> Option<&'static [u8]> {
        let typed = std::mem::take(&mut self.typed);
        if self.enabled && !typed && self.at_prompt() {
            Some(NUDGE)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn after(bytes: &[u8]) -> KeepAwake {
        let mut k = KeepAwake::new(true);
        k.saw(bytes);
        k
    }

    #[test]
    fn a_bare_prompt_is_nudged_with_a_space_and_a_backspace() {
        for prompt in ["\r\nLEAF-05#", "\r\nLEAF-05(config-if)#", "\r\nrouter>", "\r\nFGT-1 # ", "\r\nadmin@host:~$ "] {
            assert_eq!(after(prompt.as_bytes()).nudge(), Some(NUDGE), "{prompt:?}");
        }
    }

    #[test]
    fn a_half_typed_line_a_pager_or_a_question_is_left_alone() {
        for line in [
            "\r\nLEAF-05# show run",
            "\r\n --More-- ",
            "\r\nDestination filename [startup-config]? ",
            "\r\nProceed with reload? [confirm]",
            "\r\nPassword: ",
            "\r\nCopy complete.\r\n",
            "",
        ] {
            assert_eq!(after(line.as_bytes()).nudge(), None, "{line:?}");
        }
    }

    #[test]
    fn the_echo_of_a_nudge_leaves_the_prompt_a_prompt() {
        let mut k = after(b"\r\nLEAF-05#");
        assert!(k.nudge().is_some());
        k.saw(b" \x08 \x08");
        assert!(k.at_prompt());
        k.saw(b" ");
        k.saw(b"\x08");
        assert!(k.at_prompt());
    }

    #[test]
    fn colour_and_cursor_codes_are_not_part_of_the_line() {
        assert!(after(b"\r\n\x1b[1;32mLEAF-05\x1b[0m#\x1b[K").at_prompt());
        assert!(after(b"\x1b]0;title\x07\r\nLEAF-05#").at_prompt());
    }

    #[test]
    fn nothing_goes_on_the_tick_after_typing_or_when_switched_off() {
        let mut k = after(b"\r\nLEAF-05#");
        k.typed();
        assert_eq!(k.nudge(), None);
        assert_eq!(k.nudge(), Some(NUDGE), "the tick after is quiet again");
        k.set_enabled(false);
        assert_eq!(k.nudge(), None);
    }
}
