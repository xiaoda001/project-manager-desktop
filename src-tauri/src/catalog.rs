use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use chrono::{SecondsFormat, Utc};
use uuid::Uuid;

use crate::{
    error::{CatalogOperationError, CatalogResult},
    migration::ProjectMigrationService,
    models::{
        AppSettings, CatalogData, Category, CreateCategoryInput, CreateEmptyProjectInput,
        ExecuteMigrationsInput, ImportExistingProjectInput, MigrationBatch, MigrationItemResult,
        MigrationPlan, Project, UpdateProjectInput,
    },
    store::LocalJsonStore,
};

pub struct ProjectCatalog {
    store: LocalJsonStore,
    migration: ProjectMigrationService,
    data: Option<CatalogData>,
    migrations_recovered: bool,
}

impl ProjectCatalog {
    pub fn new(user_data_directory: &Path) -> Self {
        Self {
            store: LocalJsonStore::new(user_data_directory),
            migration: ProjectMigrationService::new(user_data_directory),
            data: None,
            migrations_recovered: false,
        }
    }

    pub fn get_catalog(&mut self) -> CatalogResult<CatalogData> {
        Ok(self.ensure_loaded()?.clone())
    }

    pub fn open_project_in_ide(&mut self, project_id: &str) -> CatalogResult<CatalogData> {
        let current = self.ensure_loaded()?.clone();
        let project = project_for_action(&current, project_id)?;
        ensure_project_directory(&project)?;

        let launch_result = if current.settings.ide.kind == "custom" {
            Command::new(&current.settings.ide.custom_executable_path)
                .arg(&project.path)
                .spawn()
                .map(|_| ())
        } else {
            let path = project.path.replace('\\', "/");
            open_external(&format!("vscode://file/{}", percent_encode(&path)))
        };
        launch_result.map_err(|_| {
            CatalogOperationError::new("INTERNAL_ERROR", "无法启动 IDE，请检查设置中的 IDE 配置。")
        })?;

        let mut next = current;
        if let Some(opened) = next.projects.iter_mut().find(|item| item.id == project_id) {
            opened.last_opened_at = Some(now());
        }
        self.save(next)
    }

    pub fn open_project_folder(&mut self, project_id: &str) -> CatalogResult<CatalogData> {
        let current = self.ensure_loaded()?.clone();
        let project = project_for_action(&current, project_id)?;
        ensure_project_directory(&project)?;
        open_path(Path::new(&project.path))
            .map_err(|_| CatalogOperationError::new("INTERNAL_ERROR", "无法打开项目文件夹。"))?;
        Ok(current)
    }

    pub fn open_project_repository(&mut self, project_id: &str) -> CatalogResult<CatalogData> {
        let current = self.ensure_loaded()?.clone();
        let project = project_for_action(&current, project_id)?;
        let url = repository_browser_url(&project.git_url).ok_or_else(|| {
            CatalogOperationError::new("INVALID_INPUT", "Git 地址无法在浏览器中打开。")
                .field("gitUrl")
        })?;
        open_external(&url)
            .map_err(|_| CatalogOperationError::new("INTERNAL_ERROR", "无法打开 Git 仓库地址。"))?;
        Ok(current)
    }

    pub fn create_category(&mut self, input: CreateCategoryInput) -> CatalogResult<CatalogData> {
        let name = validate_text(&input.name, "categoryName", 30, true)?;
        let current = self.ensure_loaded()?.clone();
        if current
            .categories
            .iter()
            .any(|category| text_key(&category.name) == text_key(&name))
        {
            return Ok(current);
        }
        let mut next = current;
        next.categories.push(Category {
            id: new_id(),
            name,
            created_at: now(),
        });
        self.save(next)
    }

