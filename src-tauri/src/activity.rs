use std::thread::Thread;
use std::time::{Duration, Instant};

const SCREEN_SAMPLE_MAX_AGE: Duration = Duration::from_secs(10);

/// A known screen state replaces input/media detection. Fullscreen breaks always win.
pub fn resolve_active(input: bool, media: bool, screen: Option<bool>, fullscreen: bool) -> bool {
    !fullscreen && screen.unwrap_or(input || media)
}

/// Either known rest signal wins; activity requires both signals to be known.
#[cfg(any(target_os = "linux", target_os = "windows", test))]
pub fn screen_active(screen_on: Option<bool>, locked: Option<bool>) -> Option<bool> {
    match (screen_on, locked) {
        (Some(false), _) | (_, Some(true)) => Some(false),
        (Some(true), Some(false)) => Some(true),
        _ => None,
    }
}

#[derive(Default)]
pub struct ScreenState {
    pub enabled: bool,
    revision: u64,
    sample: Option<(Instant, bool)>,
    sampler: Option<Thread>,
}

impl ScreenState {
    pub fn set_enabled(&mut self, enabled: bool) -> u64 {
        self.enabled = enabled;
        self.revision = self.revision.wrapping_add(1);
        self.sample = None;
        if let Some(sampler) = &self.sampler {
            sampler.unpark();
        }
        self.revision
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    #[cfg(any(target_os = "linux", target_os = "windows"))]
    pub(crate) fn attach_sampler(&mut self, sampler: Thread) {
        self.sampler = Some(sampler);
    }

    pub fn update(&mut self, revision: u64, started: Instant, active: Option<bool>) {
        // A slow read from before a toggle must not overwrite the new mode's state.
        if revision == self.revision {
            if let Some(active) = active {
                self.sample = Some((started, active));
            }
        }
    }

    pub fn detected(&self) -> Option<bool> {
        self.sample
            .filter(|(at, _)| at.elapsed() < SCREEN_SAMPLE_MAX_AGE)
            .map(|(_, on)| on)
    }

    pub fn active(&self) -> Option<bool> {
        if self.enabled {
            self.detected()
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lock_or_display_off_means_rest_even_when_the_other_signal_is_unknown() {
        for (on, locked, expected) in [
            (Some(true), Some(false), Some(true)),
            (Some(true), Some(true), Some(false)),
            (Some(false), Some(false), Some(false)),
            (Some(false), Some(true), Some(false)),
            (Some(false), None, Some(false)),
            (None, Some(true), Some(false)),
            (Some(true), None, None),
            (None, Some(false), None),
            (None, None, None),
        ] {
            let screen = screen_active(on, locked);
            assert_eq!(screen, expected, "on={on:?}, locked={locked:?}");
            if expected == Some(false) {
                assert!(!resolve_active(true, true, screen, false));
            }
        }
    }

    #[test]
    fn lock_unlock_and_display_changes_update_activity_without_input() {
        let mut screen = ScreenState::default();
        let revision = screen.set_enabled(true);
        for (on, locked, expected) in [
            (true, false, true),
            (true, true, false),
            (false, true, false),
            (true, true, false),
            (true, false, true),
            (false, false, false),
        ] {
            screen.update(revision, Instant::now(), screen_active(Some(on), Some(locked)));
            assert_eq!(screen.active(), Some(expected));
            assert_eq!(resolve_active(false, false, screen.active(), false), expected);
        }
    }

    #[test]
    fn screen_mode_replaces_input_and_media_but_preserves_fullscreen_breaks() {
        for input in [false, true] {
            for media in [false, true] {
                assert!(resolve_active(input, media, Some(true), false));
                assert!(!resolve_active(input, media, Some(false), false));
                assert!(!resolve_active(input, media, Some(true), true));
                assert_eq!(resolve_active(input, media, None, false), input || media);
                assert!(!resolve_active(input, media, None, true));
            }
        }
    }

    #[test]
    fn failed_probes_keep_the_last_sample_until_it_is_stale() {
        let mut screen = ScreenState::default();
        screen.update(0, Instant::now(), Some(true));
        assert_eq!(screen.active(), None);
        let revision = screen.set_enabled(true);
        assert_eq!(screen.active(), None);
        screen.update(revision, Instant::now(), Some(false));
        assert_eq!(screen.active(), Some(false));
        screen.update(revision, Instant::now(), None);
        assert_eq!(screen.active(), Some(false));
        screen.update(revision, Instant::now() - SCREEN_SAMPLE_MAX_AGE, Some(true));
        assert_eq!(screen.active(), None);
    }

    #[test]
    fn toggling_discards_in_flight_reads_and_cached_state() {
        let mut screen = ScreenState::default();
        let old = screen.set_enabled(true);
        screen.update(old, Instant::now(), Some(true));
        screen.set_enabled(false);
        let current = screen.set_enabled(true);
        screen.update(old, Instant::now(), Some(false));
        assert_eq!(screen.active(), None);
        screen.update(current, Instant::now(), Some(true));
        assert_eq!(screen.active(), Some(true));
    }
}
