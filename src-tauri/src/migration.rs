use std::{
    collections::HashMap,
    fs,
    io::{self, ErrorKind, Read},
    path::{Path, PathBuf},
};

use chrono::Utc;
use filetime::{set_file_times, FileTime};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    error::{CatalogOperationError, CatalogResult},
    models::{MigrationCleanupItem, Project, ProjectMigrationPlanItem},
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct MigrationJournalEntry {
    operation_id: String,
    project_id: String,
    source_path: String,
    staging_path: Option<String>,
    target_path: String,
    mode: String,
    phase: String,
    started_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
struct ManifestEntry {
    path: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<String>,
}

pub struct PreparedMigration {
    pub operation_id: String,
    pub target_path: String,
}

pub struct ProjectMigrationService {
    journal_path: PathBuf,
    temporary_journal_path: PathBuf,
}

impl ProjectMigrationService {
    pub fn new(user_data_directory: &Path) -> Self {
        Self {
            journal_path: user_data_directory.join("project-migrations.json"),
            temporary_journal_path: user_data_directory.join("project-migrations.json.tmp"),
        }
    }

    pub fn plan_migration(
        &self,
        project: &Project,
        default_directory: &Path,
    ) -> CatalogResult<ProjectMigrationPlanItem> {
        self.plan(
            &project.id,
            &project.name,
            Path::new(&project.path),
            default_directory,
        )
    }

    pub fn plan(
        &self,
        project_id: &str,
        project_name: &str,
        source: &Path,
        default_directory: &Path,
    ) -> CatalogResult<ProjectMigrationPlanItem> {
        let source = absolute_path(source)?;
        let default_directory = absolute_path(default_directory)?;
        let basename = source.file_name().ok_or_else(|| {
            CatalogOperationError::new("MIGRATION_CONFLICT", "项目目录名称无效。").field("path")
        })?;
        let target = default_directory.join(basename);
        let mut item = ProjectMigrationPlanItem {
            project_id: project_id.into(),
            project_name: project_name.into(),
            source_path: path_string(&source),
            target_path: path_string(&target),
            status: "ready".into(),
            message: None,
        };

        if source == default_directory || default_directory.starts_with(&source) {
            item.status = "invalid".into();
            item.message = Some("项目目录不能是默认存储位置或其祖先目录。".into());
        } else if source.starts_with(&default_directory) {
            item.status = "already-managed".into();
            item.target_path = path_string(&source);
        } else if path_exists(&target)? {
            item.status = "conflict".into();
            item.message = Some("目标路径已存在，不会覆盖或合并。".into());
        }
        Ok(item)
    }

    pub fn prepare_migration(
        &self,
        item: &ProjectMigrationPlanItem,
    ) -> CatalogResult<PreparedMigration> {
        if item.status != "ready" {
            return Err(CatalogOperationError::new(
                "MIGRATION_CONFLICT",
                item.message
                    .clone()
                    .unwrap_or_else(|| "项目当前不可迁移。".into()),
            )
            .field("path"));
        }
        let source = PathBuf::from(&item.source_path);
        let target = PathBuf::from(&item.target_path);
        if path_exists(&target)? {
            return Err(CatalogOperationError::new(
                "MIGRATION_CONFLICT",
                "目标路径已存在，不会覆盖。",
            )
            .field("path"));
        }

        let operation_id = Uuid::new_v4().to_string();
        let staging = target
            .parent()
            .unwrap_or(Path::new("."))
            .join(format!(".project-manager-migration-{operation_id}.tmp"));
        let entry = MigrationJournalEntry {
            operation_id: operation_id.clone(),
            project_id: item.project_id.clone(),
            source_path: item.source_path.clone(),
            staging_path: None,
            target_path: item.target_path.clone(),
            mode: "rename".into(),
            phase: "prepared".into(),
            started_at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        };
        self.add_entry(entry)?;

        match fs::rename(&source, &target) {
            Ok(()) => self.update_entry(&operation_id, |entry| {
                entry.phase = "destination-ready".into()
            })?,
            Err(error) if is_cross_device(&error) => {
                self.update_entry(&operation_id, |entry| {
                    entry.mode = "copy".into();
                    entry.staging_path = Some(path_string(&staging));
                })?;
                let copy_result = (|| -> CatalogResult<()> {
                    copy_tree(&source, &staging).map_err(|_| {
                        CatalogOperationError::new(
                            "MIGRATION_COPY_FAILED",
                            "跨磁盘复制失败，原目录已保留。",
                        )
                        .field("path")
                    })?;
                    if build_manifest(&source)? != build_manifest(&staging)? {
                        return Err(CatalogOperationError::new(
                            "MIGRATION_VERIFY_FAILED",
                            "复制后的项目内容校验不一致，原目录已保留。",
                        )
                        .field("path"));
                    }
                    fs::rename(&staging, &target).map_err(|_| {
                        CatalogOperationError::new(
                            "MIGRATION_COPY_FAILED",
                            "跨磁盘复制失败，原目录已保留。",
                        )
                        .field("path")
                    })?;
                    self.update_entry(&operation_id, |entry| {
                        entry.phase = "destination-ready".into()
                    })?;
                    Ok(())
                })();
                if let Err(copy_error) = copy_result {
                    if path_exists(&staging).unwrap_or(false) && move_to_trash(&staging).is_err() {
                        return Err(CatalogOperationError::new(
                            "MIGRATION_RECOVERY_REQUIRED",
                            format!(
                                "复制失败且暂存目录无法安全清理，请检查：{}",
                                staging.display()
                            ),
                        )
                        .field("path"));
                    }
                    self.remove_entry(&operation_id)?;
                    return Err(copy_error);
                }
            }
            Err(_) => {
                self.remove_entry(&operation_id)?;
                return Err(CatalogOperationError::new(
                    "MIGRATION_COPY_FAILED",
                    format!("无法移动项目目录：{}", source.display()),
                )
                .field("path"));
            }
        }

        Ok(PreparedMigration {
            operation_id,
            target_path: path_string(&target),
        })
    }

    pub fn commit_migration(&self, operation_id: &str) -> CatalogResult<String> {
        let entry = self.require_entry(operation_id)?;
        self.update_entry(operation_id, |entry| {
            entry.phase = "catalog-committed".into()
        })?;
        if entry.mode == "rename" {
            self.remove_entry(operation_id)?;
            return Ok("completed".into());
        }
        let source = Path::new(&entry.source_path);
        if !path_exists(source)? || move_to_trash(source).is_ok() {
            self.remove_entry(operation_id)?;
            Ok("completed".into())
        } else {
            self.update_entry(operation_id, |entry| entry.phase = "cleanup-pending".into())?;
            Ok("cleanup-pending".into())
        }
    }

    pub fn rollback_migration(&self, operation_id: &str) -> CatalogResult<()> {
        let entry = self.require_entry(operation_id)?;
        let source = Path::new(&entry.source_path);
        let target = Path::new(&entry.target_path);
        let result = (|| -> CatalogResult<()> {
            if entry.mode == "rename" {
                let source_exists = path_exists(source)?;
                let target_exists = path_exists(target)?;
                if !source_exists && target_exists {
                    fs::rename(target, source).map_err(|_| {
                        CatalogOperationError::new(
                            "MIGRATION_RECOVERY_REQUIRED",
                            "迁移路径无法回滚。",
                        )
                    })?;
                } else if !source_exists || target_exists {
                    return Err(CatalogOperationError::new(
                        "MIGRATION_RECOVERY_REQUIRED",
                        "迁移路径状态不明确。",
                    ));
                }
            } else {
                if !path_exists(source)? {
                    return Err(CatalogOperationError::new(
                        "MIGRATION_RECOVERY_REQUIRED",
                        "迁移源目录已丢失。",
                    ));
                }
                if let Some(staging) = &entry.staging_path {
                    let staging = Path::new(staging);
                    if path_exists(staging)? {
                        move_to_trash(staging)?;
                    }
                }
                if path_exists(target)? {
                    move_to_trash(target)?;
                }
            }
            self.remove_entry(operation_id)
        })();
        result.map_err(|_| {
            CatalogOperationError::new(
                "MIGRATION_RECOVERY_REQUIRED",
                format!(
                    "迁移状态无法自动恢复，请检查源和目标：{} → {}",
                    entry.source_path, entry.target_path
                ),
            )
            .field("path")
        })
    }

    pub fn recover_pending_migrations(
        &self,
        catalog_paths: &HashMap<String, String>,
    ) -> CatalogResult<Vec<MigrationCleanupItem>> {
        for entry in self.read_entries()? {
            let committed = catalog_paths
                .get(&entry.project_id)
                .map(|path| same_path(Path::new(path), Path::new(&entry.target_path)))
                .unwrap_or(false);
            if committed {
                self.commit_migration(&entry.operation_id)?;
            } else {
                self.rollback_migration(&entry.operation_id)?;
            }
        }
        self.get_cleanup_pending()
    }

    pub fn get_cleanup_pending(&self) -> CatalogResult<Vec<MigrationCleanupItem>> {
        Ok(self
            .read_entries()?
            .into_iter()
            .filter(|entry| entry.phase == "cleanup-pending")
            .map(|entry| MigrationCleanupItem {
                operation_id: entry.operation_id,
                project_id: entry.project_id,
                source_path: entry.source_path,
                target_path: entry.target_path,
            })
            .collect())
    }

    pub fn retry_cleanup(&self, operation_id: &str) -> CatalogResult<()> {
        let entry = self.require_entry(operation_id)?;
        if entry.phase != "cleanup-pending" || entry.mode != "copy" {
            return Err(CatalogOperationError::new(
                "MIGRATION_PLAN_CHANGED",
                "该迁移不处于待清理状态。",
            ));
        }
        let source = Path::new(&entry.source_path);
        if path_exists(source)? {
            move_to_trash(source).map_err(|_| {
                CatalogOperationError::new(
                    "MIGRATION_CLEANUP_PENDING",
                    format!("原目录仍未移入回收站：{}", entry.source_path),
                )
                .field("path")
            })?;
        }
        self.remove_entry(operation_id)
    }

    fn read_entries(&self) -> CatalogResult<Vec<MigrationJournalEntry>> {
        let raw = match fs::read_to_string(&self.journal_path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(vec![]),
            Err(_) => return Err(journal_error()),
        };
        let entries: Vec<MigrationJournalEntry> =
            serde_json::from_str(&raw).map_err(|_| journal_error())?;
        if entries.iter().any(|entry| !valid_entry(entry)) {
            return Err(journal_error());
        }
        Ok(entries)
    }

    fn write_entries(&self, entries: &[MigrationJournalEntry]) -> CatalogResult<()> {
        if let Some(parent) = self.journal_path.parent() {
            fs::create_dir_all(parent).map_err(|_| journal_error())?;
        }
        let mut json = serde_json::to_string_pretty(entries).map_err(|_| journal_error())?;
        json.push('\n');
        fs::write(&self.temporary_journal_path, json).map_err(|_| journal_error())?;
        fs::rename(&self.temporary_journal_path, &self.journal_path)
            .map_err(|_| journal_error())?;
        Ok(())
    }

    fn add_entry(&self, entry: MigrationJournalEntry) -> CatalogResult<()> {
        let mut entries = self.read_entries()?;
        entries.push(entry);
        self.write_entries(&entries)
    }

    fn update_entry(
        &self,
        operation_id: &str,
        update: impl FnOnce(&mut MigrationJournalEntry),
    ) -> CatalogResult<()> {
        let mut entries = self.read_entries()?;
        let entry = entries
            .iter_mut()
            .find(|entry| entry.operation_id == operation_id)
            .ok_or_else(|| {
                CatalogOperationError::new("MIGRATION_RECOVERY_REQUIRED", "迁移日志项不存在。")
            })?;
        update(entry);
        self.write_entries(&entries)
    }

    fn remove_entry(&self, operation_id: &str) -> CatalogResult<()> {
        let mut entries = self.read_entries()?;
        entries.retain(|entry| entry.operation_id != operation_id);
        self.write_entries(&entries)
    }

    fn require_entry(&self, operation_id: &str) -> CatalogResult<MigrationJournalEntry> {
        self.read_entries()?
            .into_iter()
            .find(|entry| entry.operation_id == operation_id)
            .ok_or_else(|| {
                CatalogOperationError::new("MIGRATION_PLAN_CHANGED", "迁移操作不存在或已完成。")
            })
    }
}

fn journal_error() -> CatalogOperationError {
    CatalogOperationError::new(
        "MIGRATION_RECOVERY_REQUIRED",
        "迁移恢复日志无法读取，请先处理日志文件。",
    )
}

fn valid_entry(entry: &MigrationJournalEntry) -> bool {
    if entry.operation_id.is_empty()
        || entry.operation_id.len() > 200
        || !entry
            .operation_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
        || !Path::new(&entry.source_path).is_absolute()
        || !Path::new(&entry.target_path).is_absolute()
        || !matches!(entry.mode.as_str(), "rename" | "copy")
        || !matches!(
            entry.phase.as_str(),
            "prepared" | "destination-ready" | "catalog-committed" | "cleanup-pending"
        )
        || Path::new(&entry.source_path).file_name() != Path::new(&entry.target_path).file_name()
    {
        return false;
    }
    match entry.mode.as_str() {
        "rename" => entry.staging_path.is_none(),
        "copy" => entry
            .staging_path
            .as_ref()
            .map(|staging| {
                let staging = Path::new(staging);
                staging.is_absolute()
                    && staging.parent() == Path::new(&entry.target_path).parent()
                    && staging.file_name().and_then(|name| name.to_str())
                        == Some(
                            format!(".project-manager-migration-{}.tmp", entry.operation_id)
                                .as_str(),
                        )
            })
            .unwrap_or(false),
        _ => false,
    }
}

fn absolute_path(path: &Path) -> CatalogResult<PathBuf> {
    if !path.is_absolute() {
        return Err(
            CatalogOperationError::new("INVALID_INPUT", "请选择有效的绝对目录路径。").field("path"),
        );
    }
    Ok(path.to_path_buf())
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn path_exists(path: &Path) -> CatalogResult<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(_) => Err(CatalogOperationError::new(
            "MIGRATION_RECOVERY_REQUIRED",
            format!("无法检查路径：{}", path.display()),
        )
        .field("path")),
    }
}

