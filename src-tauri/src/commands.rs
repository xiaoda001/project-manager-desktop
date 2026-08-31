use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use tauri::State;
use tokio::sync::Mutex;

use crate::{
    catalog::ProjectCatalog,
    error::{CatalogOperationError, CatalogResult},
    models::{
        ApiResult, AppSettings, CatalogData, CreateCategoryInput, CreateEmptyProjectInput,
        ExecuteMigrationsInput, ImportExistingProjectInput, MigrationBatch, MigrationPlan,
        UpdateProjectInput,
    },
};

pub struct AppState {
    pub catalog: Mutex<ProjectCatalog>,
}

fn parse<T: DeserializeOwned>(value: Value, message: &str) -> CatalogResult<T> {
    serde_json::from_value(value).map_err(|_| CatalogOperationError::new("INVALID_INPUT", message))
}

async fn with_catalog<T: Serialize>(
    state: State<'_, AppState>,
    operation: impl FnOnce(&mut ProjectCatalog) -> CatalogResult<T>,
) -> Result<ApiResult<T>, ()> {
    let mut catalog = state.catalog.lock().await;
    Ok(ApiResult::from_result(operation(&mut catalog)))
}

#[tauri::command]
pub async fn get_catalog(state: State<'_, AppState>) -> Result<ApiResult<CatalogData>, ()> {
    with_catalog(state, ProjectCatalog::get_catalog).await
}

#[tauri::command]
pub async fn open_project_in_ide(
    state: State<'_, AppState>,
    project_id: Value,
) -> Result<ApiResult<CatalogData>, ()> {
    let project_id = parse::<String>(project_id, "项目 ID 无效。");
    match project_id {
        Ok(project_id) => {
            with_catalog(state, |catalog| catalog.open_project_in_ide(&project_id)).await
        }
        Err(error) => Ok(ApiResult::from_result(Err(error))),
    }
}

#[tauri::command]
pub async fn open_project_folder(
    state: State<'_, AppState>,
    project_id: Value,
) -> Result<ApiResult<CatalogData>, ()> {
    let project_id = parse::<String>(project_id, "项目 ID 无效。");
    match project_id {
        Ok(project_id) => {
            with_catalog(state, |catalog| catalog.open_project_folder(&project_id)).await
        }
        Err(error) => Ok(ApiResult::from_result(Err(error))),
    }
}

#[tauri::command]
pub async fn open_project_repository(
    state: State<'_, AppState>,
    project_id: Value,
) -> Result<ApiResult<CatalogData>, ()> {
    let project_id = parse::<String>(project_id, "项目 ID 无效。");
    match project_id {
        Ok(project_id) => {
            with_catalog(state, |catalog| {
                catalog.open_project_repository(&project_id)
            })
            .await
        }
        Err(error) => Ok(ApiResult::from_result(Err(error))),
    }
}

#[tauri::command]
pub async fn run_project_action(
    state: State<'_, AppState>,
    project_id: Value,
    action_id: Value,
) -> Result<ApiResult<CatalogData>, ()> {
    let project_id = parse::<String>(project_id, "项目 ID 无效。");
    let action_id = parse::<String>(action_id, "功能按钮 ID 无效。");
    match (project_id, action_id) {
        (Ok(project_id), Ok(action_id)) => {
            with_catalog(state, |catalog| {
                catalog.run_project_action(&project_id, &action_id)
            })
            .await
        }
        (Err(error), _) | (_, Err(error)) => Ok(ApiResult::from_result(Err(error))),
    }
}

#[tauri::command]
pub async fn update_project(
    state: State<'_, AppState>,
    input: Value,
) -> Result<ApiResult<CatalogData>, ()> {
    let input = parse::<UpdateProjectInput>(input, "项目修改表单格式无效。");
    match input {
        Ok(input) => with_catalog(state, |catalog| catalog.update_project(input)).await,
        Err(error) => Ok(ApiResult::from_result(Err(error))),
    }
}

