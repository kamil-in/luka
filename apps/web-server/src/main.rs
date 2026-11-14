//! The web client's server. It keeps nothing and runs no firmware: the emulator runs in
//! the visitor's browser, and their library lives there too. It does two things:
//!
//! * serves the page (`ui/`) and the player (`/fma_wasm.wasm`);
//! * speaks to GitHub for the page, which cannot: a browser is not allowed to download a
//!   release's files from another site's page.
//!     `GET /api/resolve?link=LINK`   -> a `Release` as JSON
//!     `GET /api/download?url=URL`    -> a package's bytes (a GitHub release's `.fwsc` only)
//! * serves the firmwares' own browser builds, where they have been fetched
//!   (`tools/fetch-native.mjs`): `/native/manifest.json` and the files it lists.
//!
//!   fma-web-server [--host 127.0.0.1] [--port 8787] [--ui ui] [--wasm path/to/fma_wasm.wasm] [--native .cache/native]
//!
//! `GITHUB_TOKEN` in the environment raises GitHub's hourly limit, which is otherwise 60
//! lookups for everyone this server serves together.

use fma_fetch::{Asset, Error, GithubSource, Source};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tiny_http::{Header, Method, Request, Response, Server};

const WASM: &str = "target/wasm/wasm32-unknown-unknown/release/fma_wasm.wasm";

struct Site {
    ui: PathBuf,
    wasm: PathBuf,
    /// firmwares' own browser builds and their manifest (tools/fetch-native.mjs); may be missing
    native: PathBuf,
    github: GithubSource,
}

type Reply = (u16, &'static str, Vec<u8>);

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = |name: &str, default: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned().unwrap_or_else(|| default.to_owned());
    // (the port: --port, or PORT in the environment, as a host that assigns one sets it)
    let (host, port) = (arg("--host", "127.0.0.1"), arg("--port", &std::env::var("PORT").unwrap_or_else(|_| "8787".into())));
    let github = match std::env::var("GITHUB_TOKEN") {
        Ok(token) if !token.is_empty() => GithubSource::new().with_token(token),
        _ => GithubSource::new(),
    };
    let site = Arc::new(Site { ui: arg("--ui", "ui").into(), wasm: arg("--wasm", WASM).into(), native: arg("--native", ".cache/native").into(), github });
    if !site.ui.join("index.html").exists() {
        eprintln!("no page at {}: run from the project's folder, or pass --ui", site.ui.display());
        std::process::exit(1);
    }
    if !site.wasm.exists() {
        eprintln!("no player at {}: build it first (tools\\build-web.ps1), or pass --wasm", site.wasm.display());
        std::process::exit(1);
    }
    let server = match Server::http(format!("{host}:{port}")) {
        Ok(server) => Arc::new(server),
        Err(e) => {
            eprintln!("could not listen on {host}:{port}: {e}");
            std::process::exit(1);
        }
    };
    println!("http://{host}:{port}");
    // (a few at once: a download for one visitor does not hold up the page for another)
    let workers: Vec<_> = (0..4)
        .map(|_| {
            let (server, site) = (server.clone(), site.clone());
            std::thread::spawn(move || {
                while let Ok(request) = server.recv() {
                    answer(&site, request);
                }
            })
        })
        .collect();
    for worker in workers {
        let _ = worker.join();
    }
}

fn answer(site: &Site, request: Request) {
    let (status, kind, body) = if *request.method() == Method::Get { route(site, request.url()) } else { (405, "text/plain", b"GET only".to_vec()) };
    let mut response = Response::from_data(body).with_status_code(status);
    for (name, value) in [("Content-Type", kind), ("Cache-Control", "no-cache"), ("X-Content-Type-Options", "nosniff")] {
        response.add_header(Header::from_bytes(name, value).expect("a plain header"));
    }
    let _ = request.respond(response);
}

