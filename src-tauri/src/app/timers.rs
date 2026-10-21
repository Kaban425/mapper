//! One timer thread for the whole app (replaces the spike's thread-per-timer). Tasks run on
//! this thread; anything touching windows hops to the main thread with `run_on_main_thread`
//! and re-checks its session number there.

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};
use std::io;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

type Task = Box<dyn FnOnce() + Send>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct TimerId(u64);

#[derive(PartialEq, Eq, PartialOrd, Ord)]
struct Key {
    due: Instant,
    id: u64,
}

#[derive(Default)]
struct State {
    queue: BinaryHeap<Reverse<Key>>,
    tasks: HashMap<u64, Task>,
    next_id: u64,
    stopped: bool,
}

struct Shared {
    state: Mutex<State>,
    wake: Condvar,
}

#[derive(Clone)]
pub struct Timers {
    shared: Arc<Shared>,
}

impl Timers {
    pub fn start() -> io::Result<Self> {
        let shared = Arc::new(Shared { state: Mutex::new(State::default()), wake: Condvar::new() });
        let worker = Arc::clone(&shared);
        thread::Builder::new().name("mapper-timers".into()).spawn(move || run(&worker))?;
        Ok(Self { shared })
    }

    pub fn schedule(&self, delay: Duration, task: impl FnOnce() + Send + 'static) -> TimerId {
        let mut state = self.lock();
        state.next_id += 1;
        let id = state.next_id;
        state.queue.push(Reverse(Key { due: Instant::now() + delay, id }));
        state.tasks.insert(id, Box::new(task));
        self.shared.wake.notify_one();
        TimerId(id)
    }

    /// Returns false when the task already ran or was cancelled.
    pub fn cancel(&self, id: TimerId) -> bool {
        self.lock().tasks.remove(&id.0).is_some()
    }

    pub fn stop(&self) {
        let mut state = self.lock();
        state.stopped = true;
        state.tasks.clear();
        self.shared.wake.notify_one();
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.shared.state.lock().unwrap_or_else(|e| e.into_inner())
    }
}

fn run(shared: &Shared) {
    let mut state = shared.state.lock().unwrap_or_else(|e| e.into_inner());
    loop {
        if state.stopped {
            return;
        }
        let now = Instant::now();
        let due = state.queue.peek().map(|Reverse(key)| key.due);
        match due {
            None => state = shared.wake.wait(state).unwrap_or_else(|e| e.into_inner()),
            Some(due) if due > now => {
                state = shared.wake.wait_timeout(state, due - now).unwrap_or_else(|e| e.into_inner()).0;
            }
            Some(_) => {
                let Some(Reverse(key)) = state.queue.pop() else { continue };
                // Cancelled timers leave their key behind; it is skipped here.
                if let Some(task) = state.tasks.remove(&key.id) {
                    drop(state);
                    task();
                    state = shared.state.lock().unwrap_or_else(|e| e.into_inner());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    const WAIT: Duration = Duration::from_secs(2);

    #[test]
    fn runs_tasks_in_due_order() {
        let timers = Timers::start().unwrap();
        let (tx, rx) = mpsc::channel();
        // 200 ms apart, so a slow CI runner cannot reorder them between the schedule calls.
        for (delay, label) in [(450, "c"), (50, "a"), (250, "b")] {
            let tx = tx.clone();
            timers.schedule(Duration::from_millis(delay), move || tx.send(label).unwrap());
        }
        let order: Vec<_> = (0..3).map(|_| rx.recv_timeout(WAIT).unwrap()).collect();
        assert_eq!(order, ["a", "b", "c"]);
        timers.stop();
    }

    #[test]
    fn cancelled_task_never_runs() {
        let timers = Timers::start().unwrap();
        let (tx, rx) = mpsc::channel();
        let tx2 = tx.clone();
        // The cancelled task is due well after the kept one, so cancel always wins the race.
        let cancelled = timers.schedule(Duration::from_millis(500), move || tx2.send("cancelled").unwrap());
        timers.schedule(Duration::from_millis(50), move || tx.send("kept").unwrap());
        assert!(timers.cancel(cancelled));
        assert!(!timers.cancel(cancelled), "second cancel reports nothing to cancel");
        assert_eq!(rx.recv_timeout(WAIT).unwrap(), "kept");
        assert!(rx.recv_timeout(Duration::from_millis(700)).is_err());
        timers.stop();
    }

    #[test]
    fn earlier_task_scheduled_later_still_runs_first() {
        let timers = Timers::start().unwrap();
        let (tx, rx) = mpsc::channel();
        let tx2 = tx.clone();
        timers.schedule(Duration::from_millis(500), move || tx2.send("late").unwrap());
        thread::sleep(Duration::from_millis(20));
        timers.schedule(Duration::from_millis(10), move || tx.send("early").unwrap());
        assert_eq!(rx.recv_timeout(WAIT).unwrap(), "early");
        assert_eq!(rx.recv_timeout(WAIT).unwrap(), "late");
        timers.stop();
    }
}
