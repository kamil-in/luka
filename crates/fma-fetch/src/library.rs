//! The firmwares the user has added: packages on disk, and an index of what they are.
//!
//! ```text
//! ROOT/library.json                          the index
//! ROOT/packages/OWNER/REPO/TAG/NAME.fwsc     a package, as downloaded
//! ```

use crate::{Asset, Error, Release, Source};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// One package in the library.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Firmware {
    /// `owner/repo@tag#asset`: one entry per package, so two versions can sit side by side.
    pub id: String,
    pub owner: String,
    pub repo: String,
    pub description: Option<String>,
    pub license: Option<String>,
    /// The release's tag.
    pub version: String,
    pub title: Option<String>,
    pub prerelease: bool,
    pub page_url: String,
    /// The package's file name in the release.
    pub asset: String,
    pub size: u64,
    /// Of the package as downloaded, in lowercase hex: checked again on every read.
    pub sha256: String,
    /// Where the package is, relative to the library's root (always `/`-separated).
    pub file: String,
    /// Seconds since 1970.
    pub added_at: u64,
}

pub struct Library {
    root: PathBuf,
}

impl Library {
    /// The library in `root` (created when missing).
    pub fn open(root: impl Into<PathBuf>) -> Result<Self, Error> {
        let root = root.into();
        std::fs::create_dir_all(root.join("packages"))?;
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Everything added, oldest first.
    pub fn list(&self) -> Result<Vec<Firmware>, Error> {
        match std::fs::read(self.index_path()) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(e.into()),
        }
    }

    pub fn get(&self, id: &str) -> Result<Option<Firmware>, Error> {
        Ok(self.list()?.into_iter().find(|f| f.id == id))
    }

    /// The whole of "paste a link": resolve it, and install its package. A release with
    /// several packages is [`Error::Ambiguous`]: `resolve` it, let the user choose, `install`.
    pub fn add(&self, source: &dyn Source, link: &str) -> Result<Firmware, Error> {
        let release = source.resolve(link)?;
        match release.assets.as_slice() {
            [asset] => self.install(source, &release, asset),
            assets => Err(Error::Ambiguous {
                repo: format!("{}/{}", release.owner, release.repo),
                tag: release.tag.clone(),
                names: assets.iter().map(|a| a.name.as_str()).collect::<Vec<_>>().join(", "),
            }),
        }
    }

    /// Put one package of a release in the library. Downloads it unless it is already here.
    pub fn install(&self, source: &dyn Source, release: &Release, asset: &Asset) -> Result<Firmware, Error> {
        let id = format!("{}/{}@{}#{}", release.owner, release.repo, release.tag, asset.name);
        let mut all = self.list()?;
        if let Some(have) = all.iter().find(|f| f.id == id) {
            if self.read_package(have).is_ok() {
                return Ok(have.clone());
            }
        }

        let bytes = source.download(asset)?;
        if bytes.is_empty() {
            return Err(Error::Invalid(format!("{} is empty", asset.name)));
        }
        let file = ["packages", &safe(&release.owner), &safe(&release.repo), &safe(&release.tag), &safe(&asset.name)].join("/");
        let path = self.root.join(&file);
        std::fs::create_dir_all(path.parent().expect("a package path has a parent"))?;
        write_whole(&path, &bytes)?;

        let fw = Firmware {
            id,
            owner: release.owner.clone(),
            repo: release.repo.clone(),
            description: release.description.clone(),
            license: release.license.clone(),
            version: release.tag.clone(),
            title: release.title.clone(),
            prerelease: release.prerelease,
            page_url: release.page_url.clone(),
            asset: asset.name.clone(),
            size: bytes.len() as u64,
            sha256: sha256_hex(&bytes),
            file,
            added_at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs()),
        };
        all.retain(|f| f.id != fw.id);
        all.push(fw.clone());
        self.save(&all)?;
        Ok(fw)
    }

    pub fn package_path(&self, fw: &Firmware) -> PathBuf {
        self.root.join(&fw.file)
    }

    /// The package's bytes, refused when they are not what was downloaded.
    pub fn read_package(&self, fw: &Firmware) -> Result<Vec<u8>, Error> {
        let bytes = std::fs::read(self.package_path(fw))?;
        if sha256_hex(&bytes) != fw.sha256 {
            return Err(Error::Invalid(format!("{}: the stored package has changed since it was downloaded", fw.id)));
        }
        Ok(bytes)
    }

    /// The project's latest release, if it is another version than this one.
    pub fn check_update(&self, source: &dyn Source, fw: &Firmware) -> Result<Option<Release>, Error> {
        let latest = source.resolve(&format!("https://github.com/{}/{}", fw.owner, fw.repo))?;
        Ok((latest.tag != fw.version).then_some(latest))
    }

    /// Forget a firmware and delete its package. `false`: it was not in the library.
    pub fn remove(&self, id: &str) -> Result<bool, Error> {
        let mut all = self.list()?;
        let Some(at) = all.iter().position(|f| f.id == id) else { return Ok(false) };
        let fw = all.remove(at);
        self.save(&all)?;
        let path = self.package_path(&fw);
        match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
            _ => {}
        }
        // the now empty TAG, REPO and OWNER directories (remove_dir fails on one in use: fine)
        let packages = self.root.join("packages");
        let mut dir = path.parent();
        while let Some(d) = dir.filter(|d| *d != packages && d.starts_with(&packages)) {
            if std::fs::remove_dir(d).is_err() {
                break;
            }
            dir = d.parent();
        }
        Ok(true)
    }

    fn index_path(&self) -> PathBuf {
        self.root.join("library.json")
    }

    fn save(&self, all: &[Firmware]) -> Result<(), Error> {
        write_whole(&self.index_path(), &serde_json::to_vec_pretty(all)?)?;
        Ok(())
    }
}

