//! The one network request Mapper makes: `GET /repos/<REPO>/releases/latest` on the GitHub API,
//! over HTTPS (rustls, built-in roots), with an ETag so an unchanged answer is a bodiless 304.
//! Straight to api.github.com: no proxy, no redirect followed. Nothing about the player is sent;
//! only `tag_name`, `draft` and `prerelease` are read.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::version;
use crate::platform::win::shell::REPO;

const TIMEOUT: Duration = Duration::from_secs(10);
/// Release notes may hold 125 000 characters, two bytes each in Cyrillic, plus the assets.
const MAX_BODY: u64 = 1024 * 1024;
const MAX_ETAG: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Fetched {
    /// 304: nothing new since the last answer.
    NotModified,
    /// The latest release; `tag` is None for a draft, a pre-release or an unusable tag.
    Release { tag: Option<String>, etag: Option<String> },
}

/// Saved in the config (`updates.failed`), so Settings says what happened after a restart too.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FetchError {
    /// No connection to GitHub (offline, DNS, timeout, a failed TLS handshake).
    Offline,
    /// 403 / 429: GitHub limits requests for a while.
    RateLimited,
    /// Anything else: an unexpected status or body.
    BadResponse,
}

/// The repository constant is still the placeholder: no request goes out (the release guard
/// refuses such a build). `black_box` keeps the request code in every build, so the guard's
/// import checks see it before the repository is named.
pub fn repository_set() -> bool {
    !std::hint::black_box(REPO).starts_with("OWNER/")
}

fn url() -> String {
    format!("https://api.github.com/repos/{REPO}/releases/latest")
}

/// Only these fields are read; everything else in the answer is ignored.
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

/// The tag Mapper may offer, from a release body.
pub fn parse(body: &str) -> Result<Option<String>, FetchError> {
    let release: Release = serde_json::from_str(body).map_err(|_| FetchError::BadResponse)?;
    let usable = !release.draft && !release.prerelease && version::parse_tag(&release.tag_name).is_some();
    Ok(usable.then_some(release.tag_name))
}

/// Visible ASCII and short: an ETag goes back into a request header.
pub fn usable_etag(etag: &str) -> bool {
    !etag.is_empty() && etag.len() <= MAX_ETAG && etag.bytes().all(|b| (0x21..=0x7e).contains(&b))
}

/// Connection trouble, also a TLS failure (a captive portal, a scanning proxy), is "offline";
/// an answer Mapper cannot use is a bad one.
fn classify(err: &ureq::Error) -> FetchError {
    match err {
        ureq::Error::Timeout(_)
        | ureq::Error::HostNotFound
        | ureq::Error::Io(_)
        | ureq::Error::ConnectionFailed
        | ureq::Error::BodyStalled
        | ureq::Error::Tls(_)
        | ureq::Error::Rustls(_) => FetchError::Offline,
        _ => FetchError::BadResponse,
    }
}

pub fn fetch(etag: Option<&str>) -> Result<Fetched, FetchError> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .https_only(true)
        .proxy(None)
        // A redirect comes back as the answer (and counts as a bad one): only api.github.com.
        .max_redirects(0)
        .http_status_as_error(false)
        .user_agent(format!("Mapper/{} (+https://github.com/{REPO})", env!("CARGO_PKG_VERSION")))
        .accept("application/vnd.github+json")
        .build()
        .into();
    let mut request = agent.get(&url()).header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(etag) = etag.filter(|e| usable_etag(e)) {
        request = request.header("If-None-Match", etag);
    }
    let mut response = request.call().map_err(|err| classify(&err))?;
    match response.status().as_u16() {
        304 => Ok(Fetched::NotModified),
        403 | 429 => Err(FetchError::RateLimited),
        // The repository has no published release yet.
        404 => Ok(Fetched::Release { tag: None, etag: None }),
        200 => {
            let etag = response
                .headers()
                .get("etag")
                .and_then(|v| v.to_str().ok())
                .filter(|e| usable_etag(e))
                .map(str::to_string);
            let body =
                response.body_mut().with_config().limit(MAX_BODY).read_to_string().map_err(|err| classify(&err))?;
            Ok(Fetched::Release { tag: parse(&body)?, etag })
        }
        _ => Err(FetchError::BadResponse),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_a_published_release_tag() {
        let body = r#"{"tag_name":"v1.1.0","draft":false,"prerelease":false,"body":"…","assets":[{"browser_download_url":"https://evil.example"}]}"#;
        assert_eq!(parse(body), Ok(Some("v1.1.0".into())));
        assert_eq!(parse(r#"{"tag_name":"v1.2.0-rc.1","prerelease":true}"#), Ok(None));
        assert_eq!(parse(r#"{"tag_name":"v1.2.0","draft":true}"#), Ok(None));
        assert_eq!(parse(r#"{"tag_name":"latest"}"#), Ok(None));
        assert_eq!(parse("<html>"), Err(FetchError::BadResponse));
        assert_eq!(parse(r#"{"message":"Not Found"}"#), Err(FetchError::BadResponse));
    }

    #[test]
    fn etags_go_back_only_when_harmless() {
        assert!(usable_etag(r#"W/"0123abcd""#));
        assert!(!usable_etag("a\r\nX-Injected: 1"));
        assert!(!usable_etag(""));
        assert!(!usable_etag(&"x".repeat(257)));
    }

    #[test]
    fn connection_trouble_reads_as_offline() {
        assert_eq!(classify(&ureq::Error::HostNotFound), FetchError::Offline);
        assert_eq!(classify(&ureq::Error::ConnectionFailed), FetchError::Offline);
        assert_eq!(classify(&ureq::Error::BodyStalled), FetchError::Offline);
        assert_eq!(classify(&ureq::Error::Tls("handshake")), FetchError::Offline);
        assert_eq!(classify(&ureq::Error::BodyExceedsLimit(MAX_BODY)), FetchError::BadResponse);
        assert_eq!(classify(&ureq::Error::StatusCode(500)), FetchError::BadResponse);
    }

    #[test]
    fn the_placeholder_sends_nothing() {
        assert_eq!(repository_set(), !REPO.starts_with("OWNER/"));
        assert!(url().starts_with("https://api.github.com/repos/"));
    }
}
