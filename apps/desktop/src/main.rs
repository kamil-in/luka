//! The desktop client: a window with the same page as the web client (`ui/`), which plays the
//! firmwares' own browser builds itself (`ui/web/transport-web.js`). What the window cannot do
//! alone is read them from disk: `native_manifest` and `native_file` hand it the manifest and
//! the files that `tools/import-builds.mjs` (or `fetch-native.mjs`) put in `.cache/native`.
//!
//! The rest is the first desktop client, kept and tested: a [`Transport`] whose events go to the
//! window as they are, screen frames as raw bytes down a channel, audio straight to the sound
//! card, emulating `.fwsc` packages (`ui/transport-tauri.js` is its page's side; the page does
//! not use it at present).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;

use fma_display::{Command, Event, Frame, Session, Transport};
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, State};

struct Window {
    app: AppHandle,
    /// where the page takes screen frames (it asks once it has loaded)
    frames: Mutex<Option<Channel<InvokeResponseBody>>>,
    audio: audio::Output,
}

impl Transport for Window {
    fn event(&self, event: Event) {
        // (what one firmware left in the buffer is not the next one's to play)
        if matches!(event, Event::Started { .. } | Event::Stopped { .. }) {
            self.audio.clear();
        }
        let _ = self.app.emit("fma:event", event);
    }

    fn frame(&self, frame: Frame<'_>) {
        if let Some(channel) = self.frames.lock().unwrap().as_ref() {
            let _ = channel.send(InvokeResponseBody::Raw(frame.rgba.to_vec()));
        }
    }

    fn audio(&self, samples: &[i16], sample_rate: u32) {
        self.audio.push(samples, sample_rate);
    }
}

struct App {
    session: Session,
    window: Arc<Window>,
}

/// A command of the protocol, as the page sends it.
#[tauri::command]
fn send(command: Command, app: State<'_, App>) {
    app.session.send(command);
}

/// The page is ready for screen frames on `channel`.
#[tauri::command]
fn frames(channel: Channel<InvokeResponseBody>, app: State<'_, App>) {
    *app.window.frames.lock().unwrap() = Some(channel);
}

/// Where the browser builds are: `FMA_NATIVE`, or `.cache/native` found from the working
/// directory or from where the program is (a build in the repository's `target/`).
fn native_dir() -> Option<std::path::PathBuf> {
    let has = |d: &std::path::Path| d.join("manifest.json").is_file();
    if let Some(d) = std::env::var_os("FMA_NATIVE").map(std::path::PathBuf::from) {
        return has(&d).then_some(d);
    }
    let starts = [std::env::current_dir().ok(), std::env::current_exe().ok()];
    starts.into_iter().flatten().flat_map(|s| s.ancestors().map(|a| a.join(".cache").join("native")).collect::<Vec<_>>()).find(|d| has(d))
}

/// The builds' manifest, as the web server serves it (none found: no builds).
#[tauri::command]
fn native_manifest() -> String {
    native_dir()
        .and_then(|d| std::fs::read_to_string(d.join("manifest.json")).ok())
        .unwrap_or_else(|| r#"{"builds":[]}"#.into())
}

/// One build's file, by the name the manifest gives it (a bare name: no paths).
#[tauri::command]
fn native_file(file: String) -> Result<tauri::ipc::Response, String> {
    if file.contains(['/', '\\']) || file.contains("..") || !file.ends_with(".wasm") {
        return Err(format!("{file} is not a build's file name"));
    }
    let dir = native_dir().ok_or("there are no browser builds on this computer (run tools/import-builds.mjs)")?;
    std::fs::read(dir.join(&file)).map(tauri::ipc::Response::new).map_err(|e| format!("{file}: {e}"))
}

/// A firmware's repository, in the system's browser: the web view opens nothing itself. Only
/// GitHub addresses, passed to the system as an argument (no shell).
#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    let ok = url.starts_with("https://github.com/") && url.len() < 300 && url.chars().all(|c| c.is_ascii_graphic());
    if !ok {
        return Err(format!("{url} is not a GitHub address"));
    }
    #[cfg(target_os = "windows")]
    let mut open = std::process::Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut open = std::process::Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut open = std::process::Command::new("xdg-open");
    open.arg(&url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            let window = Arc::new(Window { app: app.handle().clone(), frames: Mutex::new(None), audio: audio::Output::start() });
            let session = Session::spawn(root, Box::new(fma_fetch::GithubSource::new()), window.clone())?;
            app.manage(App { session, window });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![send, frames, native_manifest, native_file, open_link])
        .run(tauri::generate_context!())
        .expect("the window could not be opened");
}
