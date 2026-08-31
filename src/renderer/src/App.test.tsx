// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogResult, CatalogSnapshotDto, ProjectManagerApi } from '../../shared/contracts'
import { App } from './App'

const emptyCatalog: CatalogSnapshotDto = {
  projects: [],
  categories: [],
  settings: {
    defaultProjectDirectory: 'C:\\workspace',
    ide: { type: 'vscode', customExecutablePath: '' },
    projectActions: [
      { id: 'open-vscode', label: 'VS Code', type: 'vscode', customExecutablePath: '' },
      { id: 'open-folder', label: '文件夹', type: 'folder', customExecutablePath: '' },
      { id: 'open-repository', label: 'Git 仓库', type: 'repository', customExecutablePath: '' }
    ]
  }
}

const populatedCatalog: CatalogSnapshotDto = {
  settings: emptyCatalog.settings,
  categories: [
    { id: 'category-tools', name: '工具', createdAt: '2026-08-28T10:00:00.000Z' },
    { id: 'category-services', name: '服务', createdAt: '2026-08-29T10:00:00.000Z' }
  ],
  projects: [
    {
      id: 'project-alpha',
      name: 'Alpha Tool',
      description: 'React desktop utility',
      gitUrl: 'git@github.com:team/alpha-tool.git',
      categoryId: 'category-tools',
      path: 'C:\\work\\alpha',
      source: 'existing',
      createdAt: '2026-08-28T10:00:00.000Z',
      updatedAt: '2026-08-29T10:00:00.000Z',
      lastOpenedAt: null
    },
    {
      id: 'project-beta',
      name: 'Beta API',
      description: 'Backend service',
      categoryId: 'category-services',
      path: 'D:\\code\\beta',
      source: 'existing',
      createdAt: '2026-08-29T10:00:00.000Z',
      updatedAt: '2026-08-30T10:00:00.000Z',
      lastOpenedAt: null
    }
  ]
}

const api = (): ProjectManagerApi => ({
  selectProjectDirectory: vi.fn(async () => 'C:\\work\\project-manager'),
  selectDefaultProjectDirectory: vi.fn(async () => 'C:\\workspace'),
  selectIdeExecutable: vi.fn(async () => 'C:\\Tools\\IDE.exe'),
  getCatalog: vi.fn(async (): Promise<CatalogResult> => ({ ok: true, data: emptyCatalog })),
  createCategory: vi.fn(async ({ name }): Promise<CatalogResult> => ({
    ok: true,
    data: {
      ...emptyCatalog,
      categories: [{ id: 'category-new', name: name.trim(), createdAt: '2026-08-30T10:00:00.000Z' }]
    }
  })),
  previewImportMigration: vi.fn(async () => ({
    ok: true as const,
    data: {
      items: [{
        projectId: '__import-preview__',
        projectName: 'project-manager',
        sourcePath: 'C:\\work\\project-manager',
        targetPath: 'C:\\workspace\\project-manager',
        status: 'ready' as const
      }],
      cleanupPending: []
    }
  })),
  getMigrationPlan: vi.fn(async () => ({
    ok: true as const,
    data: { items: [], cleanupPending: [] }
  })),
  executeMigrations: vi.fn(async () => ({
    ok: true as const,
    data: { snapshot: emptyCatalog, items: [] }
  })),
  retryMigrationCleanup: vi.fn(async () => ({
    ok: true as const,
    data: { items: [], cleanupPending: [] }
  })),
  openProjectInIde: vi.fn(async (): Promise<CatalogResult> => ({ ok: true, data: emptyCatalog })),
  openProjectFolder: vi.fn(async (): Promise<CatalogResult> => ({ ok: true, data: emptyCatalog })),
  openProjectRepository: vi.fn(async (): Promise<CatalogResult> => ({ ok: true, data: emptyCatalog })),
  runProjectAction: vi.fn(async (): Promise<CatalogResult> => ({ ok: true, data: emptyCatalog })),
  updateProject: vi.fn(async (): Promise<CatalogResult> => ({ ok: true, data: emptyCatalog })),
  deleteProject: vi.fn(async (): Promise<CatalogResult> => ({ ok: true, data: emptyCatalog })),
  importExistingProject: vi.fn(async (): Promise<CatalogResult> => ({
    ok: true,
    data: {
      categories: [{ id: 'category-1', name: '工具', createdAt: '2026-08-29T10:00:00.000Z' }],
      settings: emptyCatalog.settings,
      projects: [{
        id: 'project-1',
        name: 'project-manager',
        description: '本地项目管理器',
        categoryId: 'category-1',
        path: 'C:\\workspace\\project-manager',
        source: 'existing',
        createdAt: '2026-08-29T10:00:00.000Z',
        updatedAt: '2026-08-29T10:00:00.000Z',
        lastOpenedAt: null
      }]
    }
  })),
  createEmptyProject: vi.fn(async (): Promise<CatalogResult> => ({
    ok: true,
    data: emptyCatalog
  })),
  updateSettings: vi.fn(async (settings): Promise<CatalogResult> => ({
    ok: true,
    data: { ...emptyCatalog, settings }
  }))
})

