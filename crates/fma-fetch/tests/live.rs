//! Against the real GitHub: not part of a normal test run (network, and its hourly limit).
//!
//!   cargo test -p fma-fetch --test live -- --ignored --nocapture

use fma_fetch::{Error, GithubSource, Library, Source};

const REPO: &str = "https://github.com/hugelton/Felucca";

#[test]
#[ignore = "network"]
fn add_from_a_project_link() {
    let root = std::env::temp_dir().join(format!("fma-fetch-live-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let (source, library) = (GithubSource::new(), Library::open(&root).unwrap());

    let fw = library.add(&source, REPO).unwrap();
    println!("{fw:#?}");
    assert_eq!((fw.owner.as_str(), fw.repo.as_str()), ("hugelton", "Felucca"));
    assert!(fw.asset.ends_with(".fwsc"));
    assert_eq!(library.read_package(&fw).unwrap().len() as u64, fw.size);
    assert!(library.check_update(&source, &fw).unwrap().is_none());

    // the same package by its release link and by its own link: already here
    for link in [fw.page_url.clone(), format!("{REPO}/releases/download/{}/{}", fw.version, fw.asset)] {
        assert_eq!(library.add(&source, &link).unwrap(), fw, "{link}");
    }
    assert_eq!(library.list().unwrap().len(), 1);
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
#[ignore = "network"]
fn links_that_lead_nowhere() {
    let source = GithubSource::new();
    let err = |link: &str| source.resolve(link).unwrap_err();
    assert!(matches!(err("https://github.com/hugelton/no-such-repo-fma"), Error::NotFound(_)));
    assert!(matches!(err(&format!("{REPO}/releases/tag/no-such-tag")), Error::NotFound(_)));
    // a project with releases, none of them firmware
    let e = err("https://github.com/BurntSushi/ripgrep");
    println!("{e}");
    assert!(matches!(e, Error::NoPackage { .. }));
}
