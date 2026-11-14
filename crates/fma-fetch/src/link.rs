//! Reading a pasted GitHub link.

use crate::Error;

/// Which release of the project a link means.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Pick {
    /// The project itself, or its "latest release" page.
    Latest,
    /// A release page.
    Tag(String),
    /// One file of a release.
    Asset { tag: String, name: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GithubLink {
    pub owner: String,
    pub repo: String,
    pub pick: Pick,
}

/// Accepts, with or without `https://` and `www.`:
/// * `github.com/OWNER/REPO` (and any other page of the project: its latest release)
/// * `github.com/OWNER/REPO/releases/latest`
/// * `github.com/OWNER/REPO/releases/tag/TAG`
/// * `github.com/OWNER/REPO/releases/download/TAG/FILE`
pub fn parse(link: &str) -> Result<GithubLink, Error> {
    let bad = || Error::BadLink(link.trim().to_owned());
    let s = link.trim();
    let s = s.strip_prefix("https://").or_else(|| s.strip_prefix("http://")).unwrap_or(s);
    let s = s.strip_prefix("www.").unwrap_or(s);
    let s = s.strip_prefix("github.com/").ok_or_else(bad)?;
    let s = s.split(['?', '#']).next().unwrap_or("");
    let parts: Vec<String> = s.split('/').filter(|p| !p.is_empty()).map(decode).collect::<Option<_>>().ok_or_else(bad)?;
    let [owner, repo, rest @ ..] = parts.as_slice() else { return Err(bad()) };
    let repo = repo.strip_suffix(".git").unwrap_or(repo);
    if !name_ok(owner) || !name_ok(repo) {
        return Err(bad());
    }
    let rest: Vec<&str> = rest.iter().map(String::as_str).collect();
    let pick = match rest.as_slice() {
        // (a tag may contain slashes)
        ["releases", "tag", tag @ ..] if !tag.is_empty() => Pick::Tag(tag.join("/")),
        ["releases", "download", tag @ .., name] if !tag.is_empty() => Pick::Asset { tag: tag.join("/"), name: (*name).to_owned() },
        _ => Pick::Latest,
    };
    Ok(GithubLink { owner: owner.clone(), repo: repo.to_owned(), pick })
}

/// GitHub's own rule for owner and repository names, so nothing else reaches a request path.
fn name_ok(s: &str) -> bool {
    !s.is_empty() && s != "." && s != ".." && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

/// Percent-decoding of one path segment (`None`: not valid).
fn decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Percent-encoding for a request path: everything but unreserved characters and `/`.
#[cfg_attr(target_arch = "wasm32", allow(dead_code))]
pub(crate) fn encode_path(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~' | b'/') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(owner: &str, repo: &str, pick: Pick) -> GithubLink {
        GithubLink { owner: owner.into(), repo: repo.into(), pick }
    }

    #[test]
    fn project_links() {
        for s in [
            "https://github.com/owner/repo",
            "  http://www.github.com/owner/repo/  ",
            "github.com/owner/repo.git",
            "https://github.com/owner/repo/releases",
            "https://github.com/owner/repo/releases/latest",
            "https://github.com/owner/repo/issues/12?q=1#top",
            "https://github.com/owner/repo/tree/main/src",
        ] {
            assert_eq!(parse(s).unwrap(), link("owner", "repo", Pick::Latest), "{s}");
        }
    }

    #[test]
    fn release_links() {
        assert_eq!(parse("https://github.com/o/r/releases/tag/v1.8.2").unwrap(), link("o", "r", Pick::Tag("v1.8.2".into())));
        assert_eq!(parse("https://github.com/o/r/releases/tag/fm1/v2").unwrap(), link("o", "r", Pick::Tag("fm1/v2".into())));
        assert_eq!(parse("https://github.com/o/r/releases/tag/v1%2Bbeta").unwrap(), link("o", "r", Pick::Tag("v1+beta".into())));
    }

    #[test]
    fn asset_links() {
        assert_eq!(
            parse("https://github.com/o/r/releases/download/v1.8.2/thing-1.8.2.fwsc").unwrap(),
            link("o", "r", Pick::Asset { tag: "v1.8.2".into(), name: "thing-1.8.2.fwsc".into() })
        );
        assert_eq!(
            parse("github.com/o/r/releases/download/fm1/v2/a%20b.fwsc").unwrap(),
            link("o", "r", Pick::Asset { tag: "fm1/v2".into(), name: "a b.fwsc".into() })
        );
    }

    #[test]
    fn not_links() {
        for s in ["", "owner/repo", "https://gitlab.com/o/r", "https://github.com/", "https://github.com/owner",
            "https://github.com/o w/r", "https://github.com/../r", "https://github.com/o/r%zz", "https://evil.example/github.com/o/r"] {
            assert!(matches!(parse(s), Err(Error::BadLink(_))), "{s}");
        }
    }

    #[test]
    fn path_encoding() {
        assert_eq!(encode_path("fm1/v2+beta 1"), "fm1/v2%2Bbeta%201");
    }
}
