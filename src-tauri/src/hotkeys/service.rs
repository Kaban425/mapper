//! Global hotkeys through RegisterHotKey only (no hooks, no raw input, no key polling).
//!
//! RegisterHotKey binds to the calling thread, so one `mapper-hotkeys` thread owns every
//! registration. Other threads send it requests and wake it with WM_APP. The replace /
//! rollback / suspend rules live in `Bindings`, which is tested with a fake `Registrar`.

use std::io;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::spec::{self, HotkeySpec};
use crate::platform::win::hotkey::{self as win, Event, Queue, Win32Registrar};
use crate::preset::Preset;

const IDS: [i32; 2] = [1, 2];
/// Test registration of a new combination before replacing the working one.
const PROBE_ID: i32 = 0xBFFF;
const REPLY_TIMEOUT: Duration = Duration::from_secs(2);

pub trait Registrar {
    /// Err carries the Windows error text (usually "Hot key is already registered").
    fn register(&mut self, id: i32, spec: HotkeySpec) -> Result<(), String>;
    fn unregister(&mut self, id: i32);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StatusError {
    /// Another program owns the combination.
    Busy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyStatus {
    pub accelerator: String,
    pub registered: bool,
    /// Absent rather than `null`: the TypeScript side declares `error?: ...` (eng §4).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<StatusError>,
}

/// Both presets and whether they are paused for the hotkey recorder (`AppSnapshot.hotkeys`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HotkeysState {
    pub near: HotkeyStatus,
    pub far: HotkeyStatus,
    pub suspended: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HotkeyError {
    Busy,
    /// Both presets would share one combination.
    Conflict,
    /// The hotkey thread did not answer.
    Unavailable,
}

/// Registration state of the two presets. Pure logic over a `Registrar`.
pub struct Bindings<R: Registrar> {
    registrar: R,
    wanted: [HotkeySpec; 2],
    registered: [bool; 2],
    failed: [bool; 2],
    suspended: bool,
}

impl<R: Registrar> Bindings<R> {
    pub fn new(registrar: R, wanted: [HotkeySpec; 2]) -> Self {
        Self { registrar, wanted, registered: [false; 2], failed: [false; 2], suspended: false }
    }

    pub fn register_all(&mut self) -> [HotkeyStatus; 2] {
        for preset in Preset::ALL {
            self.try_register(preset);
        }
        self.statuses()
    }

    fn try_register(&mut self, preset: Preset) {
        let i = preset.index();
        if self.registered[i] || self.suspended {
            return;
        }
        let ok = self.registrar.register(IDS[i], self.wanted[i]).is_ok();
        self.registered[i] = ok;
        self.failed[i] = !ok;
    }

    pub fn set(&mut self, preset: Preset, spec: HotkeySpec) -> Result<HotkeyStatus, HotkeyError> {
        let i = preset.index();
        if spec == self.wanted[preset.other().index()] {
            return Err(HotkeyError::Conflict);
        }
        // The same combination: nothing to do while it works, or while paused and not known to be
        // busy. A busy one is probed again, so "free" is never said of a combination that is not.
        if spec == self.wanted[i] && (self.registered[i] || (self.suspended && !self.failed[i])) {
            return Ok(self.status(preset));
        }
        self.registrar.register(PROBE_ID, spec).map_err(|_| HotkeyError::Busy)?;
        self.registrar.unregister(PROBE_ID);
        if self.suspended {
            // The probe just showed the new combination is free; an old "busy" no longer applies.
            self.wanted[i] = spec;
            self.failed[i] = false;
            return Ok(self.status(preset));
        }
        if self.registered[i] {
            self.registrar.unregister(IDS[i]);
        }
        if self.registrar.register(IDS[i], spec).is_ok() {
            self.wanted[i] = spec;
            self.registered[i] = true;
            self.failed[i] = false;
            return Ok(self.status(preset));
        }
        // Lost a race with another program: put the old combination back.
        self.registered[i] = self.registrar.register(IDS[i], self.wanted[i]).is_ok();
        self.failed[i] = !self.registered[i];
        Err(HotkeyError::Busy)
    }

    /// Both presets at once ("Defaults"): one at a time could collide with the other's current
    /// combination when the two are swapped. All or nothing: a busy one keeps the old pair.
    pub fn set_both(&mut self, specs: [HotkeySpec; 2]) -> Result<(), HotkeyError> {
        if specs[0] == specs[1] {
            return Err(HotkeyError::Conflict);
        }
        let old = self.wanted;
        self.unregister_all();
        for spec in specs {
            if self.registrar.register(PROBE_ID, spec).is_err() {
                self.wanted = old;
                self.register_all();
                return Err(HotkeyError::Busy);
            }
            self.registrar.unregister(PROBE_ID);
        }
        self.wanted = specs;
        self.failed = [false; 2];
        self.register_all();
        Ok(())
    }

    /// While a new hotkey is being recorded nothing of ours may react to keys.
    pub fn suspend(&mut self) {
        self.unregister_all();
        self.suspended = true;
    }

    pub fn resume(&mut self) -> [HotkeyStatus; 2] {
        self.suspended = false;
        self.register_all()
    }

    pub fn retry_failed(&mut self) -> [HotkeyStatus; 2] {
        self.register_all()
    }

    pub fn unregister_all(&mut self) {
        for preset in Preset::ALL {
            let i = preset.index();
            if self.registered[i] {
                self.registrar.unregister(IDS[i]);
                self.registered[i] = false;
            }
        }
    }

    pub fn is_active(&self, id: i32) -> Option<Preset> {
        if self.suspended {
            return None;
        }
        Preset::ALL.into_iter().find(|p| IDS[p.index()] == id && self.registered[p.index()])
    }

    pub fn status(&self, preset: Preset) -> HotkeyStatus {
        let i = preset.index();
        HotkeyStatus {
            accelerator: spec::format(self.wanted[i]),
            registered: self.registered[i],
            error: self.failed[i].then_some(StatusError::Busy),
        }
    }

    pub fn statuses(&self) -> [HotkeyStatus; 2] {
        [self.status(Preset::Near), self.status(Preset::Far)]
    }

    pub fn state(&self) -> HotkeysState {
        let [near, far] = self.statuses();
        HotkeysState { near, far, suspended: self.suspended }
    }
}

enum Request {
    Set(Preset, HotkeySpec, Sender<Result<HotkeyStatus, HotkeyError>>),
    SetBoth([HotkeySpec; 2], Sender<Result<(), HotkeyError>>),
    Suspend(Sender<HotkeysState>),
    Resume(Sender<HotkeysState>),
    RetryFailed(Sender<HotkeysState>),
    State(Sender<HotkeysState>),
}

pub struct HotkeyService {
    requests: Sender<Request>,
    queue: Queue,
    join: Mutex<Option<JoinHandle<()>>>,
}

impl HotkeyService {
    pub fn start(
        wanted: [HotkeySpec; 2],
        on_press: impl Fn(Preset, Instant) + Send + 'static,
    ) -> io::Result<(Self, [HotkeyStatus; 2])> {
        let (requests, inbox) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        let join = thread::Builder::new()
            .name("mapper-hotkeys".into())
            .spawn(move || run(wanted, &inbox, on_press, &ready_tx))?;
        let (queue, statuses) =
            ready_rx.recv().map_err(|_| io::Error::other("hotkey thread exited before registering"))?;
        Ok((Self { requests, queue, join: Mutex::new(Some(join)) }, statuses))
    }

    pub fn set(&self, preset: Preset, spec: HotkeySpec) -> Result<HotkeyStatus, HotkeyError> {
        self.ask(|reply| Request::Set(preset, spec, reply)).unwrap_or(Err(HotkeyError::Unavailable))
    }

    pub fn set_both(&self, specs: [HotkeySpec; 2]) -> Result<(), HotkeyError> {
        self.ask(|reply| Request::SetBoth(specs, reply)).unwrap_or(Err(HotkeyError::Unavailable))
    }

    pub fn suspend(&self) -> Option<HotkeysState> {
        self.ask(Request::Suspend)
    }

    pub fn resume(&self) -> Option<HotkeysState> {
        self.ask(Request::Resume)
    }

    pub fn retry_failed(&self) -> Option<HotkeysState> {
        self.ask(Request::RetryFailed)
    }

    pub fn state(&self) -> Option<HotkeysState> {
        self.ask(Request::State)
    }

    fn ask<T>(&self, make: impl FnOnce(Sender<T>) -> Request) -> Option<T> {
        let (reply, answer) = mpsc::channel();
        self.requests.send(make(reply)).ok()?;
        self.queue.wake();
        answer.recv_timeout(REPLY_TIMEOUT).ok()
    }

    /// Unregisters everything and joins the thread. Called on app exit; a second call does
    /// nothing, so no message is posted to a thread id that may already be reused.
    pub fn shutdown(&self) {
        let Some(join) = self.join.lock().unwrap_or_else(|e| e.into_inner()).take() else { return };
        self.queue.quit();
        let _ = join.join();
    }
}

fn run(
    wanted: [HotkeySpec; 2],
    inbox: &Receiver<Request>,
    on_press: impl Fn(Preset, Instant),
    ready: &Sender<(Queue, [HotkeyStatus; 2])>,
) {
    let queue = win::current_thread_queue();
    let mut bindings = Bindings::new(Win32Registrar, wanted);
    if ready.send((queue, bindings.register_all())).is_err() {
        return;
    }
    loop {
        match win::wait_event() {
            Event::Hotkey(id, at) => {
                if let Some(preset) = bindings.is_active(id) {
                    on_press(preset, at);
                }
            }
            Event::Wake => {
                while let Ok(request) = inbox.try_recv() {
                    handle(&mut bindings, request);
                }
            }
            Event::Quit => break,
        }
    }
    bindings.unregister_all();
}

fn handle<R: Registrar>(bindings: &mut Bindings<R>, request: Request) {
    match request {
        Request::Set(preset, spec, reply) => {
            let _ = reply.send(bindings.set(preset, spec));
        }
        Request::SetBoth(specs, reply) => {
            let _ = reply.send(bindings.set_both(specs));
        }
        Request::Suspend(reply) => {
            bindings.suspend();
            let _ = reply.send(bindings.state());
        }
        Request::Resume(reply) => {
            bindings.resume();
            let _ = reply.send(bindings.state());
        }
        Request::RetryFailed(reply) => {
            bindings.retry_failed();
            let _ = reply.send(bindings.state());
        }
        Request::State(reply) => {
            let _ = reply.send(bindings.state());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};

    /// Simulates Windows: a combination can be held by one id, or by another program.
    #[derive(Default)]
    struct FakeRegistrar {
        held: HashMap<i32, HotkeySpec>,
        other_programs: HashSet<HotkeySpec>,
        /// One-shot failures: another program grabs the combination right after our probe.
        fail_next: HashSet<(i32, HotkeySpec)>,
    }

    impl Registrar for FakeRegistrar {
        fn register(&mut self, id: i32, spec: HotkeySpec) -> Result<(), String> {
            if self.fail_next.remove(&(id, spec)) {
                return Err("Hot key is already registered".into());
            }
            let taken = self.other_programs.contains(&spec) || self.held.values().any(|s| *s == spec);
            if taken || self.held.contains_key(&id) {
                return Err("Hot key is already registered".into());
            }
            self.held.insert(id, spec);
            Ok(())
        }

        fn unregister(&mut self, id: i32) {
            self.held.remove(&id);
        }
    }

    fn key(text: &str) -> HotkeySpec {
        spec::parse(text).unwrap()
    }

    fn bindings(busy: &[&str]) -> Bindings<FakeRegistrar> {
        let registrar = FakeRegistrar { other_programs: busy.iter().map(|t| key(t)).collect(), ..Default::default() };
        Bindings::new(registrar, [key("Alt+Q"), key("Alt+W")])
    }

    #[test]
    fn registers_both_defaults() {
        let mut b = bindings(&[]);
        let statuses = b.register_all();
        assert!(statuses.iter().all(|s| s.registered && s.error.is_none()));
        assert_eq!(statuses[0].accelerator, "Alt+Q");
        assert_eq!(b.is_active(1), Some(Preset::Near));
        assert_eq!(b.is_active(2), Some(Preset::Far));
    }

    #[test]
    fn busy_default_is_reported_and_retried() {
        let mut b = bindings(&["Alt+W"]);
        let statuses = b.register_all();
        assert!(statuses[0].registered);
        assert_eq!(statuses[1].error, Some(StatusError::Busy));
        assert_eq!(b.is_active(2), None);
        b.registrar.other_programs.clear();
        assert!(b.retry_failed()[1].registered);
    }

    #[test]
    fn set_replaces_and_frees_the_old_combination() {
        let mut b = bindings(&[]);
        b.register_all();
        let status = b.set(Preset::Near, key("Ctrl+F8")).unwrap();
        assert_eq!(status.accelerator, "Ctrl+F8");
        assert!(status.registered);
        assert_eq!(b.registrar.held.get(&1), Some(&key("Ctrl+F8")));
        assert!(!b.registrar.held.contains_key(&PROBE_ID), "probe is released");
    }

    #[test]
    fn busy_combination_keeps_the_old_one() {
        let mut b = bindings(&["Ctrl+F8"]);
        b.register_all();
        assert_eq!(b.set(Preset::Near, key("Ctrl+F8")), Err(HotkeyError::Busy));
        assert_eq!(b.registrar.held.get(&1), Some(&key("Alt+Q")));
        assert!(b.status(Preset::Near).registered);
    }

    #[test]
    fn presets_cannot_share_a_combination() {
        let mut b = bindings(&[]);
        b.register_all();
        assert_eq!(b.set(Preset::Near, key("Alt+W")), Err(HotkeyError::Conflict));
    }

    #[test]
    fn same_combination_again_is_a_no_op() {
        let mut b = bindings(&[]);
        b.register_all();
        assert!(b.set(Preset::Far, key("Alt+W")).unwrap().registered);
    }

    #[test]
    fn suspend_releases_everything_until_resume() {
        let mut b = bindings(&[]);
        b.register_all();
        b.suspend();
        assert!(b.registrar.held.is_empty());
        assert_eq!(b.is_active(1), None);
        let changed = b.set(Preset::Near, key("Ctrl+F9")).unwrap();
        assert!(!changed.registered, "nothing registers while suspended");
        let statuses = b.resume();
        assert!(statuses.iter().all(|s| s.registered));
        assert_eq!(b.registrar.held.get(&1), Some(&key("Ctrl+F9")));
    }

    #[test]
    fn lost_race_restores_the_old_combination() {
        let mut b = bindings(&[]);
        b.register_all();
        b.registrar.fail_next.insert((1, key("Ctrl+F8")));
        assert_eq!(b.set(Preset::Near, key("Ctrl+F8")), Err(HotkeyError::Busy));
        assert_eq!(b.registrar.held.get(&1), Some(&key("Alt+Q")));
        assert_eq!(b.status(Preset::Near), HotkeyStatus { accelerator: "Alt+Q".into(), registered: true, error: None });
    }

    #[test]
    fn lost_race_can_lose_the_old_combination_too() {
        let mut b = bindings(&[]);
        b.register_all();
        b.registrar.fail_next.extend([(1, key("Ctrl+F8")), (1, key("Alt+Q"))]);
        assert_eq!(b.set(Preset::Near, key("Ctrl+F8")), Err(HotkeyError::Busy));
        let status = b.status(Preset::Near);
        assert!(!status.registered);
        assert_eq!(status.error, Some(StatusError::Busy));
        assert_eq!(b.is_active(1), None);
    }

    #[test]
    fn changing_a_busy_hotkey_while_suspended_clears_busy() {
        let mut b = bindings(&["Alt+W"]);
        b.register_all();
        b.suspend();
        let status = b.set(Preset::Far, key("Ctrl+F9")).unwrap();
        assert_eq!(status.error, None, "the probe showed Ctrl+F9 is free");
    }

    #[test]
    fn a_busy_combination_recorded_again_is_probed_not_called_free() {
        let mut b = bindings(&["Alt+W"]);
        b.register_all();
        b.suspend();
        assert_eq!(b.set(Preset::Far, key("Alt+W")), Err(HotkeyError::Busy));
        b.registrar.other_programs.clear();
        assert_eq!(b.set(Preset::Far, key("Alt+W")).unwrap().error, None, "released meanwhile");
    }

    #[test]
    fn defaults_come_back_even_when_swapped() {
        let mut b = Bindings::new(FakeRegistrar::default(), [key("Alt+W"), key("Alt+Q")]);
        b.register_all();
        assert_eq!(b.set_both([key("Alt+Q"), key("Alt+W")]), Ok(()));
        assert_eq!(b.registrar.held.get(&1), Some(&key("Alt+Q")));
        assert_eq!(b.registrar.held.get(&2), Some(&key("Alt+W")));
        assert!(!b.registrar.held.contains_key(&PROBE_ID));
    }

    #[test]
    fn defaults_are_all_or_nothing() {
        let mut b = Bindings::new(FakeRegistrar::default(), [key("F7"), key("F8")]);
        b.register_all();
        b.registrar.other_programs.insert(key("Alt+W"));
        assert_eq!(b.set_both([key("Alt+Q"), key("Alt+W")]), Err(HotkeyError::Busy));
        assert_eq!(b.registrar.held.get(&1), Some(&key("F7")), "the old pair is back");
        assert_eq!(b.registrar.held.get(&2), Some(&key("F8")));
        assert_eq!(b.set_both([key("F9"), key("F9")]), Err(HotkeyError::Conflict));
    }

    #[test]
    fn status_without_error_omits_the_field() {
        let json = serde_json::to_value(HotkeyStatus { accelerator: "Alt+Q".into(), registered: true, error: None });
        assert_eq!(json.unwrap(), serde_json::json!({ "accelerator": "Alt+Q", "registered": true }));
    }
}
