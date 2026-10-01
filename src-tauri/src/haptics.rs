// Force Touch trackpad feedback, asked for by the frontend by name

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Haptic {
    Alignment,
    LevelChange,
}

impl Haptic {
    pub fn parse(kind: &str) -> Option<Self> {
        match kind {
            "alignment" => Some(Self::Alignment),
            "levelChange" => Some(Self::LevelChange),
            _ => None,
        }
    }
}

/// Felt only on a Force Touch trackpad with a finger on it; anything else
/// ignores it. Must run on the main thread.
#[cfg(target_os = "macos")]
pub fn perform(haptic: Haptic) {
    use objc2_app_kit::{NSHapticFeedbackManager, NSHapticFeedbackPattern, NSHapticFeedbackPerformanceTime, NSHapticFeedbackPerformer};
    let pattern = match haptic {
        Haptic::Alignment => NSHapticFeedbackPattern::Alignment,
        Haptic::LevelChange => NSHapticFeedbackPattern::LevelChange,
    };
    NSHapticFeedbackManager::defaultPerformer()
        .performFeedbackPattern_performanceTime(pattern, NSHapticFeedbackPerformanceTime::Now);
}

#[cfg(test)]
mod tests {
    use super::Haptic;

    #[test]
    fn names_the_frontend_uses_map_to_feedback_patterns() {
        assert_eq!(Haptic::parse("alignment"), Some(Haptic::Alignment));
        assert_eq!(Haptic::parse("levelChange"), Some(Haptic::LevelChange));
        assert_eq!(Haptic::parse("generic"), None);
    }
}
