//! GitHub as a [`Source`]: its public REST API for the release, its site for the download.

use crate::link::{self, encode_path, Pick};
use crate::{Asset, Error, Release, Source, PACKAGE_EXT};
use serde::Deserialize;
use std::io::Read;
use std::time::Duration;

const API: &str = "https://api.github.com";
/// A generic client name: GitHub requires one, and it says nothing about the user.
const USER_AGENT: &str = "luka";
/// No firmware package comes near this (the FM-1's whole flash is 1 MiB).
const MAX_PACKAGE: u64 = 16 << 20;

pub struct GithubSource {
    agent: ureq::Agent,
    token: Option<String>,
}

impl Default for GithubSource {
    fn default() -> Self {
        Self::new()
    }
}

impl GithubSource {
    /// Without an account: GitHub allows 60 lookups an hour from one address.
    pub fn new() -> Self {
        let agent = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(15)).timeout(Duration::from_secs(120)).build();
        Self { agent, token: None }
    }

    /// With a personal access token, for a higher limit. Sent to api.github.com only.
    pub fn with_token(mut self, token: impl Into<String>) -> Self {
        self.token = Some(token.into());
        self
    }

    fn get(&self, url: &str, accept: &str, auth: bool) -> Result<ureq::Response, Error> {
        let mut req = self.agent.get(url).set("User-Agent", USER_AGENT).set("Accept", accept);
        if let Some(token) = self.token.as_ref().filter(|_| auth) {
            req = req.set("Authorization", &format!("Bearer {token}"));
        }
        match req.call() {
            Ok(resp) => Ok(resp),
            Err(ureq::Error::Status(404, _)) => Err(Error::NotFound(url.to_owned())),
            Err(ureq::Error::Status(403 | 429, resp)) if resp.header("x-ratelimit-remaining") == Some("0") => {
                Err(Error::RateLimited { reset_unix: resp.header("x-ratelimit-reset").and_then(|v| v.parse().ok()) })
            }
            Err(ureq::Error::Status(code, _)) => Err(Error::Network(format!("GitHub answered {code} for {url}"))),
            Err(e) => Err(Error::Network(e.to_string())),
        }
    }

    fn api<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T, Error> {
        self.get(&format!("{API}{path}"), "application/vnd.github+json", true)?
            .into_json()
            .map_err(|e| Error::Network(format!("GitHub's answer for {path} could not be read: {e}")))
    }
}

#[derive(Deserialize)]
struct ApiRepo {
    description: Option<String>,
    license: Option<ApiLicense>,
}

#[derive(Deserialize)]
struct ApiLicense {
    spdx_id: Option<String>,
}

#[derive(Deserialize)]
struct ApiRelease {
    tag_name: String,
    name: Option<String>,
    html_url: String,
    published_at: Option<String>,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    assets: Vec<ApiAsset>,
}

#[derive(Deserialize)]
struct ApiAsset {
    name: String,
    #[serde(default)]
    size: u64,
    browser_download_url: String,
}

fn not_found<T>(r: Result<T, Error>, what: impl FnOnce() -> String) -> Result<T, Error> {
    r.map_err(|e| if matches!(e, Error::NotFound(_)) { Error::NotFound(what()) } else { e })
}

impl Source for GithubSource {
    fn resolve(&self, pasted: &str) -> Result<Release, Error> {
        let link = link::parse(pasted)?;
        let full = format!("{}/{}", link.owner, link.repo);
        let base = format!("/repos/{full}");
        let repo: ApiRepo = not_found(self.api(&base), || full.clone())?;

        let (tag, only) = match &link.pick {
            Pick::Latest => (None, None),
            Pick::Tag(tag) => (Some(tag), None),
            Pick::Asset { tag, name } => (Some(tag), Some(name)),
        };
        let rel: ApiRelease = match tag {
            Some(tag) => not_found(self.api(&format!("{base}/releases/tags/{}", encode_path(tag))), || format!("release {tag} of {full}"))?,
            // "latest" leaves pre-releases out: a project with nothing else still has a newest one
            None => match self.api(&format!("{base}/releases/latest")) {
                Err(Error::NotFound(_)) => {
                    let all: Vec<ApiRelease> = self.api(&format!("{base}/releases?per_page=10"))?;
                    all.into_iter().find(|r| !r.draft).ok_or_else(|| Error::NoRelease { repo: full.clone() })?
                }
                other => other?,
            },
        };

        let is_package = |name: &str| name.to_ascii_lowercase().ends_with(PACKAGE_EXT);
        let assets: Vec<Asset> = rel
            .assets
            .iter()
            .filter(|a| is_package(&a.name) && only.is_none_or(|n| *n == a.name))
            .map(|a| Asset { name: a.name.clone(), size: a.size, url: a.browser_download_url.clone() })
            .collect();
        if assets.is_empty() {
            if let Some(name) = only.filter(|n| is_package(n)) {
                return Err(Error::NotFound(format!("{name} in release {} of {full}", rel.tag_name)));
            }
            let found = rel.assets.iter().map(|a| a.name.as_str()).collect::<Vec<_>>().join(", ");
            return Err(Error::NoPackage { repo: full, tag: rel.tag_name, found: if found.is_empty() { "none".into() } else { found } });
        }

        Ok(Release {
            owner: link.owner,
            repo: link.repo,
            description: repo.description.filter(|d| !d.trim().is_empty()),
            // (NOASSERTION: GitHub found a licence file it does not recognise)
            license: repo.license.and_then(|l| l.spdx_id).filter(|id| id != "NOASSERTION"),
            tag: rel.tag_name,
            title: rel.name.filter(|n| !n.trim().is_empty()),
            published_at: rel.published_at,
            prerelease: rel.prerelease,
            page_url: rel.html_url,
            assets,
        })
    }

    fn download(&self, asset: &Asset) -> Result<Vec<u8>, Error> {
        // an asset comes from `resolve`, but it may also come back from a UI: only GitHub's site
        if !asset.url.starts_with("https://github.com/") {
            return Err(Error::Invalid(format!("{}: not a GitHub download", asset.url)));
        }
        if asset.size > MAX_PACKAGE {
            return Err(Error::Invalid(format!("{} is {} bytes: too large for a firmware package", asset.name, asset.size)));
        }
        // (no token: the download redirects to another host, and public files need none)
        let resp = self.get(&asset.url, "application/octet-stream", false)?;
        let mut bytes = Vec::new();
        resp.into_reader().take(MAX_PACKAGE + 1).read_to_end(&mut bytes).map_err(|e| Error::Network(e.to_string()))?;
        if bytes.len() as u64 > MAX_PACKAGE {
            return Err(Error::Invalid(format!("{} is too large for a firmware package", asset.name)));
        }
        if asset.size != 0 && bytes.len() as u64 != asset.size {
            return Err(Error::Network(format!("{}: got {} of {} bytes", asset.name, bytes.len(), asset.size)));
        }
        Ok(bytes)
    }
}