describe('App import flow', () => {
  beforeEach(() => { window.projectManager = api() })

  it('loads the empty state and imports an existing directory with a new category', async () => {
    render(<App />)
    expect(await screen.findByText('从第一个本地项目开始')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '添加本地项目' }))
    fireEvent.click(screen.getByRole('button', { name: /浏览/ }))
    await waitFor(() => expect(screen.getByLabelText(/项目名称/)).toHaveValue('project-manager'))

    fireEvent.change(screen.getByLabelText('项目描述'), { target: { value: '本地项目管理器' } })
    fireEvent.change(screen.getByLabelText(/分类/), { target: { value: '工具' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '添加项目' }))

    expect(await screen.findByRole('heading', { name: 'project-manager' })).toBeInTheDocument()
    expect(screen.getAllByText('工具')).toHaveLength(2)
    expect(window.projectManager.importExistingProject).toHaveBeenCalledWith({
      name: 'project-manager',
      description: '本地项目管理器',
      gitUrl: '',
      categoryName: '工具',
      path: 'C:\\work\\project-manager',
      expectedTargetPath: 'C:\\workspace\\project-manager',
      migrationConfirmed: true
    })
  })

  it('adds a category from the project dialog without closing it', async () => {
    render(<App />)
    await screen.findByText('从第一个本地项目开始')

    fireEvent.click(screen.getByRole('button', { name: '添加本地项目' }))
    fireEvent.change(screen.getByLabelText(/分类/), { target: { value: '桌面工具' } })
    fireEvent.click(screen.getByRole('button', { name: '添加分类' }))

    await waitFor(() => expect(window.projectManager.createCategory).toHaveBeenCalledWith({ name: '桌面工具' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(await screen.findByText('已添加分类“桌面工具”。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加分类' })).toBeEnabled()
  })

  it('explains an empty category action and focuses the category field', async () => {
    render(<App />)
    await screen.findByText('从第一个本地项目开始')

    fireEvent.click(screen.getByRole('button', { name: '添加本地项目' }))
    fireEvent.click(screen.getByRole('button', { name: '添加分类' }))

    expect(screen.getByRole('alert')).toHaveTextContent('请输入分类名称。')
    expect(screen.getByLabelText(/分类/)).toHaveFocus()
    expect(window.projectManager.createCategory).not.toHaveBeenCalled()
  })

  it('shows a duplicate-path error without closing the form', async () => {
    window.projectManager.importExistingProject = vi.fn(async (): Promise<CatalogResult> => ({
      ok: false,
      error: { code: 'DUPLICATE_PATH', message: '“已有项目”已经使用该目录。', field: 'path' }
    }))
    render(<App />)
    await screen.findByText('从第一个本地项目开始')
    fireEvent.click(screen.getByRole('button', { name: '添加本地项目' }))
    fireEvent.click(screen.getByRole('button', { name: /浏览/ }))
    await waitFor(() => expect(screen.getByLabelText(/项目名称/)).toHaveValue('project-manager'))
    fireEvent.change(screen.getByLabelText(/分类/), { target: { value: '工具' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '添加项目' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('“已有项目”已经使用该目录。')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('configures multiple project action buttons and a custom program', async () => {
    render(<App />)
    await screen.findByText('从第一个本地项目开始')

    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    const dialog = screen.getByRole('dialog', { name: '设置' })
    fireEvent.click(within(dialog).getAllByRole('button', { name: '浏览' })[0]!)
    await waitFor(() => expect(screen.getByLabelText('默认项目位置')).toHaveValue('C:\\workspace'))

    fireEvent.click(within(dialog).getByRole('button', { name: '添加功能按钮' }))
    const actionNames = within(dialog).getAllByLabelText('按钮名称')
    fireEvent.change(actionNames[actionNames.length - 1]!, { target: { value: 'Rider' } })
    fireEvent.click(within(dialog).getAllByRole('button', { name: '浏览' })[1]!)
    await waitFor(() => expect(screen.getByLabelText('Rider 程序路径')).toHaveValue('C:\\Tools\\IDE.exe'))
    fireEvent.click(within(dialog).getByRole('button', { name: '保存设置' }))

    await waitFor(() => expect(window.projectManager.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultProjectDirectory: 'C:\\workspace',
        projectActions: expect.arrayContaining([
          expect.objectContaining({ label: 'Rider', type: 'custom', customExecutablePath: 'C:\\Tools\\IDE.exe' })
        ])
      })
    ))
    expect(screen.queryByRole('dialog', { name: '设置' })).not.toBeInTheDocument()
  })

  it('filters, navigates, sorts and switches project views', async () => {
    window.projectManager.getCatalog = vi.fn(async (): Promise<CatalogResult> => ({
      ok: true,
      data: populatedCatalog
    }))
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Beta API' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent))
      .toEqual(['Beta API', 'Alpha Tool'])

    const navigation = screen.getByRole('navigation', { name: '项目导航' })
    fireEvent.click(within(navigation).getByRole('button', { name: /工具/ }))
    expect(screen.getByRole('heading', { name: /工具 1/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Alpha Tool' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Beta API' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索项目' }), { target: { value: 'backend' } })
    expect(screen.getByRole('heading', { name: '无匹配项目' })).toBeInTheDocument()

    fireEvent.click(within(navigation).getByRole('button', { name: /全部项目/ }))
    expect(screen.getByRole('heading', { name: 'Beta API' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索项目' }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('combobox', { name: '项目排序' }), { target: { value: 'nameAsc' } })
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent))
      .toEqual(['Alpha Tool', 'Beta API'])

    fireEvent.click(screen.getByRole('button', { name: '列表视图' }))
    expect(screen.getByRole('button', { name: '列表视图' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelectorAll('.project-row')).toHaveLength(2)
  })

  it('hides local paths and exposes working project action buttons', async () => {
    window.projectManager.getCatalog = vi.fn(async (): Promise<CatalogResult> => ({
      ok: true,
      data: populatedCatalog
    }))
    window.projectManager.openProjectInIde = vi.fn(async (): Promise<CatalogResult> => ({
      ok: true,
      data: populatedCatalog
    }))
    window.projectManager.openProjectFolder = vi.fn(async (): Promise<CatalogResult> => ({
      ok: true,
      data: populatedCatalog
    }))
    window.projectManager.openProjectRepository = vi.fn(async (): Promise<CatalogResult> => ({
      ok: true,
      data: populatedCatalog
    }))
    window.projectManager.runProjectAction = vi.fn(async (): Promise<CatalogResult> => ({
      ok: true,
      data: populatedCatalog
    }))

    render(<App />)
    const heading = await screen.findByRole('heading', { name: 'Alpha Tool' })
    const card = heading.closest('article')
    expect(card).not.toBeNull()
    expect(within(card!).queryByText('C:\\work\\alpha')).not.toBeInTheDocument()

    fireEvent.click(within(card!).getByRole('button', { name: 'VS Code' }))
    await waitFor(() => expect(window.projectManager.runProjectAction).toHaveBeenCalledWith('project-alpha', 'open-vscode'))
    fireEvent.click(within(card!).getByRole('button', { name: '文件夹' }))
    await waitFor(() => expect(window.projectManager.runProjectAction).toHaveBeenCalledWith('project-alpha', 'open-folder'))
    fireEvent.click(within(card!).getByRole('button', { name: 'Git 仓库' }))
    await waitFor(() => expect(window.projectManager.runProjectAction).toHaveBeenCalledWith('project-alpha', 'open-repository'))
  })

  it('edits project metadata and deletes only the manager record after confirmation', async () => {
    const updatedCatalog: CatalogSnapshotDto = {
      ...populatedCatalog,
      projects: [
        { ...populatedCatalog.projects[0]!, name: 'Alpha Studio', description: 'Updated tool', gitUrl: 'https://github.com/team/alpha-studio', updatedAt: '2026-08-31T10:00:00.000Z' },
        populatedCatalog.projects[1]!
      ]
    }
    const deletedCatalog: CatalogSnapshotDto = {
      ...updatedCatalog,
      projects: [updatedCatalog.projects[1]!]
    }
    window.projectManager.getCatalog = vi.fn(async (): Promise<CatalogResult> => ({ ok: true, data: populatedCatalog }))
    window.projectManager.updateProject = vi.fn(async (): Promise<CatalogResult> => ({ ok: true, data: updatedCatalog }))
    window.projectManager.deleteProject = vi.fn(async (): Promise<CatalogResult> => ({ ok: true, data: deletedCatalog }))

    render(<App />)
    const originalHeading = await screen.findByRole('heading', { name: 'Alpha Tool' })
    fireEvent.click(within(originalHeading.closest('article')!).getByRole('button', { name: '修改' }))
    const editDialog = screen.getByRole('dialog', { name: '修改项目' })
    fireEvent.change(within(editDialog).getByLabelText(/项目名称/), { target: { value: 'Alpha Studio' } })
    fireEvent.change(within(editDialog).getByLabelText('项目描述'), { target: { value: 'Updated tool' } })
    fireEvent.change(within(editDialog).getByLabelText('Git 地址'), { target: { value: 'https://github.com/team/alpha-studio' } })
    fireEvent.click(within(editDialog).getByRole('button', { name: '保存修改' }))

    await waitFor(() => expect(window.projectManager.updateProject).toHaveBeenCalledWith({
      projectId: 'project-alpha',
      name: 'Alpha Studio',
      description: 'Updated tool',
      gitUrl: 'https://github.com/team/alpha-studio',
      categoryName: '工具'
    }))
    const updatedHeading = await screen.findByRole('heading', { name: 'Alpha Studio' })
    fireEvent.click(within(updatedHeading.closest('article')!).getByRole('button', { name: '删除' }))
    const deleteDialog = screen.getByRole('alertdialog', { name: '删除“Alpha Studio”？' })
    expect(within(deleteDialog).getByText(/不会删除本地目录/)).toBeInTheDocument()
    fireEvent.click(within(deleteDialog).getByRole('button', { name: '确认删除' }))

    await waitFor(() => expect(window.projectManager.deleteProject).toHaveBeenCalledWith('project-alpha'))
    expect(screen.queryByRole('heading', { name: 'Alpha Studio' })).not.toBeInTheDocument()
  })

  it('creates an empty project below the configured default directory without sending a path', async () => {
    const configuredCatalog: CatalogSnapshotDto = {
      ...emptyCatalog,
      settings: {
        ...emptyCatalog.settings,
        defaultProjectDirectory: 'C:\\workspace'
      }
    }
    window.projectManager.getCatalog = vi.fn(async (): Promise<CatalogResult> => ({
      ok: true,
      data: configuredCatalog
    }))
    window.projectManager.createEmptyProject = vi.fn(async (): Promise<CatalogResult> => ({
      ok: true,
      data: {
        ...configuredCatalog,
        categories: [{ id: 'category-1', name: '工具', createdAt: '2026-08-30T10:00:00.000Z' }],
        projects: [{
          id: 'project-1',
          name: 'dashboard',
          description: '内部工具',
          categoryId: 'category-1',
          path: 'C:\\workspace\\dashboard',
          source: 'created',
          createdAt: '2026-08-30T10:00:00.000Z',
          updatedAt: '2026-08-30T10:00:00.000Z',
          lastOpenedAt: null
        }]
      }
    }))

    render(<App />)
    await screen.findByText('从第一个本地项目开始')
    fireEvent.click(screen.getByRole('button', { name: '添加本地项目' }))
    fireEvent.click(screen.getByRole('tab', { name: '创建空项目' }))

    fireEvent.change(screen.getByLabelText(/项目名称/), { target: { value: 'dashboard' } })
    expect(screen.getByLabelText('项目目标位置')).toHaveValue('C:\\workspace\\dashboard')
    fireEvent.change(screen.getByLabelText('项目描述'), { target: { value: '内部工具' } })
    fireEvent.change(screen.getByLabelText('Git 地址'), { target: { value: 'git@github.com:team/dashboard.git' } })
    fireEvent.change(screen.getByLabelText(/分类/), { target: { value: '工具' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '创建项目' }))

    expect(await screen.findByRole('heading', { name: 'dashboard' })).toBeInTheDocument()
    expect(window.projectManager.createEmptyProject).toHaveBeenCalledWith({
      name: 'dashboard',
      description: '内部工具',
      gitUrl: 'git@github.com:team/dashboard.git',
      categoryName: '工具'
    })
  })

  it('requires the default project directory on first launch and closes only after saving it', async () => {
    window.projectManager.getCatalog = vi.fn(async (): Promise<CatalogResult> => ({
      ok: true,
      data: {
        ...emptyCatalog,
        settings: { ...emptyCatalog.settings, defaultProjectDirectory: '' }
      }
    }))

    render(<App />)
    const dialog = await screen.findByRole('dialog', { name: '设置' })

    expect(within(dialog).getByRole('status')).toHaveTextContent('首次使用前')
    expect(within(dialog).queryByRole('button', { name: '关闭设置' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: '取消' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '保存设置' })).toBeDisabled()

    fireEvent.click(within(dialog).getByRole('button', { name: '浏览' }))
    await waitFor(() => expect(screen.getByLabelText('默认项目位置')).toHaveValue('C:\\workspace'))
    fireEvent.click(within(dialog).getByRole('button', { name: '保存设置' }))

    await waitFor(() => expect(window.projectManager.updateSettings).toHaveBeenCalledWith({
      defaultProjectDirectory: 'C:\\workspace',
      ide: { type: 'vscode', customExecutablePath: '' },
      projectActions: emptyCatalog.settings.projectActions
    }))
    expect(screen.queryByRole('dialog', { name: '设置' })).not.toBeInTheDocument()
  })

  it('keeps the create form open when the target directory already exists', async () => {
    const configuredCatalog: CatalogSnapshotDto = {
      ...emptyCatalog,
      settings: {
        ...emptyCatalog.settings,
        defaultProjectDirectory: 'C:\\workspace'
      }
    }
    window.projectManager.getCatalog = vi.fn(async (): Promise<CatalogResult> => ({
      ok: true,
      data: configuredCatalog
    }))
    window.projectManager.createEmptyProject = vi.fn(async (): Promise<CatalogResult> => ({
      ok: false,
      error: {
        code: 'TARGET_ALREADY_EXISTS',
        field: 'name',
        message: '目标目录已存在，请更换项目名称。',
        targetPath: 'C:\\workspace\\dashboard'
      }
    }))

    render(<App />)
    await screen.findByText('从第一个本地项目开始')
    fireEvent.click(screen.getByRole('button', { name: '添加本地项目' }))
    fireEvent.click(screen.getByRole('tab', { name: '创建空项目' }))
    fireEvent.change(screen.getByLabelText(/项目名称/), { target: { value: 'dashboard' } })
    fireEvent.change(screen.getByLabelText(/分类/), { target: { value: '工具' } })
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('目标目录已存在')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText(/项目名称/)).toHaveValue('dashboard')
  })

  it('shows the migration plan and executes the confirmed move', async () => {
    const configuredCatalog: CatalogSnapshotDto = {
      ...populatedCatalog,
      settings: {
        ...emptyCatalog.settings,
        defaultProjectDirectory: 'C:\\managed'
      },
      projects: [populatedCatalog.projects[0]!]
    }
    const movedCatalog: CatalogSnapshotDto = {
      ...configuredCatalog,
      projects: [{ ...configuredCatalog.projects[0]!, path: 'C:\\managed\\Alpha Tool' }]
    }
    const plan = {
      items: [{
        projectId: 'project-alpha',
        projectName: 'Alpha Tool',
        sourcePath: 'C:\\work\\alpha',
        targetPath: 'C:\\managed\\Alpha Tool',
        status: 'ready' as const
      }],
      cleanupPending: []
    }
    window.projectManager.getCatalog = vi.fn(async () => ({ ok: true as const, data: configuredCatalog }))
    window.projectManager.getMigrationPlan = vi.fn(async () => ({ ok: true as const, data: plan }))
    window.projectManager.executeMigrations = vi.fn(async () => ({
      ok: true as const,
      data: {
        snapshot: movedCatalog,
        items: [{
          projectId: 'project-alpha',
          operationId: 'operation-1',
          status: 'completed' as const,
          targetPath: 'C:\\managed\\Alpha Tool',
          message: '迁移完成'
        }]
      }
    }))

    render(<App />)

    expect(await screen.findByText('有 1 个项目需要整理')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看迁移计划' }))
    const dialog = screen.getByRole('dialog', { name: '迁移到默认存储位置' })
    expect(within(dialog).getByText('C:\\work\\alpha')).toBeInTheDocument()
    expect(within(dialog).getByText('C:\\managed\\Alpha Tool')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '确认迁移 1 个项目' }))

    await waitFor(() => expect(window.projectManager.executeMigrations).toHaveBeenCalledWith({
      items: [{
        projectId: 'project-alpha',
        sourcePath: 'C:\\work\\alpha',
        targetPath: 'C:\\managed\\Alpha Tool'
      }]
    }))
    expect(await within(dialog).findByText('迁移完成')).toBeInTheDocument()
  })
})