fn same_path(left: &Path, right: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        path_string(left).to_lowercase() == path_string(right).to_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        left == right
    }
}

fn is_cross_device(error: &io::Error) -> bool {
    if error.kind() == ErrorKind::CrossesDevices {
        return true;
    }
    #[cfg(target_os = "windows")]
    {
        error.raw_os_error() == Some(17)
    }
    #[cfg(not(target_os = "windows"))]
    {
        error.raw_os_error() == Some(18)
    }
}

fn move_to_trash(path: &Path) -> CatalogResult<()> {
    trash::delete(path).map_err(|_| {
        CatalogOperationError::new(
            "MIGRATION_CLEANUP_PENDING",
            format!("无法移入系统回收站：{}", path.display()),
        )
        .field("path")
    })
}

fn copy_tree(source: &Path, destination: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(source)?;
    if metadata.file_type().is_symlink() {
        return copy_symlink(source, destination);
    }
    if metadata.is_file() {
        fs::copy(source, destination)?;
        fs::set_permissions(destination, metadata.permissions())?;
        return set_times(destination, &metadata);
    }
    if !metadata.is_dir() {
        return Err(io::Error::new(
            ErrorKind::InvalidData,
            "unsupported file node",
        ));
    }
    fs::create_dir(destination)?;
    let mut entries = fs::read_dir(source)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        copy_tree(&entry.path(), &destination.join(entry.file_name()))?;
    }
    fs::set_permissions(destination, metadata.permissions())?;
    set_times(destination, &metadata)
}

