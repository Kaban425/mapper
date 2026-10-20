//! Latency statistics for spike pass/fail criteria.

#[derive(Debug, Default, Clone)]
pub struct Samples {
    values_ms: Vec<f64>,
    failures: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Summary {
    pub count: usize,
    pub failures: u32,
    pub min: f64,
    pub median: f64,
    pub p95: f64,
    pub max: f64,
}

impl Samples {
    pub fn push(&mut self, ms: f64) {
        self.values_ms.push(ms);
    }

    pub fn fail(&mut self) {
        self.failures += 1;
    }

    pub fn summary(&self) -> Option<Summary> {
        if self.values_ms.is_empty() {
            return None;
        }
        let mut sorted = self.values_ms.clone();
        sorted.sort_by(f64::total_cmp);
        Some(Summary {
            count: sorted.len(),
            failures: self.failures,
            min: sorted[0],
            median: percentile(&sorted, 0.5),
            p95: percentile(&sorted, 0.95),
            max: sorted[sorted.len() - 1],
        })
    }

    pub fn describe(&self, what: &str) -> String {
        match self.summary() {
            Some(s) => format!(
                "{what}: n={} fail={} min={:.1} med={:.1} p95={:.1} max={:.1} ms",
                s.count, s.failures, s.min, s.median, s.p95, s.max
            ),
            None => format!("{what}: no samples (fail={})", self.failures),
        }
    }
}

/// Nearest-rank percentile on an already sorted, non-empty slice.
fn percentile(sorted: &[f64], q: f64) -> f64 {
    let rank = (q * sorted.len() as f64).ceil() as usize;
    sorted[rank.clamp(1, sorted.len()) - 1]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_has_no_summary() {
        assert_eq!(Samples::default().summary(), None);
    }

    #[test]
    fn computes_nearest_rank_percentiles() {
        let mut s = Samples::default();
        for v in [5.0, 1.0, 3.0, 2.0, 4.0] {
            s.push(v);
        }
        s.fail();
        let sum = s.summary().unwrap();
        assert_eq!((sum.count, sum.failures), (5, 1));
        assert_eq!((sum.min, sum.median, sum.p95, sum.max), (1.0, 3.0, 5.0, 5.0));
    }

    #[test]
    fn single_sample_is_every_percentile() {
        let mut s = Samples::default();
        s.push(7.5);
        let sum = s.summary().unwrap();
        assert_eq!((sum.median, sum.p95), (7.5, 7.5));
    }
}