    pub fn update_settings(&mut self, mut input: AppSettings) -> CatalogResult<CatalogData> {
        if input.ide.kind != "vscode" && input.ide.kind != "custom" {
            return Err(CatalogOperationError::new(
                "INVALID_INPUT",
                "请选择有效的 IDE。",
            ));
        }
        let default_project_directory = if input.default_project_directory.trim().is_empty() {
            String::new()
        } else {
            let path = validate_path(input.default_project_directory.trim())?;
            path_string(&canonical_directory(&path, "默认项目位置已不存在。")?)
        };
        let custom_executable_path = input.ide.custom_executable_path.trim().to_string();
        if input.ide.kind == "custom" {
            let path = Path::new(&custom_executable_path);
            if custom_executable_path.is_empty()
                || custom_executable_path.len() > 4096
                || custom_executable_path.contains('\0')
                || !path.is_absolute()
            {
                return Err(
                    CatalogOperationError::new("INVALID_INPUT", "请选择自定义 IDE 程序。")
                        .field("path"),
                );
            }
        }
        if input.project_actions.is_empty() || input.project_actions.len() > 8 {
            return Err(CatalogOperationError::new(
                "INVALID_INPUT",
                "请配置 1 至 8 个项目功能按钮。",
            ));
        }
        let mut action_ids = std::collections::HashSet::new();
        for action in &mut input.project_actions {
            if action.id.is_empty()
                || action.id.len() > 64
                || !action
                    .id
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || "-_".contains(character))
                || !action_ids.insert(action.id.clone())
            {
                return Err(CatalogOperationError::new(
                    "INVALID_INPUT",
                    "功能按钮标识无效或重复。",
                ));
            }
            action.label = validate_text(&action.label, "projectActions", 20, true)?;
            if !matches!(
                action.kind.as_str(),
                "vscode" | "folder" | "repository" | "custom"
            ) {
                return Err(CatalogOperationError::new(
                    "INVALID_INPUT",
                    "请选择有效的功能按钮类型。",
                ));
            }
            action.custom_executable_path = action.custom_executable_path.trim().to_string();
            if action.kind == "custom" {
                let executable = Path::new(&action.custom_executable_path);
                if action.custom_executable_path.is_empty()
                    || action.custom_executable_path.len() > 4096
                    || action.custom_executable_path.contains('\0')
                    || !executable.is_absolute()
                {
                    return Err(CatalogOperationError::new(
                        "INVALID_INPUT",
                        format!("请为“{}”选择可执行程序。", action.label),
                    ));
                }
            } else {
                action.custom_executable_path.clear();
            }
        }
        let mut next = self.ensure_loaded()?.clone();
        next.settings = AppSettings {
            default_project_directory,
            ide: crate::models::IdeSettings {
                kind: input.ide.kind,
                custom_executable_path,
            },
            project_actions: input.project_actions,
        };
        self.save(next)
    }

    pub fn run_project_action(
        &mut self,
        project_id: &str,
        action_id: &str,
    ) -> CatalogResult<CatalogData> {
        let current = self.ensure_loaded()?.clone();
        let project = project_for_action(&current, project_id)?;
        let action = current
            .settings
            .project_actions
            .iter()
            .find(|action| action.id == action_id)
            .cloned()
            .ok_or_else(|| CatalogOperationError::new("INVALID_INPUT", "功能按钮不存在。"))?;

        let marks_opened = matches!(action.kind.as_str(), "vscode" | "custom");
        match action.kind.as_str() {
            "folder" => {
                ensure_project_directory(&project)?;
                open_path(Path::new(&project.path)).map_err(|_| {
                    CatalogOperationError::new("INTERNAL_ERROR", "无法打开项目文件夹。")
                })?;
            }
            "repository" => {
                let url = repository_browser_url(&project.git_url).ok_or_else(|| {
                    CatalogOperationError::new("INVALID_INPUT", "请先为项目配置 Git 地址。")
                        .field("gitUrl")
                })?;
                open_external(&url).map_err(|_| {
                    CatalogOperationError::new("INTERNAL_ERROR", "无法打开 Git 仓库地址。")
                })?;
            }
            "vscode" => {
                ensure_project_directory(&project)?;
                let path = project.path.replace('\\', "/");
                open_external(&format!("vscode://file/{}", percent_encode(&path))).map_err(
                    |_| CatalogOperationError::new("INTERNAL_ERROR", "无法启动 VS Code。"),
                )?;
            }
            "custom" => {
                ensure_project_directory(&project)?;
                Command::new(&action.custom_executable_path)
                    .arg(&project.path)
                    .spawn()
                    .map_err(|_| {
                        CatalogOperationError::new(
                            "INTERNAL_ERROR",
                            format!("无法启动“{}”。", action.label),
                        )
                    })?;
            }
            _ => {
                return Err(CatalogOperationError::new(
                    "INVALID_INPUT",
                    "功能按钮类型无效。",
                ))
            }
        }

        if !marks_opened {
            return Ok(current);
        }
        let mut next = current;
        if let Some(opened) = next.projects.iter_mut().find(|item| item.id == project_id) {
            opened.last_opened_at = Some(now());
        }
        self.save(next)
    }

    pub fn update_project(&mut self, input: UpdateProjectInput) -> CatalogResult<CatalogData> {
        let name = validate_text(&input.name, "name", 80, true)?;
        let description = validate_text(&input.description, "description", 200, false)?;
        let git_url = validate_text(&input.git_url, "gitUrl", 2048, false)?;
        let category_name = validate_text(&input.category_name, "categoryName", 30, true)?;
        let mut next = self.ensure_loaded()?.clone();
        if !next
            .projects
            .iter()
            .any(|project| project.id == input.project_id)
        {
            return Err(CatalogOperationError::new(
                "INVALID_INPUT",
                "项目记录不存在。",
            ));
        }
        let category_id = ensure_category(&mut next, &category_name);
        let project = next
            .projects
            .iter_mut()
            .find(|project| project.id == input.project_id)
            .expect("project checked above");
        project.name = name;
        project.description = description;
        project.git_url = git_url;
        project.category_id = category_id;
        project.updated_at = now();
        self.save(next)
    }

    pub fn delete_project(&mut self, project_id: &str) -> CatalogResult<CatalogData> {
        let mut next = self.ensure_loaded()?.clone();
        let original_length = next.projects.len();
        next.projects.retain(|project| project.id != project_id);
        if next.projects.len() == original_length {
            return Err(CatalogOperationError::new(
                "INVALID_INPUT",
                "项目记录不存在。",
            ));
        }
        self.save(next)
    }

    pub fn create_empty_project(
        &mut self,
        input: CreateEmptyProjectInput,
    ) -> CatalogResult<CatalogData> {
        let name = validate_text(&input.name, "name", 80, true)?;
        validate_directory_name(&name)?;
        let description = validate_text(&input.description, "description", 200, false)?;
        let git_url = validate_text(&input.git_url, "gitUrl", 2048, false)?;
        let category_name = validate_text(&input.category_name, "categoryName", 30, true)?;
        let current = self.ensure_loaded()?.clone();
        let default_directory = self.require_default_directory(&current)?;
        let target = default_directory.join(&name);
        if target.parent() != Some(default_directory.as_path()) {
            return Err(
                CatalogOperationError::new("INVALID_INPUT", "项目目录超出默认存储位置。")
                    .field("name"),
            );
        }
        match fs::create_dir(&target) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(CatalogOperationError::new(
                    "TARGET_ALREADY_EXISTS",
                    format!("目标目录已存在，请更换项目名称：{}", target.display()),
                )
                .field("name")
                .target(path_string(&target)));
            }
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
                ) =>
            {
                return Err(CatalogOperationError::new(
                    "DIRECTORY_NOT_FOUND",
                    "默认项目位置已不存在，请重新设置。",
                )
                .field("path"));
            }
            Err(_) => {
                return Err(CatalogOperationError::new(
                    "DIRECTORY_CREATE_FAILED",
                    format!("无法创建项目目录：{}", target.display()),
                )
                .field("path")
                .target(path_string(&target)))
            }
        }

        if let Some(duplicate) = current
            .projects
            .iter()
            .find(|project| same_path(Path::new(&project.path), &target))
        {
            let _ = fs::remove_dir(&target);
            return Err(CatalogOperationError::new(
                "DUPLICATE_PATH",
                format!("“{}”已经使用该目录。", duplicate.name),
            )
            .field("path")
            .existing_project(&duplicate.id)
            .target(path_string(&target)));
        }

        let mut next = current;
        let category_id = ensure_category(&mut next, &category_name);
        let timestamp = now();
        next.projects.push(Project {
            id: new_id(),
            name,
            description,
            git_url,
            category_id,
            path: path_string(&target),
            source: "created".into(),
            created_at: timestamp.clone(),
            updated_at: timestamp,
            last_opened_at: None,
        });
        if let Err(error) = self.store.save(&next) {
            if fs::remove_dir(&target).is_err() {
                return Err(CatalogOperationError::new(
                    "DIRECTORY_ROLLBACK_FAILED",
                    format!(
                        "项目数据保存失败，目录未被删除，请检查：{}",
                        target.display()
                    ),
                )
                .field("path")
                .target(path_string(&target)));
            }
            return Err(error);
        }
        self.data = Some(next.clone());
        Ok(next)
    }

    pub fn preview_import_migration(&mut self, path: &str) -> CatalogResult<MigrationPlan> {
        let selected = validate_path(path)?;
        let canonical = canonical_directory(&selected, "所选目录已不存在，请重新选择。")?;
        let current = self.ensure_loaded()?.clone();
        let default_directory = self.require_default_directory(&current)?;
        let item = self.migration.plan(
            "__import-preview__",
            &path_string(&canonical),
            &canonical,
            &default_directory,
        )?;
        Ok(MigrationPlan {
            items: vec![item],
            cleanup_pending: self.migration.get_cleanup_pending()?,
        })
    }

    pub fn import_existing_project(
        &mut self,
        input: ImportExistingProjectInput,
    ) -> CatalogResult<CatalogData> {
        let name = validate_text(&input.name, "name", 80, true)?;
        let description = validate_text(&input.description, "description", 200, false)?;
        let git_url = validate_text(&input.git_url, "gitUrl", 2048, false)?;
        let category_name = validate_text(&input.category_name, "categoryName", 30, true)?;
        let selected = validate_path(&input.path)?;
        let canonical = canonical_directory(&selected, "所选目录已不存在，请重新选择。")?;
        let current = self.ensure_loaded()?.clone();
        if let Some(duplicate) = current
            .projects
            .iter()
            .find(|project| same_path(Path::new(&project.path), &canonical))
        {
            return Err(CatalogOperationError::new(
                "DUPLICATE_PATH",
                format!("“{}”已经使用该目录。", duplicate.name),
            )
            .field("path")
            .existing_project(&duplicate.id));
        }

        let project_id = new_id();
        let default_directory = self.require_default_directory(&current)?;
        let plan = self
            .migration
            .plan(&project_id, &name, &canonical, &default_directory)?;
        if !input.migration_confirmed
            || !same_path(
                Path::new(&input.expected_target_path),
                Path::new(&plan.target_path),
            )
        {
            return Err(CatalogOperationError::new(
                "MIGRATION_PLAN_CHANGED",
                "项目迁移目标已变化，请重新确认。",
            )
            .field("path"));
        }
        if plan.status == "conflict" || plan.status == "invalid" {
            return Err(CatalogOperationError::new(
                "MIGRATION_CONFLICT",
                plan.message
                    .clone()
                    .unwrap_or_else(|| "项目当前无法迁移。".into()),
            )
            .field("path"));
        }
        let prepared = if plan.status == "ready" {
            Some(self.migration.prepare_migration(&plan)?)
        } else {
            None
        };
        let final_path = prepared
            .as_ref()
            .map(|prepared| prepared.target_path.clone())
            .unwrap_or_else(|| path_string(&canonical));

        let mut next = current;
        let category_id = ensure_category(&mut next, &category_name);
        let timestamp = now();
        next.projects.push(Project {
            id: project_id,
            name,
            description,
            git_url,
            category_id,
            path: final_path,
            source: "existing".into(),
            created_at: timestamp.clone(),
            updated_at: timestamp,
            last_opened_at: None,
        });
        if let Err(error) = self.store.save(&next) {
            if let Some(prepared) = &prepared {
                self.migration.rollback_migration(&prepared.operation_id)?;
            }
            return Err(error);
        }
        self.data = Some(next.clone());
        if let Some(prepared) = prepared {
            self.migration.commit_migration(&prepared.operation_id)?;
        }
        Ok(next)
    }

    pub fn get_migration_plan(&mut self) -> CatalogResult<MigrationPlan> {
        let current = self.ensure_loaded()?.clone();
        if current.settings.default_project_directory.is_empty() {
            return Ok(MigrationPlan {
                items: vec![],
                cleanup_pending: self.migration.get_cleanup_pending()?,
            });
        }
        let default_directory = self.require_default_directory(&current)?;
        let items = current
            .projects
            .iter()
            .map(|project| self.migration.plan_migration(project, &default_directory))
            .collect::<CatalogResult<Vec<_>>>()?;
        Ok(MigrationPlan {
            items,
            cleanup_pending: self.migration.get_cleanup_pending()?,
        })
    }

    pub fn migrate_projects(
        &mut self,
        input: ExecuteMigrationsInput,
    ) -> CatalogResult<MigrationBatch> {
        if input.items.len() > 1000 {
            return Err(CatalogOperationError::new(
                "INVALID_INPUT",
                "迁移计划格式无效。",
            ));
        }
        let current = self.ensure_loaded()?.clone();
        let default_directory = self.require_default_directory(&current)?;
        let mut seen = std::collections::HashSet::new();
        let mut results = vec![];
        for confirmed in input.items {
            if confirmed.project_id.is_empty()
                || !seen.insert(confirmed.project_id.clone())
                || confirmed.source_path.len() > 4096
                || confirmed.target_path.len() > 4096
                || confirmed.source_path.contains('\0')
                || confirmed.target_path.contains('\0')
            {
                return Err(CatalogOperationError::new(
                    "INVALID_INPUT",
                    "迁移确认格式无效。",
                ));
            }
            let active = self.ensure_loaded()?.clone();
            let Some(project) = active
                .projects
                .iter()
                .find(|project| project.id == confirmed.project_id)
                .cloned()
            else {
                results.push(failed(&confirmed.project_id, "项目记录不存在。"));
                continue;
            };
            let project_id_for_error = project.id.clone();
            let operation = (|| -> CatalogResult<MigrationItemResult> {
                let plan = self
                    .migration
                    .plan_migration(&project, &default_directory)?;
                if !same_path(
                    Path::new(&plan.source_path),
                    Path::new(&confirmed.source_path),
                ) || !same_path(
                    Path::new(&plan.target_path),
                    Path::new(&confirmed.target_path),
                ) {
                    return Err(CatalogOperationError::new(
                        "MIGRATION_PLAN_CHANGED",
                        "迁移路径已变化，请重新确认。",
                    ));
                }
                if plan.status == "already-managed" {
                    return Ok(MigrationItemResult {
                        project_id: project.id,
                        status: "skipped".into(),
                        message: "项目已在默认存储位置。".into(),
                        target_path: None,
                        operation_id: None,
                    });
                }
                if plan.status != "ready" {
                    return Err(CatalogOperationError::new(
                        "MIGRATION_CONFLICT",
                        plan.message.unwrap_or_else(|| "项目当前无法迁移。".into()),
                    ));
                }
                let prepared = self.migration.prepare_migration(&plan)?;
                let mut next = active;
                let next_project = next
                    .projects
                    .iter_mut()
                    .find(|candidate| candidate.id == project.id)
                    .expect("project must exist");
                next_project.path = prepared.target_path.clone();
                next_project.updated_at = now();
                if let Err(error) = self.store.save(&next) {
                    self.migration.rollback_migration(&prepared.operation_id)?;
                    return Err(error);
                }
                self.data = Some(next);
                let status = self.migration.commit_migration(&prepared.operation_id)?;
                Ok(MigrationItemResult {
                    project_id: project.id,
                    message: if status == "completed" {
                        "迁移完成。".into()
                    } else {
                        "新路径已生效，原目录仍待移入回收站。".into()
                    },
                    target_path: Some(prepared.target_path),
                    operation_id: if status == "cleanup-pending" {
                        Some(prepared.operation_id)
                    } else {
                        None
                    },
                    status,
                })
            })();
            results.push(match operation {
                Ok(result) => result,
                Err(error) => failed(&project_id_for_error, &error.to_string()),
            });
        }
        Ok(MigrationBatch {
            snapshot: self.ensure_loaded()?.clone(),
            items: results,
        })
    }

    pub fn retry_migration_cleanup(&mut self, operation_id: &str) -> CatalogResult<MigrationPlan> {
        if operation_id.is_empty() || operation_id.len() > 200 {
            return Err(CatalogOperationError::new(
                "INVALID_INPUT",
                "迁移操作 ID 无效。",
            ));
        }
        self.migration.retry_cleanup(operation_id)?;
        self.get_migration_plan()
    }

    fn ensure_loaded(&mut self) -> CatalogResult<&CatalogData> {
        if self.data.is_none() {
            let mut loaded = self.store.load()?;
            if loaded.settings.project_actions.is_empty() {
                loaded.settings.project_actions = crate::models::default_project_actions();
                if loaded.settings.ide.kind == "custom"
                    && !loaded.settings.ide.custom_executable_path.is_empty()
                {
                    loaded.settings.project_actions[0].label = "默认 IDE".into();
                    loaded.settings.project_actions[0].kind = "custom".into();
                    loaded.settings.project_actions[0].custom_executable_path =
                        loaded.settings.ide.custom_executable_path.clone();
                }
            }
            self.data = Some(loaded);
        }
        if !self.migrations_recovered {
            let paths = self
                .data
                .as_ref()
                .expect("catalog loaded")
                .projects
                .iter()
                .map(|project| (project.id.clone(), project.path.clone()))
                .collect::<HashMap<_, _>>();
            self.migration.recover_pending_migrations(&paths)?;
            self.migrations_recovered = true;
        }
        Ok(self.data.as_ref().expect("catalog loaded"))
    }

    fn require_default_directory(&self, current: &CatalogData) -> CatalogResult<PathBuf> {
        if current.settings.default_project_directory.is_empty() {
            return Err(CatalogOperationError::new(
                "DEFAULT_DIRECTORY_REQUIRED",
                "请先在设置中选择默认项目位置。",
            )
            .field("path"));
        }
        canonical_directory(
            Path::new(&current.settings.default_project_directory),
            "默认项目位置已不存在，请重新设置。",
        )
    }

    fn save(&mut self, next: CatalogData) -> CatalogResult<CatalogData> {
        self.store.save(&next)?;
        self.data = Some(next.clone());
        Ok(next)
    }
}

