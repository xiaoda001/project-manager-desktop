import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppSettingsDto,
  CatalogError,
  CatalogSnapshotDto,
  CreateEmptyProjectInput,
  MigrationBatchDto,
  MigrationPlanDto,
  ImportExistingProjectInput,
  ProjectDto
} from '../../shared/contracts'
import { ClockIcon, CloseIcon, CodeIcon, FolderIcon, GridIcon, ListIcon, LogoMark, PlusIcon, SearchIcon, SettingsIcon } from './icons'
import {
  defaultProjectQuery,
  scopeTitle,
  visibleProjects,
  type ProjectQuery,
  type SortKey,
  type ViewMode
} from './search-navigation'

const emptySnapshot: CatalogSnapshotDto = {
  projects: [],
  categories: [],
  settings: { defaultProjectDirectory: '', ide: { type: 'vscode', customExecutablePath: '' } }
}

const directoryName = (path: string): string => {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(
    new Date(value)
  )

interface ImportDialogProps {
  categories: CatalogSnapshotDto['categories']
  settings: AppSettingsDto
  onClose(): void
  onOpenSettings(): void
  onCatalogUpdated(snapshot: CatalogSnapshotDto): void
  onSuccess(snapshot: CatalogSnapshotDto): void
}

const ImportDialog = ({ categories, settings, onClose, onOpenSettings, onCatalogUpdated, onSuccess }: ImportDialogProps) => {
  const [mode, setMode] = useState<'import' | 'create'>('import')
  const [form, setForm] = useState<ImportExistingProjectInput>({
    name: '',
    description: '',
    categoryName: '',
    path: '',
    expectedTargetPath: '',
    migrationConfirmed: false
  })
  const [error, setError] = useState<CatalogError | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [createForm, setCreateForm] = useState<CreateEmptyProjectInput>({
    name: '',
    description: '',
    categoryName: ''
  })
  const [createError, setCreateError] = useState<CatalogError | null>(null)
  const [creating, setCreating] = useState(false)
  const [addingCategory, setAddingCategory] = useState(false)
  const [categoryNotice, setCategoryNotice] = useState('')
  const importCategoryRef = useRef<HTMLInputElement>(null)
  const createCategoryRef = useRef<HTMLInputElement>(null)

  const addCategory = async (value: string) => {
    const name = value.trim()
    const setActiveError = mode === 'import' ? setError : setCreateError
    const input = mode === 'import' ? importCategoryRef.current : createCategoryRef.current
    setCategoryNotice('')
    if (!name) {
      setActiveError({ code: 'INVALID_INPUT', field: 'categoryName', message: '请输入分类名称。' })
      input?.focus()
      return
    }
    if (categories.some((category) => category.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setActiveError(null)
      setCategoryNotice(`分类“${name}”已存在，可直接用于项目。`)
      return
    }

    setAddingCategory(true)
    setActiveError(null)
    try {
      const result = await window.projectManager.createCategory({ name })
      if (result.ok) {
        onCatalogUpdated(result.data)
        setCategoryNotice(`已添加分类“${name}”。`)
      }
      else setActiveError(result.error)
    } finally {
      setAddingCategory(false)
    }
  }

  const chooseDirectory = async () => {
    setSelecting(true)
    setError(null)
    try {
      const path = await window.projectManager.selectProjectDirectory()
      if (path) {
        const preview = await window.projectManager.previewImportMigration(path)
        if (!preview.ok) {
          setError(preview.error)
          return
        }
        const migration = preview.data.items[0]
        if (!migration || migration.status === 'conflict' || migration.status === 'invalid') {
          setError({
            code: 'MIGRATION_CONFLICT',
            field: 'path',
            message: migration?.message ?? '无法生成项目迁移计划。'
          })
          return
        }
        setForm((current) => ({
          ...current,
          path,
          name: current.name || directoryName(path),
          expectedTargetPath: migration.targetPath,
          migrationConfirmed: true
        }))
      }
    } finally {
      setSelecting(false)
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.path || !form.expectedTargetPath || !form.migrationConfirmed) {
      setError({ code: 'INVALID_INPUT', field: 'path', message: '请先选择项目目录。' })
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const result = await window.projectManager.importExistingProject(form)
      if (result.ok) onSuccess(result.data)
      else setError(result.error)
    } finally {
      setSubmitting(false)
    }
  }

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    setCreating(true)
    setCreateError(null)
    try {
      const result = await window.projectManager.createEmptyProject(createForm)
      if (result.ok) onSuccess(result.data)
      else setCreateError(result.error)
    } finally {
      setCreating(false)
    }
  }

  const basePath = settings.defaultProjectDirectory.replace(/[\\/]+$/, '')
  const separator = basePath.includes('\\') ? '\\' : '/'
  const targetPreview = basePath && createForm.name.trim()
    ? `${basePath}${separator}${createForm.name.trim()}`
    : basePath

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal modal--project" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <header className="modal__header">
          <div>
            <span className="eyebrow">本地项目</span>
            <h2 id="import-title">添加本地项目</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <CloseIcon />
          </button>
        </header>

        <div className="dialog-tabs" role="tablist" aria-label="添加项目方式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'import'}
            onClick={() => { setCategoryNotice(''); setMode('import') }}
          >导入现有</button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'create'}
            onClick={() => { setCategoryNotice(''); setMode('create') }}
          >创建空项目</button>
        </div>

        {mode === 'import' ? <form onSubmit={submit}>
          <div className="modal__body">
          <div className="form-field">
            <label htmlFor="project-path">项目目录</label>
            <div className="path-picker">
              <input id="project-path" value={form.path} readOnly placeholder="请选择一个现有目录" />
              <button type="button" className="secondary-button" onClick={chooseDirectory} disabled={selecting}>
                <FolderIcon /> {selecting ? '选择中…' : '浏览'}
              </button>
            </div>
            <small>提交后会把项目目录安全迁移到默认存储位置，不修改目录内部内容。</small>
          </div>

          {form.expectedTargetPath && (
            <div className="migration-preview">
              <strong>将统一迁移到默认位置</strong>
              <span>{form.path}</span>
              <span aria-hidden="true">↓</span>
              <span>{form.expectedTargetPath}</span>
            </div>
          )}

          <div className="form-field">
            <label htmlFor="project-name">项目名称 <span>*</span></label>
            <input
              id="project-name"
              value={form.name}
              maxLength={80}
              required
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </div>

          <div className="form-field">
            <div className="label-row">
              <label htmlFor="project-description">项目描述</label>
              <span>{form.description.length} / 200</span>
            </div>
            <textarea
              id="project-description"
              value={form.description}
              maxLength={200}
              rows={3}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </div>

          <div className="form-field">
            <label htmlFor="project-category">分类 <span>*</span></label>
            <div className="category-picker">
              <input
                ref={importCategoryRef}
                id="project-category"
                list="project-categories"
                value={form.categoryName}
                maxLength={30}
                required
                placeholder="选择已有分类或输入新分类"
                onChange={(event) => {
                  setCategoryNotice('')
                  if (error?.field === 'categoryName') setError(null)
                  setForm({ ...form, categoryName: event.target.value })
                }}
              />
              <button
                type="button"
                className="secondary-button"
                disabled={addingCategory}
                onClick={() => void addCategory(form.categoryName)}
              >
                <PlusIcon />{addingCategory ? '添加中…' : '添加分类'}
              </button>
            </div>
            <datalist id="project-categories">
              {categories.map((category) => <option key={category.id} value={category.name} />)}
            </datalist>
            <small>可选择已有分类，或输入名称后添加新分类。</small>
            {categoryNotice && <div className="form-notice" role="status">{categoryNotice}</div>}
          </div>

          {error && <div className="form-error" role="alert">{error.message}</div>}
          </div>

          <footer className="modal__footer">
            <button type="button" className="secondary-button" onClick={onClose}>取消</button>
            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? '正在添加…' : '添加项目'}
            </button>
          </footer>
        </form> : <form onSubmit={submitCreate}>
          <div className="modal__body">
          {!settings.defaultProjectDirectory && (
            <div className="setup-callout" role="status">
              <div><strong>需要默认项目位置</strong><p>空项目会直接创建在默认存储位置下。</p></div>
              <button type="button" className="secondary-button" onClick={onOpenSettings}>前往设置</button>
            </div>
          )}

          <div className="form-field">
            <label htmlFor="create-project-name">项目名称 <span>*</span></label>
            <input
              id="create-project-name"
              value={createForm.name}
              maxLength={80}
              required
              placeholder="同时作为项目目录名"
              onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })}
            />
            <small>不能包含路径分隔符、系统保留字符或保留名称。</small>
          </div>

          <div className="form-field">
            <div className="label-row">
              <label htmlFor="create-project-description">项目描述</label>
              <span>{createForm.description.length} / 200</span>
            </div>
            <textarea
              id="create-project-description"
              value={createForm.description}
              maxLength={200}
              rows={3}
              onChange={(event) => setCreateForm({ ...createForm, description: event.target.value })}
            />
          </div>

          <div className="form-field">
            <label htmlFor="create-project-category">分类 <span>*</span></label>
            <div className="category-picker">
              <input
                ref={createCategoryRef}
                id="create-project-category"
                list="create-project-categories"
                value={createForm.categoryName}
                maxLength={30}
                required
                placeholder="选择已有分类或输入新分类"
                onChange={(event) => {
                  setCategoryNotice('')
                  if (createError?.field === 'categoryName') setCreateError(null)
                  setCreateForm({ ...createForm, categoryName: event.target.value })
                }}
              />
              <button
                type="button"
                className="secondary-button"
                disabled={addingCategory}
                onClick={() => void addCategory(createForm.categoryName)}
              >
                <PlusIcon />{addingCategory ? '添加中…' : '添加分类'}
              </button>
            </div>
            <datalist id="create-project-categories">
              {categories.map((category) => <option key={category.id} value={category.name} />)}
            </datalist>
            <small>可选择已有分类，或输入名称后添加新分类。</small>
            {categoryNotice && <div className="form-notice" role="status">{categoryNotice}</div>}
          </div>

          <div className="form-field">
            <label htmlFor="create-project-target">项目目标位置</label>
            <input
              id="create-project-target"
              value={targetPreview}
              readOnly
              placeholder="请先设置默认项目位置"
            />
          </div>

          {createError && <div className="form-error" role="alert">{createError.message}</div>}
          </div>

          <footer className="modal__footer">
            <button type="button" className="secondary-button" onClick={onClose}>取消</button>
            <button
              type="submit"
              className="primary-button"
              disabled={creating || !settings.defaultProjectDirectory}
            >
              {creating ? '正在创建…' : '创建项目'}
            </button>
          </footer>
        </form>}
      </section>
    </div>
  )
}