fn set_times(path: &Path, metadata: &fs::Metadata) -> io::Result<()> {
    set_file_times(
        path,
        FileTime::from_last_access_time(metadata),
        FileTime::from_last_modification_time(metadata),
    )
}

#[cfg(unix)]
fn copy_symlink(source: &Path, destination: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(fs::read_link(source)?, destination)
}

#[cfg(windows)]
fn copy_symlink(source: &Path, destination: &Path) -> io::Result<()> {
    let target = fs::read_link(source)?;
    if fs::metadata(source)
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false)
    {
        std::os::windows::fs::symlink_dir(target, destination)
    } else {
        std::os::windows::fs::symlink_file(target, destination)
    }
}

fn build_manifest(root: &Path) -> CatalogResult<Vec<ManifestEntry>> {
    fn visit(root: &Path, directory: &Path, result: &mut Vec<ManifestEntry>) -> CatalogResult<()> {
        let mut entries = fs::read_dir(directory)
            .map_err(|_| {
                CatalogOperationError::new("MIGRATION_VERIFY_FAILED", "无法读取复制后的项目内容。")
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| {
                CatalogOperationError::new("MIGRATION_VERIFY_FAILED", "无法读取复制后的项目内容。")
            })?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let path = entry.path();
            let relative = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let metadata = fs::symlink_metadata(&path).map_err(|_| {
                CatalogOperationError::new("MIGRATION_VERIFY_FAILED", "无法校验复制后的项目内容。")
            })?;
            if metadata.file_type().is_symlink() {
                let target = fs::read_link(&path).map_err(|_| {
                    CatalogOperationError::new("MIGRATION_VERIFY_FAILED", "无法读取项目符号链接。")
                })?;
                result.push(ManifestEntry {
                    path: relative,
                    kind: "symlink".into(),
                    size: None,
                    hash: None,
                    target: Some(path_string(&target)),
                });
            } else if metadata.is_dir() {
                result.push(ManifestEntry {
                    path: relative,
                    kind: "directory".into(),
                    size: None,
                    hash: None,
                    target: None,
                });
                visit(root, &path, result)?;
            } else if metadata.is_file() {
                result.push(ManifestEntry {
                    path: relative,
                    kind: "file".into(),
                    size: Some(metadata.len()),
                    hash: Some(hash_file(&path)?),
                    target: None,
                });
            } else {
                return Err(CatalogOperationError::new(
                    "MIGRATION_VERIFY_FAILED",
                    format!("项目包含不支持的文件节点：{relative}"),
                )
                .field("path"));
            }
        }
        Ok(())
    }
    let mut result = vec![];
    visit(root, root, &mut result)?;
    Ok(result)
}