fn validate_text(
    value: &str,
    field: &str,
    max_length: usize,
    required: bool,
) -> CatalogResult<String> {
    let value = value.trim();
    if (required && value.is_empty()) || value.chars().count() > max_length {
        return Err(CatalogOperationError::new("INVALID_INPUT", "请输入有效内容。").field(field));
    }
    Ok(value.into())
}

fn validate_path(value: &str) -> CatalogResult<PathBuf> {
    if value.is_empty()
        || value.len() > 4096
        || value.contains('\0')
        || !Path::new(value).is_absolute()
    {
        return Err(
            CatalogOperationError::new("INVALID_INPUT", "请选择有效的绝对目录路径。").field("path"),
        );
    }
    Ok(PathBuf::from(value))
}

fn project_for_action(data: &CatalogData, project_id: &str) -> CatalogResult<Project> {
    data.projects
        .iter()
        .find(|project| project.id == project_id)
        .cloned()
        .ok_or_else(|| CatalogOperationError::new("INVALID_INPUT", "项目记录不存在。"))
}

fn ensure_project_directory(project: &Project) -> CatalogResult<()> {
    if Path::new(&project.path).is_dir() {
        Ok(())
    } else {
        Err(CatalogOperationError::new("DIRECTORY_NOT_FOUND", "项目目录已不存在。").field("path"))
    }
}

