const { mkdir, readFile, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { app, BrowserWindow } = require('electron')

const projectRoot = join(__dirname, '..')
const resourcesDirectory = join(projectRoot, 'resources')
const sizes = [16, 32, 48, 64, 128, 256, 512]

const createIco = (png) => {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  const entry = Buffer.alloc(16)
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(22, 12)
  return Buffer.concat([header, entry, png])
}

const createIcns = (images) => {
  const chunks = images.map(([type, png]) => {
    const header = Buffer.alloc(8)
    header.write(type, 0, 4, 'ascii')
    header.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([header, png])
  })
  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(chunks.reduce((length, chunk) => length + chunk.length, 8), 4)
  return Buffer.concat([header, ...chunks])
}

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  await readFile(join(resourcesDirectory, 'logo.svg'))
  const window = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { backgroundThrottling: false }
  })
  await window.loadFile(join(__dirname, 'icon-render.html'))
  await window.webContents.executeJavaScript(
    'document.querySelector("img").decode().then(() => true)'
  )
  const source = await window.webContents.capturePage()
  const outputDirectory = join(resourcesDirectory, 'icons')
  await mkdir(outputDirectory, { recursive: true })
  const sourcePng = source.toPNG()
  const pngs = new Map()
  await writeFile(join(resourcesDirectory, 'icon.png'), sourcePng)
  await Promise.all(sizes.map(async (size) => {
    const resized = source.resize({ width: size, height: size, quality: 'best' })
    const png = resized.toPNG()
    pngs.set(size, png)
    await writeFile(join(outputDirectory, `${size}x${size}.png`), png)
  }))
  await writeFile(join(resourcesDirectory, 'icon.ico'), createIco(pngs.get(256)))
  await writeFile(join(resourcesDirectory, 'icon.icns'), createIcns([
    ['icp4', pngs.get(16)],
    ['icp5', pngs.get(32)],
    ['icp6', pngs.get(64)],
    ['ic07', pngs.get(128)],
    ['ic08', pngs.get(256)],
    ['ic09', pngs.get(512)],
    ['ic10', sourcePng]
  ]))
  window.destroy()
  app.quit()
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
