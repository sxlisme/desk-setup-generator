import fs from 'node:fs'
import path from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { randomBytes } from 'node:crypto'

export const fail = (message, status = 400) => Object.assign(new Error(message), { status })
export const safeFile = name => typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|jpe?g|webp|gif|avif|svg|bmp|ico)$/i.test(name) && !name.includes('..')
export const typeName = name => {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 16 || name.trim() === '全部') throw fail('类型名称须为 1–16 个字符，且不能使用“全部”')
  return name.trim()
}
export function imageUrl(url) {
  if (typeof url !== 'string' || (url !== '' && url !== '/default-setup.png' && !(url.startsWith('/uploads/') && safeFile(url.slice(9))))) throw fail('图片地址无效，请上传本地图片')
  return url
}
export function validateDevice(device, types, requireId = true) {
  if (!device || typeof device !== 'object' || typeof device.name !== 'string' || !device.name.trim() || device.name.length > 200 || !types.includes(device.type)) throw fail('设备名称或类型无效')
  if (requireId && (typeof device.id !== 'string' || !device.id || device.id.length > 200)) throw fail('设备编号无效')
  for (const field of ['detail1', 'detail2', 'brand']) if (device[field] !== undefined && (typeof device[field] !== 'string' || device[field].length > 2000)) throw fail('设备描述无效或过长')
  imageUrl(device.image || '')
}
export function validateConfig(config, types) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || !Array.isArray(config.devices) || config.devices.length > 200) throw fail('模板或草稿内容无效')
  if (Object.keys(config).some(key => ['__proto__','constructor','prototype'].includes(key))) throw fail('模板配置包含无效字段')
  imageUrl(config.heroImage || '')
  for (const device of config.devices) validateDevice(device, types)
  for (const key of ['title','subtitle','eyebrow','listTitle','listSubtitle','account','footerNote','accent']) if (config[key] !== undefined && (typeof config[key] !== 'string' || config[key].length > 2000)) throw fail('模板文字无效或过长')
  for (const key of ['imagePosition','imagePositionY','overlay','titleSize','subtitleSize','heroTextX','heroTextY']) if (config[key] !== undefined && (!Number.isFinite(config[key]) || Math.abs(config[key]) > 1000)) throw fail('模板布局参数无效')
  if (config.imagePositionY !== undefined && (config.imagePositionY < 0 || config.imagePositionY > 100)) throw fail('照片垂直位置须在 0–100 之间')
  if (config.layout !== undefined && !['single','double'].includes(config.layout)) throw fail('模板布局无效')
}
export function validateData(data) {
  if (!data || !Array.isArray(data.types) || !Array.isArray(data.devices) || !Array.isArray(data.templates)) throw fail('备份数据结构无效')
  if (data.types.length > 1000 || data.devices.length > 10000 || data.templates.length > 10000) throw fail('备份条目过多')
  data.types.forEach(type => { if (typeName(type) !== type) throw fail('备份类型名称包含多余空格') })
  if (new Set(data.types).size !== data.types.length) throw fail('备份中存在重复类型')
  for (const device of data.devices) validateDevice(device, data.types)
  for (const template of data.templates) {
    if (typeof template.id !== 'string' || !template.id || typeof template.name !== 'string' || !template.name.trim() || template.name.length > 200 || !Number.isFinite(Date.parse(template.createdAt))) throw fail('模板信息无效')
    validateConfig(template.config, data.types)
  }
  for (const list of [data.devices, data.templates]) if (new Set(list.map(x => x.id)).size !== list.length) throw fail('备份中存在重复编号')
  if (data.draft) {
    validateConfig(data.draft.config, data.types)
    if (data.draft.templateId !== null && typeof data.draft.templateId !== 'string') throw fail('草稿模板编号无效')
  }
}
export function references(data) {
  const refs = new Map()
  const add = (url, label) => { if (url?.startsWith('/uploads/')) refs.set(url, [...(refs.get(url) || []), label]) }
  for (const device of data.devices) add(device.image, `设备：${device.name}`)
  for (const template of data.templates) {
    add(template.config.heroImage, `模板主图：${template.name} (${template.id})`)
    template.config.devices.forEach(d => add(d.image, `模板设备：${template.name} / ${d.name}`))
  }
  if (data.draft) {
    add(data.draft.config.heroImage, '当前草稿主图')
    data.draft.config.devices.forEach(d => add(d.image, `当前草稿：${d.name}`))
  }
  return refs
}
export function typeUsage(data, type) {
  return data.devices.filter(d => d.type === type).length + data.templates.reduce((n,t) => n + t.config.devices.filter(d => d.type === type).length, 0) + (data.draft?.config.devices.filter(d => d.type === type).length || 0)
}
export function replaceType(data, from, to) {
  const replace = list => list.forEach(d => { if (d.type === from) d.type = to })
  replace(data.devices)
  data.templates.forEach(t => replace(t.config.devices))
  if (data.draft) replace(data.draft.config.devices)
}
export function packBackup(data, uploadDir) {
  const files = fs.readdirSync(uploadDir).filter(safeFile).filter(name => fs.lstatSync(path.join(uploadDir,name)).isFile())
  const total = files.reduce((n,name) => n + fs.statSync(path.join(uploadDir,name)).size, 0)
  if (total > 150 * 1024 * 1024) throw fail('图片总量超过 150 MB，请先清理未使用图片再备份', 413)
  return gzipSync(Buffer.from(JSON.stringify({ format: 'desk-setup-backup', version: 1, createdAt: new Date().toISOString(), data, assets: files.map(name => ({ name, content: fs.readFileSync(path.join(uploadDir,name)).toString('base64') })) })))
}
export function unpackBackup(buffer) {
  let bundle
  try { bundle = JSON.parse(gunzipSync(buffer, { maxOutputLength: 230 * 1024 * 1024 }).toString('utf8')) } catch { throw fail('无法读取备份，请选择有效的 .deskbackup.gz 文件') }
  if (bundle.format !== 'desk-setup-backup' || bundle.version !== 1 || !Array.isArray(bundle.assets) || bundle.assets.length > 10000) throw fail('不支持的备份格式')
  validateData(bundle.data)
  const names = new Set(); let total = 0
  const files = bundle.assets.map(asset => {
    if (!safeFile(asset.name) || names.has(asset.name) || typeof asset.content !== 'string' || asset.content.length > 16 * 1024 * 1024) throw fail('备份图片名称或内容无效')
    names.add(asset.name)
    const content = Buffer.from(asset.content, 'base64'); total += content.length
    if (content.toString('base64') !== asset.content) throw fail('备份图片编码无效')
    if (total > 150 * 1024 * 1024 || content.length > 12 * 1024 * 1024) throw fail('备份图片超出大小限制', 413)
    return { name: asset.name, content }
  })
  for (const url of references(bundle.data).keys()) if (!names.has(url.slice(9))) throw fail(`备份缺少图片：${url.slice(9)}`)
  return { data: bundle.data, files }
}
export async function restoreBackup(bundle, db, dataDir, uploadDir) {
  const backupDir = path.join(dataDir, 'backups'); fs.mkdirSync(backupDir, { recursive: true })
  const recovery = `before-restore-${Date.now()}-${randomBytes(3).toString('hex')}.deskbackup.gz`
  fs.writeFileSync(path.join(backupDir,recovery), packBackup(db.data, uploadDir), { mode: 0o600 })
  const staging = fs.mkdtempSync(path.join(dataDir,'.restore-'))
  const oldUploads = `${staging}-old`
  const oldData = db.data
  let moved = false
  try {
    for (const file of bundle.files) fs.writeFileSync(path.join(staging,file.name),file.content)
    fs.renameSync(uploadDir,oldUploads); moved = true
    fs.renameSync(staging,uploadDir)
    db.data = { types: bundle.data.types, devices: bundle.data.devices, templates: bundle.data.templates, draft: bundle.data.draft || null, revision: randomBytes(12).toString('hex') }
    await db.write()
  } catch (error) {
    db.data = oldData
    if (moved) { fs.rmSync(uploadDir,{recursive:true,force:true}); fs.renameSync(oldUploads,uploadDir) }
    await db.write()
    throw error
  } finally { fs.rmSync(staging,{recursive:true,force:true}) }
  fs.rmSync(oldUploads,{recursive:true,force:true})
  return recovery
}
