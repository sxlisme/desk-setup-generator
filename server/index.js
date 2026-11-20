import express from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { JSONFilePreset } from 'lowdb/node'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const dataDir = process.env.DATA_DIR || path.join(rootDir, 'data')
const uploadDir = path.join(dataDir, 'uploads')
const port = Number(process.env.PORT || 3000)

fs.mkdirSync(uploadDir, { recursive: true })

const types = [
  '显示器', '主机', '电脑', '音响', '耳机', '键盘', '鼠标', '台灯',
  '壁挂灯', '背光灯', '增高架', '氛围装饰', '绿植', '鼠标垫', '桌子', '收纳'
]

const seedDevices = [
  { id: 'seed-monitor', type: '显示器', name: '微星 白刃 E20', detail1: '27英寸 · 2K · 200Hz', detail2: '银白外观，色彩细腻', brand: 'MSI' },
  { id: 'seed-host', type: '主机', name: 'Mac mini (M4)', detail1: '小巧高效的桌面主机', detail2: '日常办公与剪辑流畅', brand: 'Apple' },
  { id: 'seed-speaker', type: '音响', name: '漫步者 MR4', detail1: '监听级音质', detail2: '体积小巧，颜值在线', brand: 'Edifier' },
  { id: 'seed-keyboard', type: '键盘', name: '机械键盘（客制化）', detail1: '青轴手感清脆', detail2: '配色清爽，敲击舒适', brand: '' },
  { id: 'seed-mouse', type: '鼠标', name: '罗技 MX Master 3S', detail1: '人体工学设计', detail2: '高效办公利器', brand: 'Logitech' },
  { id: 'seed-lightbar', type: '壁挂灯', name: '屏幕挂灯', detail1: '非对称光源，照亮桌面', detail2: '不反光，不眩光', brand: '' },
  { id: 'seed-lamp', type: '台灯', name: '宜家 TERTIAL 台灯', detail1: '经典工业风', detail2: '角度灵活，补光自然', brand: 'IKEA' },
  { id: 'seed-headphone', type: '耳机', name: 'AirPods Max', detail1: '空间音频体验出色', detail2: '日常听歌观影沉浸', brand: 'Apple' },
  { id: 'seed-stand', type: '增高架', name: '显示器增高架', detail1: '提升桌面收纳空间', detail2: '让桌面整洁有序', brand: '' },
  { id: 'seed-plant', type: '绿植', name: '龟背竹', detail1: '提升桌面氛围', detail2: '一点绿意，让空间自然', brand: '' }
]

const db = await JSONFilePreset(path.join(dataDir, 'db.json'), {
  devices: seedDevices,
  templates: []
})

if (!Array.isArray(db.data.devices) || db.data.devices.length === 0) {
  db.data.devices = seedDevices
  await db.write()
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png'
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith('image/'))
})

const app = express()
app.use(express.json({ limit: '2mb' }))
app.use('/uploads', express.static(uploadDir))

app.get('/api/bootstrap', (_req, res) => {
  res.json({ types, devices: db.data.devices, templates: db.data.templates })
})

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: '请选择图片文件' })
  res.status(201).json({ url: `/uploads/${req.file.filename}` })
})

app.post('/api/devices', async (req, res) => {
  const { name, type, detail1 = '', detail2 = '', brand = '', image = '' } = req.body
  if (!name?.trim() || !types.includes(type)) {
    return res.status(400).json({ message: '设备名称和类型不能为空' })
  }
  const device = {
    id: `device-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    type,
    detail1: detail1.trim(),
    detail2: detail2.trim(),
    brand: brand.trim(),
    image
  }
  db.data.devices.unshift(device)
  await db.write()
  res.status(201).json(device)
})

app.put('/api/devices/:id', async (req, res) => {
  const index = db.data.devices.findIndex((item) => item.id === req.params.id)
  if (index < 0) return res.status(404).json({ message: '设备不存在' })
  db.data.devices[index] = { ...db.data.devices[index], ...req.body, id: req.params.id }
  await db.write()
  res.json(db.data.devices[index])
})

app.delete('/api/devices/:id', async (req, res) => {
  const index = db.data.devices.findIndex((item) => item.id === req.params.id)
  if (index < 0) return res.status(404).json({ message: '设备不存在' })
  db.data.devices.splice(index, 1)
  await db.write()
  res.status(204).end()
})

app.post('/api/templates', async (req, res) => {
  const name = req.body.name?.trim()
  if (!name) return res.status(400).json({ message: '请输入模板名称' })
  const template = {
    id: `template-${Date.now()}`,
    name,
    createdAt: new Date().toISOString(),
    config: req.body.config
  }
  db.data.templates.unshift(template)
  await db.write()
  res.status(201).json(template)
})

app.put('/api/templates/:id', async (req, res) => {
  const index = db.data.templates.findIndex((item) => item.id === req.params.id)
  if (index < 0) return res.status(404).json({ message: '模板不存在' })
  db.data.templates[index] = {
    ...db.data.templates[index],
    name: req.body.name?.trim() || db.data.templates[index].name,
    config: req.body.config,
    updatedAt: new Date().toISOString()
  }
  await db.write()
  res.json(db.data.templates[index])
})

app.delete('/api/templates/:id', async (req, res) => {
  const index = db.data.templates.findIndex((item) => item.id === req.params.id)
  if (index < 0) return res.status(404).json({ message: '模板不存在' })
  db.data.templates.splice(index, 1)
  await db.write()
  res.status(204).end()
})

const distDir = path.join(rootDir, 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({
    message: error.code === 'LIMIT_FILE_SIZE' ? '图片不能超过 12MB' : '服务暂时不可用'
  })
})

app.listen(port, '0.0.0.0', () => {
  console.log(`Desk setup generator is running on http://localhost:${port}`)
})
