//! Spike S-2: show/hide the overlay N times and measure how fast a new frame appears.
//! The overlay stays click-through and never takes focus during the test.

use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};

use tauri::AppHandle;

use crate::log;
use crate::overlay::{self, CycleAck, HudPayload};
use crate::stats::Samples;

const UI_WARMUP: Duration = Duration::from_millis(2000);
const PAINT_TIMEOUT: Duration = Duration::from_millis(1000);
const BLANK_TIMEOUT: Duration = Duration::from_millis(500);
const PAUSE_BETWEEN: Duration = Duration::from_millis(120);

pub fn start(app: AppHandle, count: u32, exit_after: bool) {
    let (tx, rx) = mpsc::channel();
    if !overlay::begin_cycle(&app, tx) {
        log::line("S-2 not started: overlay is busy or a test is already running");
        return;
    }
    thread::spawn(move || {
        thread::sleep(UI_WARMUP);
        let mode = overlay::mode(&app);
        log::line(format!("S-2 start: {count} cycles, rest mode {mode:?}"));
        let mut show = Samples::default();
        let mut blank = Samples::default();
        for seq in 1..=u64::from(count) {
            run_cycle(&app, &rx, seq, &mut show, &mut blank);
            thread::sleep(PAUSE_BETWEEN);
        }
        overlay::end_cycle(&app);
        let lines = vec![
            format!("mode {mode:?}"),
            show.describe("show→painted"),
            blank.describe("blank ack"),
        ];
        for line in &lines {
            log::line(format!("S-2 result: {line}"));
        }
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let payload = HudPayload { title: "S-2 готов".into(), lines, tone: "info".into() };
            overlay::show_hud(&handle, payload, false);
        });
        if exit_after {
            thread::sleep(Duration::from_millis(800));
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || handle.exit(0));
        }
    });
}

fn run_cycle(app: &AppHandle, rx: &Receiver<CycleAck>, seq: u64, show: &mut Samples, blank: &mut Samples) {
    let shown_at = Instant::now();
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || overlay::cycle_show(&handle, seq));
    match wait_for(rx, PAINT_TIMEOUT, |ack| matches!(ack, CycleAck::Painted(s, _) if *s == seq)) {
        Some(CycleAck::Painted(_, at)) => show.push(ms_between(shown_at, at)),
        _ => show.fail(),
    }

    let blank_at = Instant::now();
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || overlay::cycle_blank(&handle, seq));
    match wait_for(rx, BLANK_TIMEOUT, |ack| matches!(ack, CycleAck::Blanked(s, _) if *s == seq)) {
        Some(CycleAck::Blanked(_, at)) => blank.push(ms_between(blank_at, at)),
        _ => blank.fail(),
    }

    let handle = app.clone();
    let _ = app.run_on_main_thread(move || overlay::cycle_conceal(&handle));
}

fn wait_for(rx: &Receiver<CycleAck>, timeout: Duration, wanted: impl Fn(&CycleAck) -> bool) -> Option<CycleAck> {
    let deadline = Instant::now() + timeout;
    loop {
        let left = deadline.checked_duration_since(Instant::now())?;
        match rx.recv_timeout(left) {
            Ok(ack) if wanted(&ack) => return Some(ack),
            Ok(_) => continue, // late ack from a previous cycle
            Err(_) => return None,
        }
    }
}

fn ms_between(from: Instant, to: Instant) -> f64 {
    to.saturating_duration_since(from).as_secs_f64() * 1000.0
}
