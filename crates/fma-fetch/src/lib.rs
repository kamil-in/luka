//! Fetching firmware: a link the user pastes becomes a package on disk.
//!
//! ```no_run
//! use fma_fetch::{GithubSource, Library};
//! let source = GithubSource::new();
//! let library = Library::open("some/app/data/dir")?;
//! let fw = library.add(&source, "https://github.com/owner/repo")?;
//! let package: Vec<u8> = library.read_package(&fw)?; // hand this to the player
//! # Ok::<(), fma_fetch::Error>(())
//! ```
//!
//! Three parts, each replaceable:
//! * [`link`] reads what the user pasted;
//! * a [`Source`] turns a link into a [`Release`] and downloads its assets ([`GithubSource`]
//!   is the only one so far);
//! * the [`Library`] stores packages and remembers them, so a package is downloaded once.
//!
//! This crate knows nothing about the emulator or any UI, and does not look inside a package.

#[cfg(not(target_arch = "wasm32"))]
mod github;
mod library;
pub mod link;

#[cfg(not(target_arch = "wasm32"))]
pub use github::GithubSource;
pub use library::{Firmware, Library};

use serde::{Deserialize, Serialize};

/// A firmware package's file extension (compared without case).
pub const PACKAGE_EXT: &str = ".fwsc";

/// One release of a firmware project, with the packages it offers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Release {
    pub owner: String,
    pub repo: String,
    /// The project's own one-line description, if it has one.
    pub description: Option<String>,
    /// The project's licence as an SPDX id (`GPL-3.0`), if the host knows it.
    pub license: Option<String>,
    /// The release's tag: the firmware's version.
    pub tag: String,
    /// The release's title, if it has one.
    pub title: Option<String>,
    pub published_at: Option<String>,
    pub prerelease: bool,
    /// The release's page, for a "view on GitHub" link.
    pub page_url: String,
    /// The packages to choose from: never empty. One, when the link named a package.
    pub assets: Vec<Asset>,
}

/// One downloadable package of a release.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Asset {
    pub name: String,
    /// In bytes, as the host states it (0: not stated).
    pub size: u64,
    pub url: String,
}

/// Where firmware comes from.
pub trait Source {
    /// What a pasted link points at. With a link to a project, its latest release.
    fn resolve(&self, link: &str) -> Result<Release, Error>;
    /// An asset's bytes.
    fn download(&self, asset: &Asset) -> Result<Vec<u8>, Error>;
}

/// What can go wrong, worded for the person who pasted the link.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("not a GitHub project link: {0}")]
    BadLink(String),
    #[error("{0} was not found on GitHub")]
    NotFound(String),
    #[error("{repo} has not published a release")]
    NoRelease { repo: String },
    #[error("release {tag} of {repo} has no .fwsc firmware package (its files: {found})")]
    NoPackage { repo: String, tag: String, found: String },
    #[error("release {tag} of {repo} has several firmware packages, choose one: {names}")]
    Ambiguous { repo: String, tag: String, names: String },
    #[error("GitHub's hourly request limit is used up, try again later")]
    RateLimited {
        /// When the limit resets, in seconds since 1970, if GitHub said.
        reset_unix: Option<u64>,
    },
    #[error("could not reach GitHub: {0}")]
    Network(String),
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("the library's index is damaged: {0}")]
    Index(#[from] serde_json::Error),
}