fn route(site: &Site, url: &str) -> Reply {
    let (path, query) = url.split_once('?').unwrap_or((url, ""));
    match path {
        "/api/resolve" => api(param(query, "link").ok_or_else(|| Error::BadLink(String::new())).and_then(|link| {
            let release = site.github.resolve(&link)?;
            Ok(("application/json", serde_json::to_vec(&release)?))
        })),
        "/api/download" => api(param(query, "url").ok_or_else(|| Error::Invalid("which file?".into())).and_then(|url| {
            Ok(("application/octet-stream", site.github.download(&package(&url)?)?))
        })),
        "/fma_wasm.wasm" => file(&site.wasm),
        // (none fetched: an empty list, not an error)
        "/native/manifest.json" if !site.native.join("manifest.json").is_file() => (200, "application/json", br#"{"builds":[]}"#.to_vec()),
        _ if path.starts_with("/native/") => match local(&site.native, &path["/native".len()..]) {
            Some(path) => file(&path),
            None => (404, "text/plain", b"not found".to_vec()),
        },
        _ => match local(&site.ui, path) {
            Some(path) => file(&path),
            None => (404, "text/plain", b"not found".to_vec()),
        },
    }
}

/// The one kind of file this server fetches for a page: a GitHub release's firmware package.
fn package(url: &str) -> Result<Asset, Error> {
    let refused = || Error::Invalid(format!("{url}: not a firmware package of a GitHub release"));
    let path = url.strip_prefix("https://github.com/").ok_or_else(refused)?;
    let parts: Vec<&str> = path.split('/').collect();
    let name = *parts.last().ok_or_else(refused)?;
    let shaped = parts.len() >= 6 && parts[2] == "releases" && parts[3] == "download" && parts.iter().all(|p| !p.is_empty() && *p != "..");
    if !shaped || !name.to_ascii_lowercase().ends_with(fma_fetch::PACKAGE_EXT) || path.contains(['?', '#']) {
        return Err(refused());
    }
    Ok(Asset { name: name.to_owned(), size: 0, url: url.to_owned() })
}

fn api(result: Result<(&'static str, Vec<u8>), Error>) -> Reply {
    match result {
        Ok((kind, body)) => (200, kind, body),
        Err(e) => {
            let status = match e {
                Error::BadLink(_) | Error::Invalid(_) => 400,
                Error::NotFound(_) | Error::NoRelease { .. } | Error::NoPackage { .. } => 404,
                Error::RateLimited { .. } => 429,
                _ => 502,
            };
            (status, "application/json", serde_json::json!({ "error": e.to_string() }).to_string().into_bytes())
        }
    }
}

/// The file under `root` a request path names, if it names one inside it.
fn local(root: &Path, path: &str) -> Option<PathBuf> {
    let mut file = root.to_path_buf();
    for part in path.split('/').filter(|p| !p.is_empty()) {
        let part = decode(part)?;
        if part == "." || part == ".." || part.contains(['\\', '/', ':']) {
            return None;
        }
        file.push(part);
    }
    if file.is_dir() {
        file.push("index.html");
    }
    file.is_file().then_some(file)
}

fn file(path: &Path) -> Reply {
    let kind = match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    };
    match std::fs::read(path) {
        Ok(body) => (200, kind, body),
        Err(_) => (404, "text/plain", b"not found".to_vec()),
    }
}

/// A query parameter, decoded.
fn param(query: &str, name: &str) -> Option<String> {
    query.split('&').filter_map(|pair| pair.split_once('=')).find(|(k, _)| *k == name).and_then(|(_, v)| decode(&v.replace('+', " ")))
}

fn decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let (mut out, mut i) = (Vec::with_capacity(b.len()), 0);
    while i < b.len() {
        if b[i] == b'%' {
            out.push(u8::from_str_radix(std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_release_packages_are_fetched() {
        assert!(package("https://github.com/o/r/releases/download/v1/a.fwsc").is_ok());
        assert!(package("https://github.com/o/r/releases/download/fm1/v2/A.FWSC").is_ok());
        for url in [
            "https://github.com/o/r/releases/download/v1/a.zip",
            "https://github.com/o/r/archive/main.fwsc",
            "https://github.com/o/r/releases/download/../../x/a.fwsc",
            "https://github.com/o/r/releases/download/v1/a.fwsc?x=.fwsc",
            "http://github.com/o/r/releases/download/v1/a.fwsc",
            "https://evil.example/o/r/releases/download/v1/a.fwsc",
            "https://github.com.evil.example/o/r/releases/download/v1/a.fwsc",
        ] {
            assert!(package(url).is_err(), "{url}");
        }
    }

    #[test]
    fn files_stay_inside_the_page() {
        let root = std::env::temp_dir().join(format!("fma-web-test-{}", std::process::id()));
        std::fs::create_dir_all(root.join("web")).unwrap();
        std::fs::write(root.join("index.html"), "x").unwrap();
        std::fs::write(root.join("web/a.js"), "x").unwrap();
        assert_eq!(local(&root, "/"), Some(root.join("index.html")));
        assert_eq!(local(&root, "/web/a.js"), Some(root.join("web").join("a.js")));
        for path in ["/../Cargo.toml", "/web/../../x", "/%2e%2e/x", "/web/..%5c..%5cx", "/C:/Windows/win.ini", "/missing.js"] {
            assert_eq!(local(&root, path), None, "{path}");
        }
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn queries() {
        assert_eq!(param("link=https%3A%2F%2Fgithub.com%2Fo%2Fr&x=1", "link").as_deref(), Some("https://github.com/o/r"));
        assert_eq!(param("x=1", "link"), None);
        assert_eq!(param("link=%zz", "link"), None);
    }
}
