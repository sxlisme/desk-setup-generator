import express from 'express'
import { randomBytes } from 'node:crypto'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { JSONFilePreset } from 'lowdb/node'
import { installAuth } from './auth.js'
import { fail, safeFile, typeName, validateDevice, validateConfig, references, typeUsage, replaceType, packBackup, unpackBackup, restoreBackup } from './data-tools.js'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
if (fs.existsSync(path.join(rootDir, '.env'))) process.loadEnvFile(path.join(rootDir, '.env'))
const dataDir = process.env.DATA_DIR || path.join(rootDir, 'data')
const uploadDir = path.join(dataDir, 'uploads')
const port = Number(process.env.PORT || 3000)
const app = express()
app.disable('x-powered-by')
app.use((req,res,next) => {
  res.set('X-Content-Type-Options','nosniff').set('X-Frame-Options','DENY').set('Referrer-Policy','same-origin')
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) res.set('Cache-Control','no-store')
  next()
})
app.use(express.json({ limit: '2mb' }))
installAuth(app)
fs.mkdirSync(uploadDir, { recursive: true })
const defaultTypes = [
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

const db = await JSONFilePreset(path.join(dataDir, 'db.json'), { types: defaultTypes, devices: seedDevices, templates: [], draft: null, revision: randomBytes(12).toString('hex') })
// Migrate older data once; deliberately empty libraries and custom ordering stay intact.
db.data.devices ??= []
db.data.templates ??= []
db.data.types ??= [...new Set([...defaultTypes, ...db.data.devices.map(d => d.type), ...db.data.templates.flatMap(t => t.config.devices.map(d => d.type))])]
db.data.draft ??= null
db.data.revision ??= randomBytes(12).toString('hex')
await db.write()
let queue = Promise.resolve()
const exclusive = handler => (req,res,next) => {
  const task = queue.then(() => {
    if (!['GET','HEAD'].includes(req.method) && req.get('X-Data-Revision') && req.get('X-Data-Revision') !== db.data.revision) throw fail('数据已恢复过，请刷新页面后继续操作',409)
    return handler(req,res)
  })
  queue = task.catch(() => {})
  task.catch(next)
}
const persist = async () => { await db.write() }
const bootstrap = () => ({ ...db.data, typeUsage: Object.fromEntries(db.data.types.map(type => [type,typeUsage(db.data,type)])) })
const namedTemplate = name => {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 200) throw fail('模板名称须为 1–200 个字符')
  return name.trim()
}
const currentRevision = req => {
  if (req.body?.revision !== db.data.revision) throw fail('数据已恢复过，请刷新页面后继续操作',409)
}
app.use('/uploads', express.static(uploadDir, { dotfiles: 'deny', setHeaders: res => { res.setHeader('Cache-Control','no-store'); res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox") } }))
app.use('/uploads', (_req,res) => res.status(404).json({message:'图片不存在'}))
app.get('/api/bootstrap', exclusive((_req,res) => res.json(bootstrap())))
app.put('/api/draft', exclusive(async(req,res) => {
  currentRevision(req)
  validateConfig(req.body.config,db.data.types)
  const templateId = req.body.templateId || null
  if (templateId && !db.data.templates.some(t => t.id === templateId)) throw fail('草稿关联的模板不存在，请另存为')
  // Reject deleted assets, including drafts from an old tab.
  const draft = { config: req.body.config, templateId }
  for (const url of references({devices:[],templates:[],draft}).keys()) if (!fs.existsSync(path.join(uploadDir,url.slice(9)))) throw fail('草稿引用的图片已不存在，请重新选择图片',409)
  db.data.draft = draft; await persist(); res.status(204).end()
}))
app.post('/api/types', exclusive(async(req,res) => {
  const name = typeName(req.body.name)
  if (!db.data.types.includes(name)) { db.data.types.push(name); await persist() }
  res.json({name,types:db.data.types})
}))
app.put('/api/types/order', exclusive(async(req,res) => {
  const types = req.body.types
  if (!Array.isArray(types) || types.length !== db.data.types.length || new Set(types).size !== types.length || types.some(t => !db.data.types.includes(t))) throw fail('排序必须包含全部类型且不能重复')
  db.data.types = types; await persist(); res.json(bootstrap())
}))
app.post('/api/types/manage', exclusive(async(req,res) => {
  const { action, from } = req.body
  if (!db.data.types.includes(from)) throw fail('类型不存在',404)
  if (action === 'delete') {
    if (typeUsage(db.data,from)) throw fail('类型仍被设备、模板或草稿使用，请先合并或移除引用',409)
    db.data.types = db.data.types.filter(t => t !== from)
  } else if (action === 'rename' || action === 'merge') {
    const to = typeName(req.body.to)
    if (from === to) throw fail('请选择不同的名称或目标类型')
    if (action === 'rename' && db.data.types.includes(to)) throw fail('名称已存在，请使用合并')
    if (action === 'merge' && !db.data.types.includes(to)) throw fail('合并目标不存在')
    replaceType(db.data,from,to)
    db.data.types = action === 'rename' ? db.data.types.map(t => t === from ? to : t) : db.data.types.filter(t => t !== from)
  } else throw fail('未知类型操作')
  await persist(); res.json(bootstrap())
}))
const imageUpload = multer({storage:multer.memoryStorage(),limits:{fileSize:12*1024*1024,files:1}}).single('image')
const backupUpload = multer({storage:multer.memoryStorage(),limits:{fileSize:160*1024*1024,files:1}}).single('backup')
const parseUpload = (middleware,req,res) => new Promise((resolve,reject) => middleware(req,res,error => error ? reject(error) : resolve()))
const imageExtension = buffer => {
  if (buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png'
  if (buffer[0]===255 && buffer[1]===216 && buffer[2]===255) return 'jpg'
  if (['GIF87a','GIF89a'].includes(buffer.subarray(0,6).toString())) return 'gif'
  if (buffer.subarray(0,4).toString()==='RIFF' && buffer.subarray(8,12).toString()==='WEBP') return 'webp'
  if (buffer.subarray(4,8).toString()==='ftyp' && ['avif','avis'].includes(buffer.subarray(8,12).toString())) return 'avif'
  throw fail('支持 PNG、JPG、WebP、GIF、AVIF 图片，请转换后上传')
}
app.post('/api/upload', exclusive(async(req,res) => {
  await parseUpload(imageUpload,req,res)
  if (!req.file) throw fail('请选择图片文件')
  const name = `${Date.now()}-${randomBytes(8).toString('hex')}.${imageExtension(req.file.buffer)}`
  fs.writeFileSync(path.join(uploadDir,name),req.file.buffer)
  res.status(201).json({url:`/uploads/${name}`})
}))
app.post('/api/devices', exclusive(async(req,res) => {
  validateDevice(req.body,db.data.types,false)
  const {name,type,detail1='',detail2='',brand='',image=''}=req.body
  const device={id:`device-${randomBytes(12).toString('hex')}`,name:name.trim(),type,detail1,detail2,brand,image}
  db.data.devices.unshift(device); await persist(); res.status(201).json(device)
}))
app.put('/api/devices/:id', exclusive(async(req,res) => {
  const index = db.data.devices.findIndex(d => d.id === req.params.id)
  if (index < 0) throw fail('设备不存在',404)
  const device = {...db.data.devices[index],...req.body,id:req.params.id}
  validateDevice(device,db.data.types)
  db.data.devices[index]=device; await persist(); res.json(device)
}))
app.delete('/api/devices/:id', exclusive(async(req,res) => {
  const index=db.data.devices.findIndex(d=>d.id===req.params.id)
  if(index<0) throw fail('设备不存在',404)
  db.data.devices.splice(index,1); await persist(); res.status(204).end()
}))
app.post('/api/templates', exclusive(async(req,res) => {
  const name=namedTemplate(req.body.name); validateConfig(req.body.config,db.data.types)
  let id
  do { id=`template-${randomBytes(6).toString('hex')}` } while(db.data.templates.some(t=>t.id===id))
  const template={id,name,createdAt:new Date().toISOString(),config:req.body.config}
  db.data.templates.unshift(template); await persist(); res.status(201).json(template)
}))
app.put('/api/templates/:id', exclusive(async(req,res) => {
  const template=db.data.templates.find(t=>t.id===req.params.id)
  if(!template) throw fail('模板不存在',404)
  const name=req.body.name===undefined?template.name:namedTemplate(req.body.name)
  if(req.body.config!==undefined) validateConfig(req.body.config,db.data.types)
  Object.assign(template,{name,config:req.body.config??template.config,updatedAt:new Date().toISOString()})
  await persist(); res.json(template)
}))
app.delete('/api/templates/:id', exclusive(async(req,res) => {
  const index=db.data.templates.findIndex(t=>t.id===req.params.id)
  if(index<0) throw fail('模板不存在',404)
  db.data.templates.splice(index,1)
  if(db.data.draft?.templateId===req.params.id) db.data.draft.templateId=null
  await persist(); res.status(204).end()
}))
app.get('/api/assets', exclusive((_req,res) => {
  const refs=references(db.data)
  res.json(fs.readdirSync(uploadDir).filter(safeFile).filter(name=>fs.lstatSync(path.join(uploadDir,name)).isFile()).map(name=>{
    const stat=fs.statSync(path.join(uploadDir,name));const url=`/uploads/${name}`
    return {name,url,size:stat.size,createdAt:stat.birthtime.toISOString(),references:refs.get(url)||[]}
  }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)))
}))
app.delete('/api/assets/:name', exclusive(async(req,res) => {
  if(!safeFile(req.params.name)) throw fail('文件名无效')
  const url=`/uploads/${req.params.name}`
  if(references(db.data).has(url)) throw fail('图片仍被设备、模板或草稿引用，不能删除',409)
  const file=path.join(uploadDir,req.params.name)
  if(!fs.existsSync(file)) throw fail('图片不存在',404)
  fs.unlinkSync(file);res.status(204).end()
}))
app.get('/api/backup', exclusive((_req,res) => {
  res.attachment(`desk-setup-${new Date().toISOString().slice(0,10)}.deskbackup.gz`).type('application/gzip').send(packBackup(db.data,uploadDir))
}))
app.post('/api/restore/preview', exclusive(async(req,res) => {
  await parseUpload(backupUpload,req,res)
  if(!req.file) throw fail('请选择备份文件')
  const bundle=unpackBackup(req.file.buffer)
  res.json({devices:bundle.data.devices.length,templates:bundle.data.templates.length,types:bundle.data.types.length,assets:bundle.files.length})
}))
app.post('/api/restore', exclusive(async(req,res) => {
  await parseUpload(backupUpload,req,res)
  if(req.body.confirm!=='RESTORE' || !req.file) throw fail('请确认覆盖恢复')
  const recovery=await restoreBackup(unpackBackup(req.file.buffer),db,dataDir,uploadDir)
  res.json({...bootstrap(),recovery})
}))
app.get('/api/backups', exclusive((_req,res) => {
  const dir=path.join(dataDir,'backups')
  res.json(fs.existsSync(dir)?fs.readdirSync(dir).filter(name=>/^before-restore-[\w-]+\.deskbackup\.gz$/.test(name)).sort().reverse().map(name=>({name,size:fs.statSync(path.join(dir,name)).size})):[])
}))
app.get('/api/backups/:name', (req,res) => {
  if(!/^before-restore-[\w-]+\.deskbackup\.gz$/.test(req.params.name)) throw fail('备份名称无效')
  const file=path.join(dataDir,'backups',req.params.name)
  if(!fs.existsSync(file)) throw fail('备份不存在',404)
  res.download(file)
})
app.use('/api',(_req,res)=>res.status(404).json({message:'接口不存在'}))
const distDir=path.join(rootDir,'dist')
if(fs.existsSync(distDir)) {app.use(express.static(distDir));app.get('/{*splat}',(_req,res)=>res.sendFile(path.join(distDir,'index.html')))}
app.use((error,_req,res,_next)=>{
  const status=error.code==='LIMIT_FILE_SIZE'?413:error.status||500
  if(status>=500) console.error(error)
  res.status(status).json({message:error.code==='LIMIT_FILE_SIZE'?'文件超过允许的大小':status>=500?'服务暂时不可用，请稍后重试':error.message})
})
app.listen(port,'0.0.0.0',()=>console.log(`Desk setup generator is running on http://localhost:${port}`))