const ProjectItem = ({
  project,
  categoryName,
  view
}: {
  project: ProjectDto
  categoryName: string
  view: ViewMode
}) => (
  <article className={view === 'card' ? 'project-card' : 'project-row'}>
    <div className="project-card__top">
      <div className="project-folder"><FolderIcon /></div>
      <div>
        <h3>{project.name}</h3>
        <p>{project.description || '暂无项目描述'}</p>
      </div>
    </div>
    <div className="project-card__meta">
      <span>{categoryName}</span>
      <span>更新于 {formatDate(project.updatedAt)}</span>
    </div>
    <div className="project-card__path" title={project.path}>{project.path}</div>
  </article>
)

interface SettingsDialogProps {
  settings: AppSettingsDto
  requiredSetup?: boolean
  onClose(): void
  onSuccess(snapshot: CatalogSnapshotDto): void
}

const SettingsDialog = ({ settings, requiredSetup = false, onClose, onSuccess }: SettingsDialogProps) => {
  const [draft, setDraft] = useState<AppSettingsDto>(() => structuredClone(settings))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const chooseDefaultDirectory = async () => {
    const path = await window.projectManager.selectDefaultProjectDirectory()
    if (path) setDraft((current) => ({ ...current, defaultProjectDirectory: path }))
  }

  const chooseIdeExecutable = async () => {
    const path = await window.projectManager.selectIdeExecutable()
    if (path) {
      setDraft((current) => ({
        ...current,
        ide: { ...current.ide, customExecutablePath: path }
      }))
    }
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const result = await window.projectManager.updateSettings(draft)
      if (result.ok) onSuccess(result.data)
      else setError(result.error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (!requiredSetup && event.target === event.currentTarget) onClose()
      }}
    >
      <section className="modal modal--settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="modal__header">
          <div>
            <span className="eyebrow">本地偏好</span>
            <h2 id="settings-title">设置</h2>
          </div>
          {!requiredSetup && (
            <button className="icon-button" type="button" onClick={onClose} aria-label="关闭设置">
              <CloseIcon />
            </button>
          )}
        </header>

        <form onSubmit={save}>
          {requiredSetup && (
            <div className="settings-required" role="status">
              首次使用前，请先选择项目的默认存储位置。保存后才能继续使用项目管理器。
            </div>
          )}
          <section className="settings-section">
            <div className="settings-section__heading">
              <FolderIcon />
              <div><h3>默认项目位置</h3><p>创建或克隆项目时优先使用此目录。</p></div>
            </div>
            <div className="path-picker">
              <input
                aria-label="默认项目位置"
                value={draft.defaultProjectDirectory}
                readOnly
                required={requiredSetup}
                placeholder="尚未设置"
              />
              <button type="button" className="secondary-button" onClick={chooseDefaultDirectory}>浏览</button>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section__heading">
              <CodeIcon />
              <div><h3>项目打开方式</h3><p>内置支持 VS Code，也可以选择本机其他 IDE。</p></div>
            </div>
            <div className="form-field">
              <label htmlFor="ide-type">默认 IDE</label>
              <select
                id="ide-type"
                value={draft.ide.type}
                onChange={(event) => setDraft({
                  ...draft,
                  ide: { ...draft.ide, type: event.target.value as AppSettingsDto['ide']['type'] }
                })}
              >
                <option value="vscode">Visual Studio Code</option>
                <option value="custom">自定义 IDE</option>
              </select>
            </div>

            {draft.ide.type === 'custom' && (
              <div className="form-field">
                <label htmlFor="custom-ide-path">IDE 程序路径 <span>*</span></label>
                <div className="path-picker">
                  <input
                    id="custom-ide-path"
                    value={draft.ide.customExecutablePath}
                    readOnly
                    required
                    placeholder="选择 IDE 可执行程序"
                  />
                  <button type="button" className="secondary-button" onClick={chooseIdeExecutable}>浏览</button>
                </div>
              </div>
            )}
            {draft.ide.type === 'vscode' && <div className="settings-hint">• 使用系统中的 <code>code</code> 命令打开项目</div>}
          </section>

          {error && <div className="form-error" role="alert">{error}</div>}

          <footer className="modal__footer">
            {!requiredSetup && <button type="button" className="secondary-button" onClick={onClose}>取消</button>}
            <button
              type="submit"
              className="primary-button"
              disabled={saving || (requiredSetup && !draft.defaultProjectDirectory.trim())}
            >
              {saving ? '正在保存…' : '保存设置'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}

interface MigrationDialogProps {
  plan: MigrationPlanDto
  onClose(): void
  onCatalogUpdated(snapshot: CatalogSnapshotDto): void
  onPlanUpdated(plan: MigrationPlanDto): void
}

const MigrationDialog = ({ plan, onClose, onCatalogUpdated, onPlanUpdated }: MigrationDialogProps) => {
  const [running, setRunning] = useState(false)
  const [batch, setBatch] = useState<MigrationBatchDto | null>(null)
  const [error, setError] = useState('')
  const readyItems = plan.items.filter((item) => item.status === 'ready')
  const visibleItems = plan.items.filter((item) => item.status !== 'already-managed')

  const execute = async () => {
    setRunning(true)
    setError('')
    try {
      const result = await window.projectManager.executeMigrations({
        items: readyItems.map(({ projectId, sourcePath, targetPath }) => ({
          projectId,
          sourcePath,
          targetPath
        }))
      })
      if (result.ok) {
        setBatch(result.data)
        onCatalogUpdated(result.data.snapshot)
        const refreshed = await window.projectManager.getMigrationPlan()
        if (refreshed.ok) onPlanUpdated(refreshed.data)
      } else setError(result.error.message)
    } finally {
      setRunning(false)
    }
  }

  const retryCleanup = async (operationId: string) => {
    setError('')
    const result = await window.projectManager.retryMigrationCleanup(operationId)
    if (result.ok) onPlanUpdated(result.data)
    else setError(result.error.message)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal modal--migration" role="dialog" aria-modal="true" aria-labelledby="migration-title">
        <header className="modal__header">
          <div><span className="eyebrow">统一项目位置</span><h2 id="migration-title">迁移到默认存储位置</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭迁移窗口"><CloseIcon /></button>
        </header>
        <div className="migration-dialog__body">
          <p className="migration-warning">确认后，项目将离开原位置。同卷直接移动，跨卷校验复制后把原目录移入系统回收站。</p>
          <div className="migration-items">
            {visibleItems.map((item) => {
              const result = batch?.items.find((candidate) => candidate.projectId === item.projectId)
              return (
                <article className={`migration-item migration-item--${result?.status ?? item.status}`} key={item.projectId}>
                  <div><strong>{item.projectName}</strong><span>{result?.message ?? item.message ?? (item.status === 'ready' ? '等待迁移' : item.status)}</span></div>
                  <code>{item.sourcePath}</code><span aria-hidden="true">→</span><code>{item.targetPath}</code>
                </article>
              )
            })}
            {plan.cleanupPending.map((item) => (
              <article className="migration-item migration-item--cleanup-pending" key={item.operationId}>
                <div><strong>原目录待清理</strong><span>项目已从新路径可用</span></div>
                <code>{item.sourcePath}</code><span aria-hidden="true">→</span><code>{item.targetPath}</code>
                <button className="secondary-button" type="button" onClick={() => retryCleanup(item.operationId)}>重试移入回收站</button>
              </article>
            ))}
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
        </div>
        <footer className="modal__footer migration-dialog__footer">
          <button type="button" className="secondary-button" onClick={onClose}>取消</button>
          <button type="button" className="primary-button" onClick={execute} disabled={running || readyItems.length === 0}>
            {running ? '正在逐项迁移…' : `确认迁移 ${readyItems.length} 个项目`}
          </button>
        </footer>
      </section>
    </div>
  )
}

export const App = () => {
  const [catalog, setCatalog] = useState<CatalogSnapshotDto>(emptySnapshot)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [migrationOpen, setMigrationOpen] = useState(false)
  const [migrationPlan, setMigrationPlan] = useState<MigrationPlanDto>({ items: [], cleanupPending: [] })
  const [query, setQuery] = useState<ProjectQuery>(defaultProjectQuery)

  useEffect(() => {
    let active = true
    void window.projectManager.getCatalog().then((result) => {
      if (!active) return
      if (result.ok) {
        setCatalog(result.data)
        setStatus('ready')
        if (!result.data.settings.defaultProjectDirectory) setSettingsOpen(true)
        void window.projectManager.getMigrationPlan().then((plan) => {
          if (active && plan.ok) setMigrationPlan(plan.data)
        })
      } else {
        setLoadError(result.error.message)
        setStatus('error')
      }
    })
    return () => { active = false }
  }, [])

  const categoryCounts = useMemo(
    () => catalog.categories.map((category) => ({
      ...category,
      count: catalog.projects.filter((project) => project.categoryId === category.id).length
    })),
    [catalog]
  )

  const categoryNames = useMemo(
    () => new Map(catalog.categories.map((category) => [category.id, category.name])),
    [catalog.categories]
  )

  const projects = useMemo(
    () => visibleProjects(catalog.projects, query),
    [catalog.projects, query]
  )

  const title = scopeTitle(query.scope, catalog.categories)
  const migrationCount = migrationPlan.items.filter((item) => item.status !== 'already-managed').length
  const hasMigrationWork = migrationCount > 0 || migrationPlan.cleanupPending.length > 0

  const updateQuery = <Key extends keyof ProjectQuery>(key: Key, value: ProjectQuery[Key]) => {
    setQuery((current) => ({ ...current, [key]: value }))
  }

  const applyCatalog = (snapshot: CatalogSnapshotDto) => {
    setCatalog(snapshot)
    void window.projectManager.getMigrationPlan().then((result) => {
      if (result.ok) setMigrationPlan(result.data)
    })
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__icon"><LogoMark /></span>
          <span>项目管理器</span>
        </div>
        <nav aria-label="项目导航">
          <button
            className={`nav-item${query.scope.kind === 'all' ? ' nav-item--active' : ''}`}
            type="button"
            onClick={() => updateQuery('scope', { kind: 'all' })}
          >
            <FolderIcon /><span>全部项目</span><b>{catalog.projects.length}</b>
          </button>
          <button className="nav-item" type="button" disabled>
            <ClockIcon /><span>最近使用</span><b>0</b>
          </button>
          <div className="nav-label">分类</div>
          {categoryCounts.length === 0 ? (
            <p className="sidebar-empty">添加项目时创建分类</p>
          ) : categoryCounts.map((category) => (
            <button
              className={`nav-item nav-item--category${
                query.scope.kind === 'category' && query.scope.categoryId === category.id
                  ? ' nav-item--active'
                  : ''
              }`}
              type="button"
              key={category.id}
              onClick={() => updateQuery('scope', { kind: 'category', categoryId: category.id })}
            >
              <span className="category-dot" /><span>{category.name}</span><b>{category.count}</b>
            </button>
          ))}
        </nav>
        <div className="sidebar__footer">
          <button type="button" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon />设置
          </button>
          <span>数据仅保存在此设备</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="search-field">
            <SearchIcon />
            <input
              aria-label="搜索项目"
              type="search"
              value={query.searchText}
              placeholder="按名称、描述或路径搜索"
              onChange={(event) => updateQuery('searchText', event.target.value)}
            />
          </div>
          <button className="primary-button" onClick={() => setDialogOpen(true)}>
            <PlusIcon />添加项目
          </button>
        </header>

        <section className="content">
          {status === 'ready' && hasMigrationWork && (
            <div className="migration-banner" role="status">
              <div>
                <strong>{migrationCount > 0 ? `有 ${migrationCount} 个项目需要整理` : '有项目原目录待清理'}</strong>
                <span>统一迁移到默认存储位置，目标冲突不会覆盖。</span>
              </div>
              <button className="secondary-button" type="button" onClick={() => setMigrationOpen(true)}>查看迁移计划</button>
            </div>
          )}
          <div className="content-heading">
            <div>
              <span className="eyebrow">你的工作空间</span>
              <h1>{title} <small>{projects.length}</small></h1>
            </div>
            <div className="content-controls">
              <label>
                <span>排序</span>
                <select
                  aria-label="项目排序"
                  value={query.sort}
                  onChange={(event) => updateQuery('sort', event.target.value as SortKey)}
                >
                  <option value="updatedAtDesc">最近更新</option>
                  <option value="nameAsc">名称</option>
                </select>
              </label>
              <div className="view-toggle" aria-label="项目视图">
                <button
                  type="button"
                  className={query.view === 'card' ? 'is-active' : ''}
                  aria-label="卡片视图"
                  aria-pressed={query.view === 'card'}
                  onClick={() => updateQuery('view', 'card')}
                ><GridIcon /></button>
                <button
                  type="button"
                  className={query.view === 'list' ? 'is-active' : ''}
                  aria-label="列表视图"
                  aria-pressed={query.view === 'list'}
                  onClick={() => updateQuery('view', 'list')}
                ><ListIcon /></button>
              </div>
            </div>
          </div>

          {status === 'loading' && <div className="state-panel">正在读取本地项目…</div>}
          {status === 'error' && (
            <div className="state-panel state-panel--error">
              <h2>无法读取项目数据</h2><p>{loadError}</p>
            </div>
          )}
          {status === 'ready' && catalog.projects.length === 0 && (
            <div className="empty-state">
              <div className="empty-state__icon"><FolderIcon /></div>
              <h2>从第一个本地项目开始</h2>
              <p>选择磁盘上的现有项目目录，把它加入你的项目空间。</p>
              <button className="primary-button" onClick={() => setDialogOpen(true)}>
                <PlusIcon />添加本地项目
              </button>
            </div>
          )}
          {status === 'ready' && catalog.projects.length > 0 && (
            projects.length === 0 ? (
              <div className="empty-state empty-state--no-match">
                <div className="empty-state__icon"><SearchIcon /></div>
                <h2>无匹配项目</h2>
                <p>尝试更换搜索词或选择其他分类。</p>
              </div>
            ) : (
            <div className={query.view === 'card' ? 'project-grid' : 'project-list'}>
              {projects.map((project) => (
                <ProjectItem
                  key={project.id}
                  project={project}
                  categoryName={categoryNames.get(project.categoryId) ?? '未分类'}
                  view={query.view}
                />
              ))}
            </div>
            )
          )}
        </section>
      </main>

      {dialogOpen && (
        <ImportDialog
          categories={catalog.categories}
          settings={catalog.settings}
          onClose={() => setDialogOpen(false)}
          onOpenSettings={() => { setDialogOpen(false); setSettingsOpen(true) }}
          onCatalogUpdated={setCatalog}
          onSuccess={(snapshot) => { applyCatalog(snapshot); setDialogOpen(false) }}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          settings={catalog.settings}
          requiredSetup={!catalog.settings.defaultProjectDirectory}
          onClose={() => setSettingsOpen(false)}
          onSuccess={(snapshot) => { applyCatalog(snapshot); setSettingsOpen(false) }}
        />
      )}
      {migrationOpen && (
        <MigrationDialog
          plan={migrationPlan}
          onClose={() => setMigrationOpen(false)}
          onCatalogUpdated={setCatalog}
          onPlanUpdated={setMigrationPlan}
        />
      )}
    </div>
  )
}