fn repository_browser_url(value: &str) -> Option<String> {
    let value = value.trim();
    if value.starts_with("https://") || value.starts_with("http://") {
        return (!value.contains(['\0', '\r', '\n'])).then(|| value.to_string());
    }

    if let Some(remote) = value.strip_prefix("git@") {
        let (host, path) = remote.split_once(':')?;
        if !host.is_empty() && !path.is_empty() {
            return Some(format!(
                "https://{}/{}",
                host,
                path.trim_end_matches(".git")
            ));
        }
    }

    if let Some(remote) = value.strip_prefix("ssh://") {
        let remote = remote.rsplit_once('@').map_or(remote, |(_, rest)| rest);
        let (host, path) = remote.split_once('/')?;
        if !host.is_empty() && !path.is_empty() {
            return Some(format!(
                "https://{}/{}",
                host,
                path.trim_end_matches(".git")
            ));
        }
    }
    None
}

fn percent_encode(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b':' | b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

#[cfg(target_os = "windows")]
fn open_path(path: &Path) -> std::io::Result<()> {
    Command::new("explorer.exe").arg(path).spawn().map(|_| ())
}

#[cfg(target_os = "macos")]
fn open_path(path: &Path) -> std::io::Result<()> {
    Command::new("open").arg(path).spawn().map(|_| ())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_path(path: &Path) -> std::io::Result<()> {
    Command::new("xdg-open").arg(path).spawn().map(|_| ())
}

#[cfg(target_os = "windows")]
fn open_external(target: &str) -> std::io::Result<()> {
    Command::new("explorer.exe").arg(target).spawn().map(|_| ())
}

#[cfg(target_os = "macos")]
fn open_external(target: &str) -> std::io::Result<()> {
    Command::new("open").arg(target).spawn().map(|_| ())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_external(target: &str) -> std::io::Result<()> {
    Command::new("xdg-open").arg(target).spawn().map(|_| ())
}

fn canonical_directory(path: &Path, missing_message: &str) -> CatalogResult<PathBuf> {
    let canonical = dunce::canonicalize(path).map_err(|_| {
        CatalogOperationError::new("DIRECTORY_NOT_FOUND", missing_message).field("path")
    })?;
    if !canonical.is_dir() {
        return Err(
            CatalogOperationError::new("NOT_A_DIRECTORY", "所选路径不是目录。").field("path"),
        );
    }
    Ok(canonical)
}

fn validate_directory_name(name: &str) -> CatalogResult<()> {
    let lower = name.to_lowercase();
    let stem = lower.split('.').next().unwrap_or("");
    let reserved = matches!(stem, "con" | "prn" | "aux" | "nul")
        || (stem.len() == 4
            && (stem.starts_with("com") || stem.starts_with("lpt"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    let invalid = name.is_empty()
        || name.chars().count() > 80
        || name == "."
        || name == ".."
        || name.ends_with('.')
        || name.ends_with(' ')
        || reserved
        || name
            .chars()
            .any(|character| character <= '\u{1f}' || "<>:\"/\\|?*".contains(character));
    if invalid {
        return Err(CatalogOperationError::new(
            "INVALID_INPUT",
            "项目名称不能用作安全的跨平台目录名。",
        )
        .field("name"));
    }
    Ok(())
}

fn ensure_category(data: &mut CatalogData, name: &str) -> String {
    if let Some(category) = data
        .categories
        .iter()
        .find(|category| text_key(&category.name) == text_key(name))
    {
        return category.id.clone();
    }
    let category = Category {
        id: new_id(),
        name: name.into(),
        created_at: now(),
    };
    let id = category.id.clone();
    data.categories.push(category);
    id
}

fn failed(project_id: &str, message: &str) -> MigrationItemResult {
    MigrationItemResult {
        project_id: project_id.into(),
        status: "failed".into(),
        message: message.into(),
        target_path: None,
        operation_id: None,
    }
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
fn new_id() -> String {
    Uuid::new_v4().to_string()
}
fn text_key(value: &str) -> String {
    value.trim().to_lowercase()
}
fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_directory() -> PathBuf {
        let path = std::env::temp_dir().join(format!("project-catalog-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create test directory");
        path
    }

    #[test]
    fn rejects_unsafe_cross_platform_directory_names() {
        for name in ["", ".", "..", "CON", "COM1.txt", "bad/name", "trailing."] {
            assert!(
                validate_directory_name(name).is_err(),
                "{name} should be rejected"
            );
        }
        assert!(validate_directory_name("dashboard-app").is_ok());
    }

    #[test]
    fn text_validation_trims_and_enforces_required_fields() {
        assert_eq!(validate_text("  工具  ", "name", 80, true).unwrap(), "工具");
        assert!(validate_text("   ", "name", 80, true).is_err());
        assert!(validate_text("description", "description", 200, false).is_ok());
    }

    #[test]
    fn converts_common_git_remotes_to_browser_urls() {
        assert_eq!(
            repository_browser_url("git@github.com:team/project.git").as_deref(),
            Some("https://github.com/team/project")
        );
        assert_eq!(
            repository_browser_url("ssh://git@gitlab.com/team/project.git").as_deref(),
            Some("https://gitlab.com/team/project")
        );
        assert_eq!(
            repository_browser_url("https://example.com/team/project").as_deref(),
            Some("https://example.com/team/project")
        );
        assert!(repository_browser_url("file:///tmp/project").is_none());
    }

    #[test]
    fn encodes_ide_uri_paths() {
        assert_eq!(
            percent_encode("C:/工作目录/my project"),
            "C:/%E5%B7%A5%E4%BD%9C%E7%9B%AE%E5%BD%95/my%20project"
        );
    }

    #[test]
    fn updates_metadata_and_deletes_only_the_catalog_record() {
        let root = test_directory();
        let project_path = root.join("source-project");
        fs::create_dir(&project_path).expect("create project directory");
        let mut catalog = ProjectCatalog::new(&root);
        let mut snapshot = CatalogData::default();
        snapshot.categories.push(Category {
            id: "tools".into(),
            name: "工具".into(),
            created_at: now(),
        });
        snapshot.projects.push(Project {
            id: "project-1".into(),
            name: "Before".into(),
            description: String::new(),
            git_url: String::new(),
            category_id: "tools".into(),
            path: path_string(&project_path),
            source: "existing".into(),
            created_at: now(),
            updated_at: now(),
            last_opened_at: None,
        });
        catalog.save(snapshot).expect("seed catalog");

        let updated = catalog
            .update_project(UpdateProjectInput {
                project_id: "project-1".into(),
                name: "After".into(),
                description: "Updated".into(),
                git_url: "https://example.com/team/project".into(),
                category_name: "工具".into(),
            })
            .expect("update project");
        assert_eq!(updated.projects[0].name, "After");
        assert_eq!(updated.projects[0].path, path_string(&project_path));

        let deleted = catalog.delete_project("project-1").expect("delete project");
        assert!(deleted.projects.is_empty());
        assert!(project_path.is_dir(), "local project must not be deleted");
        fs::remove_dir_all(root).expect("remove test directory");
    }

    #[test]
    fn migrates_a_legacy_custom_ide_to_the_default_action_array() {
        let root = test_directory();
        fs::write(
            root.join("project-manager.json"),
            r#"{
              "schemaVersion": 1,
              "projects": [],
              "categories": [],
              "settings": {
                "defaultProjectDirectory": "",
                "ide": { "type": "custom", "customExecutablePath": "C:\\Tools\\IDE.exe" }
              }
            }"#,
        )
        .expect("write legacy catalog");
        let mut catalog = ProjectCatalog::new(&root);
        let snapshot = catalog.get_catalog().expect("load legacy catalog");
        assert_eq!(snapshot.settings.project_actions[0].kind, "custom");
        assert_eq!(
            snapshot.settings.project_actions[0].custom_executable_path,
            "C:\\Tools\\IDE.exe"
        );
        fs::remove_dir_all(root).expect("remove test directory");
    }
}
