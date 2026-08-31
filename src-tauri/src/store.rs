use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

use crate::{
    error::{CatalogOperationError, CatalogResult},
    models::CatalogData,
};

pub struct LocalJsonStore {
    data_path: PathBuf,
    backup_path: PathBuf,
    temporary_path: PathBuf,
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn test_directory() -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("project-manager-store-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create test directory");
        path
    }

    #[test]
    fn saves_and_loads_a_catalog_snapshot() {
        let directory = test_directory();
        let store = LocalJsonStore::new(&directory);
        let mut snapshot = CatalogData::default();
        snapshot.settings.default_project_directory = "C:\\workspace".into();
        store.save(&snapshot).expect("save snapshot");
        assert_eq!(
            store
                .load()
                .expect("load snapshot")
                .settings
                .default_project_directory,
            "C:\\workspace"
        );
        fs::remove_dir_all(directory).expect("remove test directory");
    }

    #[test]
    fn recovers_from_the_backup_without_overwriting_a_broken_primary() {
        let directory = test_directory();
        let store = LocalJsonStore::new(&directory);
        let snapshot = CatalogData::default();
        fs::write(directory.join("project-manager.json"), "{broken").expect("write broken primary");
        fs::write(
            directory.join("project-manager.json.bak"),
            serde_json::to_string(&snapshot).expect("serialize backup"),
        )
        .expect("write backup");
        assert_eq!(store.load().expect("load backup").schema_version, 1);
        assert_eq!(
            fs::read_to_string(directory.join("project-manager.json")).expect("read primary"),
            "{broken"
        );
        fs::remove_dir_all(directory).expect("remove test directory");
    }
}

impl LocalJsonStore {
    pub fn new(directory: &Path) -> Self {
        Self {
            data_path: directory.join("project-manager.json"),
            backup_path: directory.join("project-manager.json.bak"),
            temporary_path: directory.join("project-manager.json.tmp"),
        }
    }

    pub fn load(&self) -> CatalogResult<CatalogData> {
        match self.read_catalog(&self.data_path) {
            Ok(data) => Ok(data),
            Err(primary) => match self.read_catalog(&self.backup_path) {
                Ok(data) => Ok(data),
                Err(backup)
                    if primary.kind() == ErrorKind::NotFound
                        && backup.kind() == ErrorKind::NotFound =>
                {
                    Ok(CatalogData::default())
                }
                Err(_) => Err(CatalogOperationError::new(
                    "STORAGE_UNAVAILABLE",
                    "项目数据无法读取，原文件已保留。",
                )),
            },
        }
    }

    pub fn save(&self, snapshot: &CatalogData) -> CatalogResult<()> {
        if snapshot.schema_version != 1
            || snapshot
                .projects
                .iter()
                .any(|project| project.source != "existing" && project.source != "created")
            || (snapshot.settings.ide.kind != "vscode" && snapshot.settings.ide.kind != "custom")
            || snapshot.settings.project_actions.is_empty()
            || snapshot.settings.project_actions.len() > 8
            || snapshot.settings.project_actions.iter().any(|action| {
                action.id.is_empty()
                    || action.label.is_empty()
                    || !matches!(
                        action.kind.as_str(),
                        "vscode" | "folder" | "repository" | "custom"
                    )
            })
        {
            return Err(CatalogOperationError::new(
                "STORAGE_UNAVAILABLE",
                "拒绝保存无效的项目数据。",
            ));
        }

        let result = (|| -> std::io::Result<()> {
            if let Some(parent) = self.data_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut json = serde_json::to_string_pretty(snapshot)
                .map_err(|error| std::io::Error::new(ErrorKind::InvalidData, error))?;
            json.push('\n');
            fs::write(&self.temporary_path, json)?;
            match fs::copy(&self.data_path, &self.backup_path) {
                Ok(_) => {}
                Err(error) if error.kind() == ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
            if let Err(error) = fs::rename(&self.temporary_path, &self.data_path) {
                if matches!(
                    error.kind(),
                    ErrorKind::AlreadyExists | ErrorKind::PermissionDenied
                ) {
                    match fs::remove_file(&self.data_path) {
                        Ok(_) => {}
                        Err(remove_error) if remove_error.kind() == ErrorKind::NotFound => {}
                        Err(remove_error) => return Err(remove_error),
                    }
                    fs::rename(&self.temporary_path, &self.data_path)?;
                } else {
                    return Err(error);
                }
            }
            Ok(())
        })();

        if result.is_err() {
            let _ = fs::remove_file(&self.temporary_path);
            return Err(CatalogOperationError::new(
                "STORAGE_UNAVAILABLE",
                "项目数据无法保存，请稍后重试。",
            ));
        }
        Ok(())
    }

    fn read_catalog(&self, path: &Path) -> std::io::Result<CatalogData> {
        let raw = fs::read_to_string(path)?;
        let data: CatalogData = serde_json::from_str(&raw)
            .map_err(|error| std::io::Error::new(ErrorKind::InvalidData, error))?;
        if data.schema_version != 1 {
            return Err(std::io::Error::new(
                ErrorKind::InvalidData,
                "unsupported catalog schema",
            ));
        }
        Ok(data)
    }
}
