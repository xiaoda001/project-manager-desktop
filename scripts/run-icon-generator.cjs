const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

const electronPath = require('electron')
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE

const result = spawnSync(electronPath, [join(__dirname, 'generate-app-icons.cjs')], {
  env: environment,
  stdio: 'inherit'
})

process.exit(result.status ?? 1)