fn hash_file(path: &Path) -> CatalogResult<String> {
    let mut file = fs::File::open(path).map_err(|_| {
        CatalogOperationError::new("MIGRATION_VERIFY_FAILED", "无法读取项目文件进行校验。")
    })?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|_| {
            CatalogOperationError::new("MIGRATION_VERIFY_FAILED", "无法读取项目文件进行校验。")
        })?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_directory() -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("project-manager-migration-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create test directory");
        path
    }

    #[test]
    fn plans_managed_ready_and_conflicting_projects() {
        let root = test_directory();
        let data = root.join("data");
        let outside = root.join("outside");
        fs::create_dir_all(data.join("managed")).unwrap();
        fs::create_dir_all(outside.join("ready")).unwrap();
        fs::create_dir_all(outside.join("conflict")).unwrap();
        fs::create_dir_all(data.join("conflict")).unwrap();
        let service = ProjectMigrationService::new(&root);

        assert_eq!(
            service
                .plan("1", "managed", &data.join("managed"), &data)
                .unwrap()
                .status,
            "already-managed"
        );
        assert_eq!(
            service
                .plan("2", "ready", &outside.join("ready"), &data)
                .unwrap()
                .status,
            "ready"
        );
        assert_eq!(
            service
                .plan("3", "conflict", &outside.join("conflict"), &data)
                .unwrap()
                .status,
            "conflict"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn same_volume_prepare_can_be_rolled_back() {
        let root = test_directory();
        let source = root.join("outside").join("project");
        let destination = root.join("managed");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&destination).unwrap();
        fs::write(source.join("readme.txt"), "content").unwrap();
        let service = ProjectMigrationService::new(&root.join("state"));
        let plan = service
            .plan("project-id", "project", &source, &destination)
            .unwrap();
        let prepared = service.prepare_migration(&plan).unwrap();
        assert!(Path::new(&prepared.target_path).join("readme.txt").exists());
        service.rollback_migration(&prepared.operation_id).unwrap();
        assert_eq!(
            fs::read_to_string(source.join("readme.txt")).unwrap(),
            "content"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
