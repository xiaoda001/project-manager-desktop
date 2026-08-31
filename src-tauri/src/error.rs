use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub existing_project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_path: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CatalogOperationError(pub CatalogError);

impl CatalogOperationError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self(CatalogError {
            code: code.into(),
            message: message.into(),
            field: None,
            existing_project_id: None,
            target_path: None,
        })
    }

    pub fn field(mut self, field: &str) -> Self {
        self.0.field = Some(field.into());
        self
    }

    pub fn existing_project(mut self, id: impl Into<String>) -> Self {
        self.0.existing_project_id = Some(id.into());
        self
    }

    pub fn target(mut self, path: impl Into<String>) -> Self {
        self.0.target_path = Some(path.into());
        self
    }
}

impl std::fmt::Display for CatalogOperationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0.message)
    }
}

impl std::error::Error for CatalogOperationError {}

pub type CatalogResult<T> = Result<T, CatalogOperationError>;
