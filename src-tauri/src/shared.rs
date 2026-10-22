//! Projects shared through a folder every engineer's machine can see — a
//! SharePoint library synced by OneDrive, a mapped drive, a Git checkout.
//!
//! Each kept project is its folder export, `project.corelens` with a
//! readable `project.yaml` beside it, written there after every local save
//! and read back before every open; the local database stays each machine's
//! working copy, because a database on a share has no safe locking. A
//! `project.lock` beside the files names who has the project open. It
//! informs rather than forbids: a second engineer is told who is in and that
//! the later save wins, and a lock nobody has refreshed for a few minutes is
//! treated as left behind by a session that is gone.
//!
//! The page never names the folder a save goes to. It is read here from the
//! project's own stored setting, so a message from the page can write into
//! the one folder somebody chose for that project, and nowhere else.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::AppState;
use crate::db;

pub const PROJECT_FILE: &str = "project.corelens";
pub const YAML_FILE: &str = "project.yaml";
pub const LOCK_FILE: &str = "project.lock";
/// A lock not refreshed for this long belongs to a session that is gone.
pub const LOCK_STALE_MS: i64 = 3 * 60 * 1000;
/// The setting naming the company folder; this computer's.
pub const SHARED_ROOT_KEY: &str = "sharedProjectsFolder";
/// The setting naming where one project is kept; the project's.
pub const PROJECT_FOLDER_KEY: &str = "projectFolder";
const MAX_FILE: u64 = 64 * 1024 * 1024;

/// Who this is, for the lock file: the operating system's user and
/// the machine's name. Not a secret, and not an identity anyone logs in
/// with — a label for the colleague reading the lock.
#[derive(Clone, Debug, PartialEq)]
pub struct Identity {
    pub engineer: String,
    pub machine: String,
}

impl Identity {
    pub fn here() -> Self {
        let engineer = ["USER", "USERNAME", "LOGNAME"]
            .iter()
            .find_map(|k| std::env::var(k).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "someone".into());
        let machine = ["COMPUTERNAME", "HOSTNAME"]
            .iter()
            .find_map(|k| std::env::var(k).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| std::fs::read_to_string("/etc/hostname").ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))
            .unwrap_or_else(|| "another computer".into());
        Self { engineer, machine }
    }
}

/// `project.lock` as it is written.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Lock {
    pub engineer: String,
    pub machine: String,
    pub since_ms: i64,
    pub seen_ms: i64,
}

/// A lock as the page sees it: whose it is, and whether it still counts.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LockView {
    pub engineer: String,
    pub machine: String,
    pub since_ms: i64,
    pub seen_ms: i64,
    pub mine: bool,
    pub stale: bool,
}

impl Lock {
    fn view(&self, me: &Identity, now_ms: i64) -> LockView {
        LockView {
            engineer: self.engineer.clone(),
            machine: self.machine.clone(),
            since_ms: self.since_ms,
            seen_ms: self.seen_ms,
            mine: self.engineer == me.engineer && self.machine == me.machine,
            stale: now_ms - self.seen_ms > LOCK_STALE_MS,
        }
    }
}

/// One project found in the shared folder.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SharedEntry {
    pub folder: String,
    pub id: String,
    pub name: String,
    pub customer: String,
    pub site: String,
    pub ticket: String,
    pub engineer: String,
    pub updated_at: i64,
    pub lock: Option<LockView>,
}

/// The shared copy of one kept project, as it stands.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeptStatus {
    pub folder: String,
    pub exists: bool,
    pub updated_at: Option<i64>,
    pub lock: Option<LockView>,
}