#[tauri::command]
pub async fn delete_project(
    state: State<'_, AppState>,
    project_id: Value,
) -> Result<ApiResult<CatalogData>, ()> {
    let project_id = parse::<String>(project_id, "项目 ID 无效。");
    match project_id {
        Ok(project_id) => with_catalog(state, |catalog| catalog.delete_project(&project_id)).await,
        Err(error) => Ok(ApiResult::from_result(Err(error))),
    }
}

#[tauri::command]
pub async fn create_category(
    state: State<'_, AppState>,
    input: Value,
) -> Result<ApiResult<CatalogData>, ()> {
    let input = parse::<CreateCategoryInput>(input, "分类格式无效。");
    match input {
        Ok(input) => with_catalog(state, |catalog| catalog.create_category(input)).await,
        Err(error) => Ok(ApiResult::from_result(Err(error))),
    }
}

#[tauri::command]
pub async fn update_settings(
    state: State<'_, AppState>,
    input: Value,
) -> Result<ApiResult<CatalogData>, ()> {
    let input = parse::<AppSettings>(input, "设置格式无效。");
    match input {
        Ok(input) => with_catalog(state, |catalog| catalog.update_settings(input)).await,
        Err(error) => Ok(ApiResult::from_result(Err(error))),
    }
}

#[tauri::command]
pub async fn create_empty_project(
    state: State<'_, AppState>,
    input: Value,
) -> Result<ApiResult<CatalogData>, ()> {
    let input = parse::<CreateEmptyProjectInput>(input, "创建项目表单格式无效。");
    match input {
        Ok(input) => with_catalog(state, |catalog| catalog.create_empty_project(input)).await,
        Err(error) => Ok(ApiResult::from_result(Err(error))),
    }
}

#[tauri::command]
pub async fn preview_import_migration(
    state: State<'_, AppState>,
    path: Value,
) -> Result<ApiResult<MigrationPlan>, ()> {
    let path = parse::<String>(path, "项目路径格式无效。");
    match path {
        Ok(path) => with_catalog(state, |catalog| catalog.preview_import_migration(&path)).await,
        Err(error) => Ok(ApiResult::from_result(Err(error))),
    }
}

#[tauri::command]
pub async fn import_existing_project(
    state: State<'_, AppState>,
    input: Value,
) -> Result<ApiResult<CatalogData>, ()> {
    let input = parse::<ImportExistingProjectInput>(input, "项目表单格式无效。");
    match input {
        Ok(input) => with_catalog(state, |catalog| catalog.import_existing_project(input)).await,
        Err(error) => Ok(ApiResult::from_result(Err(error))),
    }
}

#[tauri::command]
pub async fn get_migration_plan(
    state: State<'_, AppState>,
) -> Result<ApiResult<MigrationPlan>, ()> {
    with_catalog(state, ProjectCatalog::get_migration_plan).await
}

#[tauri::command]
pub async fn execute_migrations(
    state: State<'_, AppState>,
    input: Value,
) -> Result<ApiResult<MigrationBatch>, ()> {
    let input = parse::<ExecuteMigrationsInput>(input, "迁移确认格式无效。");
    match input {
        Ok(input) => with_catalog(state, |catalog| catalog.migrate_projects(input)).await,
        Err(error) => Ok(ApiResult::from_result(Err(error))),
    }
}

#[tauri::command]
pub async fn retry_migration_cleanup(
    state: State<'_, AppState>,
    operation_id: Value,
) -> Result<ApiResult<MigrationPlan>, ()> {
    let operation_id = parse::<String>(operation_id, "迁移操作 ID 无效。");
    match operation_id {
        Ok(operation_id) => {
            with_catalog(state, |catalog| {
                catalog.retry_migration_cleanup(&operation_id)
            })
            .await
        }
        Err(error) => Ok(ApiResult::from_result(Err(error))),
    }
}
