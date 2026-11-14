//! The library's commands, answered. No thread of its own: `handle` runs the command and
//! returns when it is done (a download takes as long as it takes).

use crate::{Command, Event, Transport};
use fma_fetch::{Error, Library, Source};

pub struct LibraryService {
    library: Library,
    source: Box<dyn Source + Send>,
}

impl LibraryService {
    pub fn new(library: Library, source: Box<dyn Source + Send>) -> Self {
        Self { library, source }
    }

    /// Run a library command (`false`: it is not one, nothing was done).
    pub fn handle(&self, command: &Command, out: &dyn Transport) -> bool {
        if !command.is_library() {
            return false;
        }
        if let Err(e) = self.run(command, out) {
            out.event(Event::Error { command: name(command).to_owned(), message: e.to_string() });
        }
        true
    }

    fn run(&self, command: &Command, out: &dyn Transport) -> Result<(), Error> {
        let (library, source) = (&self.library, self.source.as_ref());
        match command {
            Command::ListLibrary => self.list(out)?,
            Command::Resolve { link } => out.event(Event::Choose { release: source.resolve(link)? }),
            Command::Add { link } => {
                let release = source.resolve(link)?;
                match release.assets.as_slice() {
                    [asset] => {
                        let firmware = library.install(source, &release, asset)?;
                        out.event(Event::Added { firmware });
                        self.list(out)?;
                    }
                    _ => out.event(Event::Choose { release }),
                }
            }
            Command::Install { release, asset } => {
                let asset = release.assets.iter().find(|a| a.name == *asset)
                    .ok_or_else(|| Error::Invalid(format!("release {} has no package {asset}", release.tag)))?;
                let firmware = library.install(source, release, asset)?;
                out.event(Event::Added { firmware });
                self.list(out)?;
            }
            Command::CheckUpdate { id } => {
                let fw = library.get(id)?.ok_or_else(|| not_here(id))?;
                out.event(Event::Update { id: id.clone(), release: library.check_update(source, &fw)? });
            }
            Command::Remove { id } => {
                if !library.remove(id)? {
                    return Err(not_here(id));
                }
                out.event(Event::Removed { id: id.clone() });
                self.list(out)?;
            }
            // (a native client has the emulator, and no use for a browser's builds)
            Command::ListBuilds => out.event(Event::Builds { builds: Vec::new() }),
            Command::Start { .. } | Command::StartBuild { .. } | Command::Stop | Command::Input { .. } => {}
        }
        Ok(())
    }

    fn list(&self, out: &dyn Transport) -> Result<(), Error> {
        out.event(Event::Library { firmwares: self.library.list()? });
        Ok(())
    }
}

pub(crate) fn not_here(id: &str) -> Error {
    Error::Invalid(format!("{id} is not in the library"))
}

/// A command's `type`, as its JSON has it.
pub(crate) fn name(command: &Command) -> &'static str {
    match command {
        Command::ListLibrary => "list_library",
        Command::Add { .. } => "add",
        Command::Resolve { .. } => "resolve",
        Command::Install { .. } => "install",
        Command::CheckUpdate { .. } => "check_update",
        Command::Remove { .. } => "remove",
        Command::Start { .. } => "start",
        Command::Stop => "stop",
        Command::Input { .. } => "input",
        Command::ListBuilds => "list_builds",
        Command::StartBuild { .. } => "start_build",
    }
}
