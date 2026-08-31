use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeSettings {
    #[serde(rename = "type")]
    pub kind: String,
    pub custom_executable_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAction {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub custom_executable_path: String,
}

pub fn default_project_actions() -> Vec<ProjectAction> {
    vec![
        ProjectAction {
            id: "open-vscode".into(),
            label: "VS Code".into(),
            kind: "vscode".into(),
            custom_executable_path: String::new(),
        },
        ProjectAction {
            id: "open-folder".into(),
            label: "文件夹".into(),
            kind: "folder".into(),
            custom_executable_path: String::new(),
        },
        ProjectAction {
            id: "open-repository".into(),
            label: "Git 仓库".into(),
            kind: "repository".into(),
            custom_executable_path: String::new(),
        },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub default_project_directory: String,
    pub ide: IdeSettings,
    #[serde(default)]
    pub project_actions: Vec<ProjectAction>,
}

pub fn default_settings() -> AppSettings {
    AppSettings {
        default_project_directory: String::new(),
        ide: IdeSettings {
            kind: "vscode".into(),
            custom_executable_path: String::new(),
        },
        project_actions: default_project_actions(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub git_url: String,
    pub category_id: String,
    pub path: String,
    pub source: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogData {
    pub schema_version: u32,
    pub projects: Vec<Project>,
    pub categories: Vec<Category>,
    #[serde(default = "default_settings")]
    pub settings: AppSettings,
}

impl Default for CatalogData {
    fn default() -> Self {
        Self {
            schema_version: 1,
            projects: vec![],
            categories: vec![],
            settings: default_settings(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateCategoryInput {
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateEmptyProjectInput {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub git_url: String,
    pub category_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportExistingProjectInput {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub git_url: String,
    pub category_name: String,
    pub path: String,
    pub expected_target_path: String,
    pub migration_confirmed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateProjectInput {
    pub project_id: String,
    pub name: String,
    pub description: String,
    pub git_url: String,
    pub category_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMigrationPlanItem {
    pub project_id: String,
    pub project_name: String,
    pub source_path: String,
    pub target_path: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationCleanupItem {
    pub operation_id: String,
    pub project_id: String,
    pub source_path: String,
    pub target_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationPlan {
    pub items: Vec<ProjectMigrationPlanItem>,
    pub cleanup_pending: Vec<MigrationCleanupItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfirmedMigrationItem {
    pub project_id: String,
    pub source_path: String,
    pub target_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecuteMigrationsInput {
    pub items: Vec<ConfirmedMigrationItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationItemResult {
    pub project_id: String,
    pub status: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MigrationBatch {
    pub snapshot: CatalogData,
    pub items: Vec<MigrationItemResult>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum ApiResult<T: Serialize> {
    Success {
        ok: bool,
        data: T,
    },
    Failure {
        ok: bool,
        error: crate::error::CatalogError,
    },
}

impl<T: Serialize> ApiResult<T> {
    pub fn from_result(result: crate::error::CatalogResult<T>) -> Self {
        match result {
            Ok(data) => Self::Success { ok: true, data },
            Err(error) => Self::Failure {
                ok: false,
                error: error.0,
            },
        }
    }
}
