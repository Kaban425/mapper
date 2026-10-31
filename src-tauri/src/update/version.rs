//! Release tags as GitHub returns them: `v1.2.3` only (no pre-release suffix), compared by
//! numbers. Anything else is not a version Mapper offers.

/// `v` and three dot-separated numbers of 1–9 digits, at most 32 characters.
pub fn parse_tag(tag: &str) -> Option<[u64; 3]> {
    if tag.len() > 32 {
        return None;
    }
    let mut parts = tag.strip_prefix('v')?.split('.');
    let mut numbers = [0u64; 3];
    for slot in &mut numbers {
        let part = parts.next()?;
        if part.is_empty() || part.len() > 9 || !part.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        *slot = part.parse().ok()?;
    }
    parts.next().is_none().then_some(numbers)
}

/// `current` is Cargo's version without the `v` (`0.1.0`).
pub fn is_newer(tag: &str, current: &str) -> bool {
    match (parse_tag(tag), parse_tag(&format!("v{current}"))) {
        (Some(offered), Some(running)) => offered > running,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_release_tags_parse() {
        assert_eq!(parse_tag("v1.10.0"), Some([1, 10, 0]));
        for bad in ["1.0.0", "v1.0", "v1.0.0.0", "v1.0.0-rc.1", "v01.2.x", "v1..2", "", "v1.0.1234567890", "V1.0.0"] {
            assert_eq!(parse_tag(bad), None, "{bad}");
        }
    }

    #[test]
    fn newer_is_by_numbers_not_text() {
        assert!(is_newer("v0.10.0", "0.9.9"));
        assert!(is_newer("v1.0.0", "0.1.0"));
        assert!(!is_newer("v0.1.0", "0.1.0"));
        assert!(!is_newer("v0.0.9", "0.1.0"));
        assert!(!is_newer("garbage", "0.1.0"));
    }
}
