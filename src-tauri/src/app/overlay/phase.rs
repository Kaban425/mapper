//! Overlay lifecycle as a pure function (spike S-1/S-2 rules):
//! Hidden → Activating → Active → Deactivating → Hidden. `step` decides, `super` carries out
//! the effects, so every rule here is tested without windows.

use serde::Serialize;

use crate::preset::Preset;

/// Focus attempts 30 ms apart before "click to start" (spike S-1: 49/50 on the first).
pub const FOCUS_ATTEMPTS: u32 = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Hidden,
    Activating,
    Active,
    Deactivating,
}

/// Why the overlay is about to go blank (sent to the UI with the blank request).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BlankReason {
    Exit,
    FocusLost,
    ClickTimeout,
    Quit,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct State {
    pub phase: Phase,
    pub preset: Preset,
    /// Activation number; commands and timers of an older session carry an older one.
    pub seq: u64,
    /// Number of the current blank request.
    pub blank_seq: u64,
    pub focused: bool,
    pub exit_requested: bool,
    pub quitting: bool,
}

impl Default for State {
    fn default() -> Self {
        Self {
            phase: Phase::Hidden,
            preset: Preset::Near,
            seq: 0,
            blank_seq: 0,
            focused: false,
            exit_requested: false,
            quitting: false,
        }
    }
}

impl State {
    /// The UI may save a scale or a result while its session is open, blanking, or just
    /// closed (the blank timeout can beat a slow save); never for an older session.
    pub fn may_save(&self, seq: u64) -> bool {
        seq != 0 && seq == self.seq && self.phase != Phase::Activating
    }