/// What a write did.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Written {
    pub folder: String,
    /// The `updatedAt` of a shared copy newer than the one this machine
    /// last saw, which this write replaced.
    pub overwrote: Option<i64>,
    pub lock: Option<LockView>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn read_lock(dir: &Path) -> Option<Lock> {
    let text = std::fs::read_to_string(dir.join(LOCK_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_lock(dir: &Path, lock: &Lock) -> Result<(), String> {
    let body = serde_json::to_string_pretty(lock).map_err(|e| e.to_string())?;
    write_whole(dir, LOCK_FILE, &body)
}

/// Written beside itself and renamed into place, so a sync client or a
/// crash never sees half a file.
fn write_whole(dir: &Path, file: &str, body: &str) -> Result<(), String> {
    let target = dir.join(file);
    let tmp = dir.join(format!(".{file}.part"));
    std::fs::write(&tmp, body).map_err(|e| format!("Could not write {}: {e}", target.display()))?;
    std::fs::rename(&tmp, &target).map_err(|e| format!("Could not write {}: {e}", target.display()))
}

/// Takes the lock when it is free, stale, or already this machine's, and
/// refreshes it; otherwise leaves the holder's in place and says whose it is.
pub fn take_lock(dir: &Path, me: &Identity, now_ms: i64) -> Result<LockView, String> {
    if let Some(theirs) = read_lock(dir) {
        let view = theirs.view(me, now_ms);
        if !view.mine && !view.stale {
            return Ok(view);
        }
        let mine = Lock { engineer: me.engineer.clone(), machine: me.machine.clone(), since_ms: if view.mine { theirs.since_ms } else { now_ms }, seen_ms: now_ms };
        write_lock(dir, &mine)?;
        return Ok(mine.view(me, now_ms));
    }
    let mine = Lock { engineer: me.engineer.clone(), machine: me.machine.clone(), since_ms: now_ms, seen_ms: now_ms };
    write_lock(dir, &mine)?;
    Ok(mine.view(me, now_ms))
}

/// Removes the lock when it is this machine's; somebody else's is left.
pub fn release_lock(dir: &Path, me: &Identity) -> Result<(), String> {
    if let Some(lock) = read_lock(dir) {
        if lock.view(me, 0).mine {
            std::fs::remove_file(dir.join(LOCK_FILE)).map_err(|e| format!("Could not remove the lock: {e}"))?;
        }
    }
    Ok(())
}

fn meta_field(value: &serde_json::Value, key: &str) -> String {
    value.get("meta").and_then(|m| m.get(key)).and_then(|v| v.as_str()).unwrap_or("").to_string()
}

fn meta_updated_at(value: &serde_json::Value) -> i64 {
    value.get("meta").and_then(|m| m.get("updatedAt").or_else(|| m.get("updated_at"))).and_then(|v| v.as_i64()).unwrap_or(0)
}

fn read_capped(path: &Path) -> Result<String, String> {
    let size = std::fs::metadata(path).map_err(|e| format!("Could not read {}: {e}", path.display()))?.len();
    if size > MAX_FILE {
        return Err(format!("{} is {} MB, which is larger than any Corelens project.", path.display(), size / (1024 * 1024)));
    }
    std::fs::read_to_string(path).map_err(|e| format!("Could not read {}: {e}", path.display()))
}

/// Every `*/project.corelens` directly under the shared folder, by name.
/// A folder that holds no project, or one that does not parse, is passed
/// over rather than failing the list — a company folder holds other things.
pub fn list_shared(root: &Path, me: &Identity, now_ms: i64) -> Result<Vec<SharedEntry>, String> {
    if !root.is_absolute() || !root.is_dir() {
        return Err(format!("{} is not a folder that exists.", root.display()));
    }
    let mut out = Vec::new();
    let entries = std::fs::read_dir(root).map_err(|e| format!("Could not read {}: {e}", root.display()))?;
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let file = dir.join(PROJECT_FILE);
        if !file.is_file() {
            continue;
        }
        let Ok(text) = read_capped(&file) else { continue };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        let id = meta_field(&value, "id");
        if id.is_empty() {
            continue;
        }
        out.push(SharedEntry {
            folder: dir.display().to_string(),
            id,
            name: meta_field(&value, "name"),
            customer: meta_field(&value, "customer"),
            site: meta_field(&value, "site"),
            ticket: meta_field(&value, "ticket"),
            engineer: meta_field(&value, "engineer"),
            updated_at: meta_updated_at(&value),
            lock: read_lock(&dir).map(|l| l.view(me, now_ms)),
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then(a.id.cmp(&b.id)));
    Ok(out)
}

/// Where a kept project's folder stands.
pub fn kept_status(dir: &Path, me: &Identity, now_ms: i64) -> KeptStatus {
    let file = dir.join(PROJECT_FILE);
    let updated_at = read_capped(&file).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok()).map(|v| meta_updated_at(&v));
    KeptStatus { folder: dir.display().to_string(), exists: updated_at.is_some(), updated_at, lock: read_lock(dir).map(|l| l.view(me, now_ms)) }
}

/// The shared copy's `project.corelens`, as text for the page to open.
pub fn read_kept(dir: &Path) -> Result<String, String> {
    read_capped(&dir.join(PROJECT_FILE))
}

/// Writes the shared copy, takes or refreshes the lock, and says whether
/// a copy newer than `known_updated_at` — somebody else's save since this
/// machine last read it — was replaced.
pub fn write_kept(dir: &Path, json: &str, yaml: &str, me: &Identity, now_ms: i64, known_updated_at: Option<i64>) -> Result<Written, String> {
    if !dir.is_absolute() {
        return Err(format!("{} is not a folder that exists.", dir.display()));
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    let before = kept_status(dir, me, now_ms);
    let overwrote = match (before.updated_at, known_updated_at) {
        (Some(theirs), Some(known)) if theirs > known => Some(theirs),
        _ => None,
    };
    write_whole(dir, PROJECT_FILE, json)?;
    write_whole(dir, YAML_FILE, yaml)?;
    let lock = take_lock(dir, me, now_ms).ok();
    Ok(Written { folder: dir.display().to_string(), overwrote, lock })
}

/// Makes `root/name` for a project to be kept in. The name becomes one
/// folder, so anything that would climb out of the shared folder is
/// refused.
pub fn link_folder(root: &Path, name: &str) -> Result<PathBuf, String> {
    if !root.is_absolute() || !root.is_dir() {
        return Err(format!("{} is not a folder that exists.", root.display()));
    }
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', '\0']) {
        return Err("The project folder needs a plain name.".into());
    }
    let dir = root.join(name);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// A folder the page names must be a direct child of the shared folder
/// that holds a project — the list this page was shown came from there.
pub fn child_of(root: &Path, folder: &str) -> Result<PathBuf, String> {
    let dir = PathBuf::from(folder);
    let parent_ok = dir.parent().map(|p| p == root).unwrap_or(false);
    if !dir.is_absolute() || !parent_ok || !dir.join(PROJECT_FILE).is_file() {
        return Err(format!("{folder} is not a project folder inside {}.", root.display()));
    }
    Ok(dir)
}

// ---------------------------------------------------------------- commands

fn db_err(e: impl std::fmt::Display) -> String {
    format!("Local database error: {e}")
}

fn shared_root(conn: &rusqlite::Connection) -> Result<Option<PathBuf>, String> {
    Ok(db::all_settings(conn).map_err(db_err)?.get(SHARED_ROOT_KEY).map(|s| s.trim()).filter(|s| !s.is_empty()).map(PathBuf::from))
}

fn project_folder(conn: &rusqlite::Connection, project_id: &str) -> Result<Option<PathBuf>, String> {
    if project_id.trim().is_empty() {
        return Ok(None);
    }
    Ok(db::project_settings(conn, project_id).map_err(db_err)?.get(PROJECT_FOLDER_KEY).map(|s| s.trim()).filter(|s| !s.is_empty()).map(PathBuf::from))
}

/// Every project in the shared folder; none when no folder is chosen.
#[tauri::command(async)]
pub fn list_shared_projects(state: State<'_, AppState>) -> Result<Vec<SharedEntry>, String> {
    let root = {
        let conn = state.db.lock().map_err(db_err)?;
        shared_root(&conn)?
    };
    match root {
        Some(root) => list_shared(&root, &Identity::here(), now_ms()),
        None => Ok(Vec::new()),
    }
}

/// Keeps a project in `<shared>/<name>` from now on: the folder is made
/// and remembered as the project's. The page writes the files with
/// `keep_project` next.
#[tauri::command(async)]
pub fn link_project_folder(state: State<'_, AppState>, project_id: String, name: String) -> Result<String, String> {
    let conn = state.db.lock().map_err(db_err)?;
    let root = shared_root(&conn)?.ok_or("Choose the shared projects folder first, under Settings → Shared projects.")?;
    if project_id.trim().is_empty() {
        return Err("No project is open.".into());
    }
    let dir = link_folder(&root, &name)?;
    db::set_project_setting(&conn, &project_id, PROJECT_FOLDER_KEY, Some(&dir.display().to_string())).map_err(db_err)?;
    Ok(dir.display().to_string())
}

/// Stops keeping a project in its folder. The files there are left;
/// this machine's lock is released.
#[tauri::command(async)]
pub fn unlink_project_folder(state: State<'_, AppState>, project_id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(db_err)?;
    if let Some(dir) = project_folder(&conn, &project_id)? {
        let _ = release_lock(&dir, &Identity::here());
    }
    db::set_project_setting(&conn, &project_id, PROJECT_FOLDER_KEY, None).map_err(db_err)
}

/// A project in the shared folder, brought onto this machine: its text
/// for the page to save under its own id, and the folder remembered as
/// that project's. The folder must be one the shared list showed.
#[tauri::command(async)]
pub fn adopt_shared_project(state: State<'_, AppState>, folder: String) -> Result<String, String> {
    let conn = state.db.lock().map_err(db_err)?;
    let root = shared_root(&conn)?.ok_or("No shared projects folder is chosen.")?;
    let dir = child_of(&root, &folder)?;
    let text = read_kept(&dir)?;
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("{} is not a Corelens project: {e}", dir.display()))?;
    let id = meta_field(&value, "id");
    if id.is_empty() {
        return Err(format!("{} has no project id.", dir.display()));
    }
    db::set_project_setting(&conn, &id, PROJECT_FOLDER_KEY, Some(&dir.display().to_string())).map_err(db_err)?;
    Ok(text)
}

/// Where a kept project's shared copy stands; `None` for a project
/// not kept anywhere.
#[tauri::command(async)]
pub fn kept_project_status(state: State<'_, AppState>, project_id: String) -> Result<Option<KeptStatus>, String> {
    let dir = {
        let conn = state.db.lock().map_err(db_err)?;
        project_folder(&conn, &project_id)?
    };
    Ok(dir.map(|d| kept_status(&d, &Identity::here(), now_ms())))
}

/// The shared copy's text, for a project kept in a folder.
#[tauri::command(async)]
pub fn read_kept_project(state: State<'_, AppState>, project_id: String) -> Result<String, String> {
    let dir = {
        let conn = state.db.lock().map_err(db_err)?;
        project_folder(&conn, &project_id)?
    };
    read_kept(&dir.ok_or("This project is not kept in a shared folder.")?)
}

/// Writes the shared copy of a kept project — into the folder stored
/// for it, never one the page names.
#[tauri::command(async)]
pub fn keep_project(state: State<'_, AppState>, project_id: String, json: String, yaml: String, known_updated_at: Option<i64>) -> Result<Written, String> {
    let dir = {
        let conn = state.db.lock().map_err(db_err)?;
        project_folder(&conn, &project_id)?
    };
    write_kept(&dir.ok_or("This project is not kept in a shared folder.")?, &json, &yaml, &Identity::here(), now_ms(), known_updated_at)
}

/// Takes or refreshes this machine's lock on a kept project; says whose
/// it is when it is somebody else's.
#[tauri::command(async)]
pub fn keep_project_lock(state: State<'_, AppState>, project_id: String) -> Result<Option<LockView>, String> {
    let dir = {
        let conn = state.db.lock().map_err(db_err)?;
        project_folder(&conn, &project_id)?
    };
    match dir {
        Some(dir) if dir.is_dir() => take_lock(&dir, &Identity::here(), now_ms()).map(Some),
        _ => Ok(None),
    }
}

/// Releases this machine's lock on a kept project, if it holds it.
#[tauri::command(async)]
pub fn release_project_lock(state: State<'_, AppState>, project_id: String) -> Result<(), String> {
    let dir = {
        let conn = state.db.lock().map_err(db_err)?;
        project_folder(&conn, &project_id)?
    };
    match dir {
        Some(dir) if dir.is_dir() => release_lock(&dir, &Identity::here()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cv-shared-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn me() -> Identity {
        Identity { engineer: "sam".into(), machine: "laptop-1".into() }
    }

    fn other() -> Identity {
        Identity { engineer: "alex".into(), machine: "desk-7".into() }
    }

    fn project(id: &str, name: &str, updated: i64) -> String {
        format!(r#"{{"meta":{{"id":"{id}","name":"{name}","customer":"Example Co","site":"HQ","ticket":"","engineer":"","createdAt":1,"updatedAt":{updated},"archived":false}},"documentVersion":1,"document":{{"pages":[]}}}}"#)
    }

    /// A free lock is taken; a fresh one of somebody else's is reported,
    /// not replaced; a stale one is taken over; one's own is refreshed and
    /// keeps its start; a release removes only one's own.
    #[test]
    fn the_lock_informs_and_a_stale_one_is_taken_over() {
        let dir = scratch("lock");
        let t0 = 1_700_000_000_000;
        let first = take_lock(&dir, &me(), t0).unwrap();
        assert!(first.mine && !first.stale && first.since_ms == t0);
        // Somebody else, a minute later: told it is held.
        let held = take_lock(&dir, &other(), t0 + 60_000).unwrap();
        assert_eq!((held.engineer.as_str(), held.machine.as_str(), held.mine, held.stale), ("sam", "laptop-1", false, false));
        assert_eq!(read_lock(&dir).unwrap().engineer, "sam", "left in place");
        // The holder refreshes: the start is kept, the seen time moves.
        let again = take_lock(&dir, &me(), t0 + 120_000).unwrap();
        assert_eq!((again.since_ms, again.seen_ms, again.mine), (t0, t0 + 120_000, true));
        // Nobody refreshes it for longer than the stale window: taken over.
        let taken = take_lock(&dir, &other(), t0 + 120_000 + LOCK_STALE_MS + 1).unwrap();
        assert!(taken.mine, "{taken:?}");
        assert_eq!(read_lock(&dir).unwrap().engineer, "alex");
        // A release by someone who does not hold it leaves it.
        release_lock(&dir, &me()).unwrap();
        assert!(dir.join(LOCK_FILE).exists());
        release_lock(&dir, &other()).unwrap();
        assert!(!dir.join(LOCK_FILE).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// The shared folder lists each project folder under it, by name,
    /// with its lock; other folders and files are passed over.
    #[test]
    fn a_shared_folder_lists_its_projects_and_nothing_else() {
        let root = scratch("list");
        for (sub, body) in [("zeta-site", project("p-z", "Zeta site", 5)), ("alpha-core", project("p-a", "Alpha core", 9))] {
            let dir = root.join(sub);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join(PROJECT_FILE), body).unwrap();
        }
        std::fs::create_dir_all(root.join("minutes")).unwrap();
        std::fs::write(root.join("minutes/notes.txt"), "not a project").unwrap();
        std::fs::create_dir_all(root.join("broken")).unwrap();
        std::fs::write(root.join("broken").join(PROJECT_FILE), "{not json").unwrap();
        std::fs::write(root.join("stray.corelens"), "{}").unwrap();
        take_lock(&root.join("alpha-core"), &other(), 1_000).unwrap();
        let list = list_shared(&root, &me(), 2_000).unwrap();
        assert_eq!(list.iter().map(|e| (e.name.as_str(), e.id.as_str(), e.updated_at)).collect::<Vec<_>>(), [("Alpha core", "p-a", 9), ("Zeta site", "p-z", 5)]);
        let lock = list[0].lock.as_ref().unwrap();
        assert_eq!((lock.engineer.as_str(), lock.mine, lock.stale), ("alex", false, false));
        assert!(list[1].lock.is_none());
        assert_eq!(list[0].customer, "Example Co");
        assert!(list_shared(&root.join("missing"), &me(), 0).is_err());
        assert!(list_shared(Path::new("relative"), &me(), 0).is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// A write puts both files in place, takes the lock, and says when
    /// it replaced a copy newer than the one this machine last saw.
    #[test]
    fn a_write_keeps_both_files_and_names_what_it_overwrote() {
        let dir = scratch("write").join("kept");
        let first = write_kept(&dir, &project("p-1", "Kept", 100), "a: 1\n", &me(), 1_000, None).unwrap();
        assert_eq!(first.overwrote, None);
        assert!(first.lock.as_ref().unwrap().mine);
        assert_eq!(std::fs::read_to_string(dir.join(YAML_FILE)).unwrap(), "a: 1\n");
        assert!(!dir.join(format!(".{PROJECT_FILE}.part")).exists());
        let status = kept_status(&dir, &me(), 1_000);
        assert_eq!((status.exists, status.updated_at), (true, Some(100)));
        // Somebody else saved 200 while this machine last saw 100.
        std::fs::write(dir.join(PROJECT_FILE), project("p-1", "Kept", 200)).unwrap();
        let second = write_kept(&dir, &project("p-1", "Kept", 300), "a: 3\n", &me(), 2_000, Some(100)).unwrap();
        assert_eq!(second.overwrote, Some(200), "the newer copy it replaced");
        // Seen up to date: nothing overwritten.
        let third = write_kept(&dir, &project("p-1", "Kept", 400), "a: 4\n", &me(), 3_000, Some(300)).unwrap();
        assert_eq!(third.overwrote, None);
        assert_eq!(read_kept(&dir).unwrap(), project("p-1", "Kept", 400));
        assert!(write_kept(Path::new("relative/kept"), "{}", "", &me(), 0, None).is_err());
        std::fs::remove_dir_all(dir.parent().unwrap()).unwrap();
    }

    /// A kept folder is made inside the shared folder under a plain name;
    /// a page may adopt only a direct child that holds a project.
    #[test]
    fn a_kept_folder_stays_inside_the_shared_folder() {
        let root = scratch("link");
        let dir = link_folder(&root, "branch-12").unwrap();
        assert_eq!(dir, root.join("branch-12"));
        assert!(dir.is_dir());
        for bad in ["..", "../out", "a/b", "", "."] {
            assert!(link_folder(&root, bad).is_err(), "{bad:?}");
        }
        assert!(link_folder(Path::new("relative"), "x").is_err());
        assert!(child_of(&root, &dir.display().to_string()).is_err(), "no project in it yet");
        std::fs::write(dir.join(PROJECT_FILE), project("p-b", "Branch 12", 1)).unwrap();
        assert_eq!(child_of(&root, &dir.display().to_string()).unwrap(), dir);
        let nested = dir.join("deeper");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join(PROJECT_FILE), project("p-n", "Nested", 1)).unwrap();
        assert!(child_of(&root, &nested.display().to_string()).is_err(), "not a direct child");
        assert!(child_of(&root, &root.parent().unwrap().display().to_string()).is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// Who this is comes from the environment, and is never empty.
    #[test]
    fn an_identity_is_never_blank() {
        let id = Identity::here();
        assert!(!id.engineer.is_empty() && !id.machine.is_empty());
    }
}