/// A name from GitHub as one path component: nothing that could leave the library's directory.
fn safe(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '_' }).collect();
    match s.trim_matches('.') {
        "" => "_".to_owned(),
        _ => s.trim_end_matches('.').to_owned(), // (Windows drops trailing dots)
    }
}

/// All of the file or none of it: written beside, then moved into place.
fn write_whole(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".part");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    /// A source with one release and no network.
    struct Fake {
        release: Release,
        body: Vec<u8>,
        downloads: Cell<u32>,
    }

    impl Fake {
        fn new(tag: &str, names: &[&str]) -> Self {
            let assets = names.iter().map(|n| Asset { name: (*n).into(), size: 4, url: format!("https://github.com/o/r/releases/download/{tag}/{n}") }).collect();
            let release = Release {
                owner: "o".into(), repo: "r".into(), description: Some("a synth".into()), license: Some("GPL-3.0".into()),
                tag: tag.into(), title: None, published_at: None, prerelease: false,
                page_url: format!("https://github.com/o/r/releases/tag/{tag}"), assets,
            };
            Fake { release, body: b"FWSC".to_vec(), downloads: Cell::new(0) }
        }
    }

    impl Source for Fake {
        fn resolve(&self, _link: &str) -> Result<Release, Error> {
            Ok(self.release.clone())
        }
        fn download(&self, _asset: &Asset) -> Result<Vec<u8>, Error> {
            self.downloads.set(self.downloads.get() + 1);
            Ok(self.body.clone())
        }
    }

    fn library(name: &str) -> Library {
        let root = std::env::temp_dir().join(format!("fma-fetch-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        Library::open(root).unwrap()
    }

    #[test]
    fn add_downloads_once_and_remembers() {
        let (lib, src) = (library("once"), Fake::new("v1", &["r-1.fwsc"]));
        let fw = lib.add(&src, "https://github.com/o/r").unwrap();
        assert_eq!(fw.id, "o/r@v1#r-1.fwsc");
        assert_eq!(fw.file, "packages/o/r/v1/r-1.fwsc");
        assert_eq!(fw.sha256, sha256_hex(b"FWSC"));
        assert_eq!(lib.read_package(&fw).unwrap(), b"FWSC");

        assert_eq!(lib.add(&src, "https://github.com/o/r").unwrap(), fw);
        assert_eq!(src.downloads.get(), 1, "the second add must not download");
        // (a library opened again finds it)
        assert_eq!(Library::open(lib.root()).unwrap().list().unwrap(), vec![fw]);
        std::fs::remove_dir_all(lib.root()).unwrap();
    }

    #[test]
    fn several_packages_need_a_choice() {
        let (lib, src) = (library("choice"), Fake::new("v1", &["fm1.fwsc", "smk37.fwsc"]));
        assert!(matches!(lib.add(&src, "x"), Err(Error::Ambiguous { .. })));
        let release = src.resolve("x").unwrap();
        let fw = lib.install(&src, &release, &release.assets[1]).unwrap();
        assert_eq!(fw.asset, "smk37.fwsc");
        assert_eq!(lib.list().unwrap().len(), 1);
        std::fs::remove_dir_all(lib.root()).unwrap();
    }

    #[test]
    fn a_changed_package_is_refused_and_fetched_again() {
        let (lib, src) = (library("changed"), Fake::new("v1", &["r.fwsc"]));
        let fw = lib.add(&src, "x").unwrap();
        std::fs::write(lib.package_path(&fw), b"XXXX").unwrap();
        assert!(matches!(lib.read_package(&fw), Err(Error::Invalid(_))));
        lib.add(&src, "x").unwrap();
        assert_eq!(src.downloads.get(), 2);
        assert_eq!(lib.read_package(&fw).unwrap(), b"FWSC");
        assert_eq!(lib.list().unwrap().len(), 1);
        std::fs::remove_dir_all(lib.root()).unwrap();
    }

    #[test]
    fn update_and_remove() {
        let lib = library("update");
        let fw = lib.add(&Fake::new("v1", &["r.fwsc"]), "x").unwrap();
        assert!(lib.check_update(&Fake::new("v1", &["r.fwsc"]), &fw).unwrap().is_none());
        let newer = Fake::new("v2", &["r.fwsc"]);
        assert_eq!(lib.check_update(&newer, &fw).unwrap().unwrap().tag, "v2");
        let fw2 = lib.add(&newer, "x").unwrap();
        assert_eq!(lib.list().unwrap().len(), 2, "two versions side by side");

        assert!(lib.remove(&fw.id).unwrap());
        assert!(!lib.remove(&fw.id).unwrap());
        assert!(!lib.package_path(&fw).exists());
        assert!(!lib.root().join("packages/o/r/v1").exists());
        assert_eq!(lib.list().unwrap(), vec![fw2]);
        std::fs::remove_dir_all(lib.root()).unwrap();
    }

    #[test]
    fn names_stay_inside_the_library() {
        assert_eq!(safe("v1.8.2"), "v1.8.2");
        assert_eq!(safe("fm1/v2"), "fm1_v2");
        assert_eq!(safe(".."), "_");
        assert_eq!(safe("..\\..\\x"), ".._.._x");
        assert_eq!(safe("a b:c*.fwsc"), "a_b_c_.fwsc");
        assert_eq!(safe("tag."), "tag");
    }
}