    /// This session is closing: the window is still shown, waiting for its blank frame.
    pub fn closing(&self, seq: u64) -> bool {
        seq == self.seq && self.phase == Phase::Deactivating
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Input {
    Hotkey(Preset),
    /// The window was placed and shown (`ok`), or there was no monitor or window for it.
    Shown {
        seq: u64,
        ok: bool,
    },
    FocusRetry {
        seq: u64,
        attempt: u32,
    },
    FocusResult {
        seq: u64,
        attempt: u32,
        ok: bool,
    },
    WindowFocus(bool),
    /// `overlay_exit`: the UI saw every key released.
    Exit {
        seq: u64,
    },
    ExitTimeout {
        seq: u64,
    },
    ClickTimeout {
        seq: u64,
    },
    /// `overlay_blank`, or its timeout.
    Blanked {
        blank_seq: u64,
    },
    Quit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Effect {
    HideHud,
    /// Remember the foreground window, place the overlay, tell the UI, show it; answers `Shown`.
    Show {
        seq: u64,
        preset: Preset,
    },
    TryFocus {
        seq: u64,
        attempt: u32,
    },
    RetryFocusLater {
        seq: u64,
        attempt: u32,
    },
    Activated {
        seq: u64,
        ok: bool,
        attempts: u32,
    },
    ClickTimeoutLater {
        seq: u64,
    },
    Focused {
        seq: u64,
    },
    SwitchPreset {
        seq: u64,
        preset: Preset,
    },
    RequestExit {
        seq: u64,
    },
    ExitTimeoutLater {
        seq: u64,
    },
    ClickThrough,
    RestoreForeground,
    ForgetForeground,
    RequestBlank {
        blank_seq: u64,
        reason: BlankReason,
    },
    BlankTimeoutLater {
        blank_seq: u64,
    },
    /// Hide the window and idle the web view; with `hud`, show what the UI handed over.
    Hide {
        hud: bool,
    },
    ExitApp,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    pub state: State,
    pub effects: Vec<Effect>,
    /// False for a stale or out-of-phase request (commands answer `stale_session`).
    pub accepted: bool,
}

fn outcome(state: State, effects: Vec<Effect>) -> Outcome {
    Outcome { state, effects, accepted: true }
}

fn ignored(s: &State) -> Outcome {
    Outcome { state: s.clone(), effects: Vec::new(), accepted: false }
}

/// Click-through at once, focus back to the game only when asked, then a blank frame.
fn deactivate(s: &State, restore: bool, reason: BlankReason) -> Outcome {
    let blank_seq = s.blank_seq + 1;
    let state = State { phase: Phase::Deactivating, blank_seq, focused: false, exit_requested: false, ..s.clone() };
    let foreground = if restore { Effect::RestoreForeground } else { Effect::ForgetForeground };
    let effects = vec![
        Effect::ClickThrough,
        foreground,
        Effect::RequestBlank { blank_seq, reason },
        Effect::BlankTimeoutLater { blank_seq },
    ];
    outcome(state, effects)
}

fn hotkey(s: &State, preset: Preset) -> Outcome {
    match s.phase {
        Phase::Hidden if s.quitting => ignored(s),
        Phase::Hidden => {
            let seq = s.seq + 1;
            let state =
                State { phase: Phase::Activating, preset, seq, focused: false, exit_requested: false, ..s.clone() };
            outcome(state, vec![Effect::HideHud, Effect::Show { seq, preset }])
        }
        // Pressed again before the overlay took focus: the player changed their mind.
        Phase::Activating => deactivate(s, true, BlankReason::Exit),
        // The other zoom's hotkey: the player is about to change the map's zoom. The UI parks
        // the route and exits once every key is released, like for the same hotkey.
        Phase::Active if preset != s.preset && !s.exit_requested => outcome(
            State { exit_requested: true, ..s.clone() },
            vec![Effect::SwitchPreset { seq: s.seq, preset }, Effect::ExitTimeoutLater { seq: s.seq }],
        ),
        // Its key-up is still on the way: the UI exits once every key is released.
        Phase::Active if !s.exit_requested => outcome(
            State { exit_requested: true, ..s.clone() },
            vec![Effect::RequestExit { seq: s.seq }, Effect::ExitTimeoutLater { seq: s.seq }],
        ),
        Phase::Active | Phase::Deactivating => ignored(s),
    }
}

/// Focus is asked for only once the window is really on screen: activating a hidden window
/// would take the focus from the game and show nothing.
fn shown(s: &State, seq: u64, ok: bool) -> Outcome {
    if s.phase != Phase::Activating || seq != s.seq {
        return ignored(s);
    }
    if ok {
        return outcome(s.clone(), vec![Effect::TryFocus { seq, attempt: 1 }]);
    }
    outcome(State { phase: Phase::Hidden, ..s.clone() }, vec![Effect::ForgetForeground])
}

fn focus_result(s: &State, seq: u64, attempt: u32, ok: bool) -> Outcome {
    if s.phase != Phase::Activating || seq != s.seq {
        return ignored(s);
    }
    if ok {
        let state = State { phase: Phase::Active, focused: true, ..s.clone() };
        return outcome(state, vec![Effect::Activated { seq, ok, attempts: attempt }]);
    }
    if attempt < FOCUS_ATTEMPTS {
        return outcome(s.clone(), vec![Effect::RetryFocusLater { seq, attempt: attempt + 1 }]);
    }
    let state = State { phase: Phase::Active, focused: false, ..s.clone() };
    outcome(state, vec![Effect::Activated { seq, ok, attempts: attempt }, Effect::ClickTimeoutLater { seq }])
}

fn window_focus(s: &State, focused: bool) -> Outcome {
    match (s.phase, focused) {
        (Phase::Active, true) if !s.focused => {
            outcome(State { focused: true, ..s.clone() }, vec![Effect::Focused { seq: s.seq }])
        }
        // The player switched away (Alt+Tab, a click elsewhere): no focus is handed back.
        (Phase::Active, false) if s.focused => deactivate(s, false, BlankReason::FocusLost),
        (Phase::Activating, _) => outcome(State { focused, ..s.clone() }, Vec::new()),
        _ => ignored(s),
    }
}

fn quit(s: &State) -> Outcome {
    let quitting = State { quitting: true, ..s.clone() };
    match s.phase {
        Phase::Hidden => outcome(quitting, vec![Effect::ExitApp]),
        Phase::Activating | Phase::Active => {
            let mut closing = deactivate(&quitting, true, BlankReason::Quit);
            closing.state.quitting = true;
            closing
        }
        Phase::Deactivating => outcome(quitting, Vec::new()),
    }
}

pub fn step(s: &State, input: Input) -> Outcome {
    let active = |seq: u64| s.phase == Phase::Active && seq == s.seq;
    match input {
        Input::Hotkey(preset) => hotkey(s, preset),
        Input::Shown { seq, ok } => shown(s, seq, ok),
        Input::FocusRetry { seq, attempt } if s.phase == Phase::Activating && seq == s.seq => {
            outcome(s.clone(), vec![Effect::TryFocus { seq, attempt }])
        }
        Input::FocusRetry { .. } => ignored(s),
        Input::FocusResult { seq, attempt, ok } => focus_result(s, seq, attempt, ok),
        Input::WindowFocus(focused) => window_focus(s, focused),
        Input::Exit { seq } if active(seq) => deactivate(s, true, BlankReason::Exit),
        Input::ExitTimeout { seq } if active(seq) && s.exit_requested => deactivate(s, true, BlankReason::Exit),
        Input::ClickTimeout { seq } if active(seq) && !s.focused => deactivate(s, false, BlankReason::ClickTimeout),
        Input::Exit { .. } | Input::ExitTimeout { .. } | Input::ClickTimeout { .. } => ignored(s),
        Input::Blanked { blank_seq } if s.phase == Phase::Deactivating && blank_seq == s.blank_seq => {
            // Quitting: the app is gone a moment later, a HUD would only flash.
            let mut effects = vec![Effect::Hide { hud: !s.quitting }];
            if s.quitting {
                effects.push(Effect::ExitApp);
            }
            outcome(State { phase: Phase::Hidden, ..s.clone() }, effects)
        }
        Input::Blanked { .. } => ignored(s),
        Input::Quit => quit(s),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(start: State, inputs: &[Input]) -> (State, Vec<Effect>) {
        inputs.iter().fold((start, Vec::new()), |(state, mut effects), input| {
            let out = step(&state, *input);
            effects.extend(out.effects);
            (out.state, effects)
        })
    }

    fn active() -> State {
        let inputs = [
            Input::Hotkey(Preset::Near),
            Input::Shown { seq: 1, ok: true },
            Input::FocusResult { seq: 1, attempt: 1, ok: true },
        ];
        run(State::default(), &inputs).0
    }

    #[test]
    fn hotkey_shows_and_focus_activates() {
        let (state, effects) = run(State::default(), &[Input::Hotkey(Preset::Far)]);
        assert_eq!(state.phase, Phase::Activating);
        assert_eq!(state.preset, Preset::Far);
        assert_eq!(effects, vec![Effect::HideHud, Effect::Show { seq: 1, preset: Preset::Far }]);
        let shown = step(&state, Input::Shown { seq: 1, ok: true });
        assert_eq!(shown.effects, vec![Effect::TryFocus { seq: 1, attempt: 1 }]);
        let out = step(&shown.state, Input::FocusResult { seq: 1, attempt: 1, ok: true });
        assert_eq!(out.state.phase, Phase::Active);
        assert!(out.state.focused);
        assert_eq!(out.effects, vec![Effect::Activated { seq: 1, ok: true, attempts: 1 }]);
    }

    #[test]
    fn no_window_on_screen_means_no_focus_request() {
        let state = run(State::default(), &[Input::Hotkey(Preset::Near)]).0;
        let out = step(&state, Input::Shown { seq: 1, ok: false });
        assert_eq!(out.state.phase, Phase::Hidden);
        assert_eq!(out.effects, vec![Effect::ForgetForeground]);
        assert!(!step(&out.state, Input::FocusResult { seq: 1, attempt: 1, ok: true }).accepted);
        assert_eq!(step(&out.state, Input::Hotkey(Preset::Near)).state.seq, 2, "the next press starts afresh");
        assert!(!step(&active(), Input::Shown { seq: 1, ok: true }).accepted, "only while activating");
    }

    #[test]
    fn focus_is_retried_then_click_to_start() {
        let mut state = run(State::default(), &[Input::Hotkey(Preset::Near)]).0;
        for attempt in 1..FOCUS_ATTEMPTS {
            let out = step(&state, Input::FocusResult { seq: 1, attempt, ok: false });
            assert_eq!(out.effects, vec![Effect::RetryFocusLater { seq: 1, attempt: attempt + 1 }]);
            let retry = step(&out.state, Input::FocusRetry { seq: 1, attempt: attempt + 1 });
            assert_eq!(retry.effects, vec![Effect::TryFocus { seq: 1, attempt: attempt + 1 }]);
            state = retry.state;
        }
        let out = step(&state, Input::FocusResult { seq: 1, attempt: FOCUS_ATTEMPTS, ok: false });
        assert_eq!(out.state.phase, Phase::Active);
        assert!(!out.state.focused);
        assert_eq!(
            out.effects,
            vec![
                Effect::Activated { seq: 1, ok: false, attempts: FOCUS_ATTEMPTS },
                Effect::ClickTimeoutLater { seq: 1 }
            ]
        );
        let (closed, effects) = run(out.state, &[Input::ClickTimeout { seq: 1 }]);
        assert_eq!(closed.phase, Phase::Deactivating);
        assert!(effects.contains(&Effect::ForgetForeground), "a click timeout does not hand focus back");
        assert!(effects.contains(&Effect::RequestBlank { blank_seq: 1, reason: BlankReason::ClickTimeout }));
    }

    #[test]
    fn a_click_that_takes_focus_cancels_the_click_timeout() {
        let state = run(
            State::default(),
            &[Input::Hotkey(Preset::Near), Input::FocusResult { seq: 1, attempt: FOCUS_ATTEMPTS, ok: false }],
        )
        .0;
        let (focused, effects) = run(state, &[Input::WindowFocus(true), Input::ClickTimeout { seq: 1 }]);
        assert_eq!(focused.phase, Phase::Active);
        assert_eq!(effects, vec![Effect::Focused { seq: 1 }]);
    }

    #[test]
    fn hotkey_while_activating_closes() {
        let state = run(State::default(), &[Input::Hotkey(Preset::Near)]).0;
        let out = step(&state, Input::Hotkey(Preset::Near));
        assert_eq!(out.state.phase, Phase::Deactivating);
        assert!(out.effects.contains(&Effect::RestoreForeground));
        let late = step(&out.state, Input::FocusResult { seq: 1, attempt: 1, ok: true });
        assert!(!late.accepted, "a late focus result of a closed session is ignored");
    }

    #[test]
    fn the_other_hotkey_asks_the_ui_to_park_the_route_and_exit() {
        let out = step(&active(), Input::Hotkey(Preset::Far));
        assert_eq!(out.state.phase, Phase::Active);
        assert_eq!(out.state.preset, Preset::Near, "the session stays on its zoom until it closes");
        assert!(out.state.exit_requested);
        assert_eq!(
            out.effects,
            vec![Effect::SwitchPreset { seq: 1, preset: Preset::Far }, Effect::ExitTimeoutLater { seq: 1 }]
        );
        assert!(!step(&out.state, Input::Hotkey(Preset::Far)).accepted, "only once");
        assert_eq!(step(&out.state, Input::ExitTimeout { seq: 1 }).state.phase, Phase::Deactivating);
    }

    #[test]
    fn the_same_hotkey_asks_the_ui_to_exit_once() {
        let (state, effects) = run(active(), &[Input::Hotkey(Preset::Near), Input::Hotkey(Preset::Near)]);
        assert!(state.exit_requested);
        assert_eq!(effects, vec![Effect::RequestExit { seq: 1 }, Effect::ExitTimeoutLater { seq: 1 }]);
        let exited = step(&state, Input::Exit { seq: 1 });
        assert!(exited.accepted);
        assert_eq!(exited.state.phase, Phase::Deactivating);
        assert!(exited.effects.contains(&Effect::RestoreForeground));
    }

    #[test]
    fn the_exit_timeout_fires_only_for_a_pending_request() {
        assert!(!step(&active(), Input::ExitTimeout { seq: 1 }).accepted);
        let requested = step(&active(), Input::Hotkey(Preset::Near)).state;
        assert_eq!(step(&requested, Input::ExitTimeout { seq: 1 }).state.phase, Phase::Deactivating);
    }

    #[test]
    fn stale_or_early_commands_are_rejected() {
        assert!(!step(&active(), Input::Exit { seq: 7 }).accepted);
        assert!(!step(&State::default(), Input::Exit { seq: 0 }).accepted);
        assert!(!step(&active(), Input::Blanked { blank_seq: 1 }).accepted, "nothing to blank yet");
    }

    #[test]
    fn losing_focus_closes_without_handing_focus_back() {
        let out = step(&active(), Input::WindowFocus(false));
        assert_eq!(out.state.phase, Phase::Deactivating);
        assert_eq!(
            out.effects,
            vec![
                Effect::ClickThrough,
                Effect::ForgetForeground,
                Effect::RequestBlank { blank_seq: 1, reason: BlankReason::FocusLost },
                Effect::BlankTimeoutLater { blank_seq: 1 },
            ]
        );
    }

    #[test]
    fn blank_ack_hides_once() {
        let closing = step(&active(), Input::Exit { seq: 1 }).state;
        let hidden = step(&closing, Input::Blanked { blank_seq: 1 });
        assert_eq!(hidden.state.phase, Phase::Hidden);
        assert_eq!(hidden.effects, vec![Effect::Hide { hud: true }]);
        assert!(!step(&hidden.state, Input::Blanked { blank_seq: 1 }).accepted, "the timeout after the ack is a no-op");
    }

    #[test]
    fn a_new_session_gets_a_new_number() {
        let closing = step(&active(), Input::Exit { seq: 1 }).state;
        let hidden = step(&closing, Input::Blanked { blank_seq: 1 }).state;
        let again = step(&hidden, Input::Hotkey(Preset::Near));
        assert_eq!(again.state.seq, 2);
        assert!(closing.may_save(1) && closing.closing(1), "a blanking session may still save");
        assert!(hidden.may_save(1), "a save that lost the race with the blank timeout still counts");
        assert!(!hidden.closing(1));
        assert!(!again.state.may_save(1), "an older session never");
        assert!(!again.state.may_save(2), "nothing to save before the session is active");
        assert!(!State::default().may_save(0));
    }

    #[test]
    fn quitting_closes_the_overlay_first() {
        assert_eq!(step(&State::default(), Input::Quit).effects, vec![Effect::ExitApp]);
        let (state, effects) = run(active(), &[Input::Quit]);
        assert!(state.quitting);
        assert!(effects.contains(&Effect::RestoreForeground));
        assert!(effects.contains(&Effect::RequestBlank { blank_seq: 1, reason: BlankReason::Quit }));
        let done = step(&state, Input::Blanked { blank_seq: 1 });
        assert_eq!(done.effects, vec![Effect::Hide { hud: false }, Effect::ExitApp], "no HUD flash on exit");
        assert!(!step(&done.state, Input::Hotkey(Preset::Near)).accepted, "no new session while quitting");
    }

    #[test]
    fn hotkeys_are_ignored_while_deactivating() {
        let closing = step(&active(), Input::Exit { seq: 1 }).state;
        assert!(!step(&closing, Input::Hotkey(Preset::Near)).accepted);
    }
}
