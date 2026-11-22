<script setup>
import AdminPanel from './AdminPanel.vue'
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'

const authenticated = ref(false)
const authChecking = ref(true)
const loginName = ref('admin')
const loginPassword = ref('')
const loginError = ref('')
const csrfToken = ref('')
const managementData = ref(null)
const showManagement = ref(false)
const activeTemplateId = ref(null)
const templateSearch = ref('')
const draftStatus = ref('草稿自动保存')
let revision = ''
let hydrating = false
let draftTimer
let draftQueue = Promise.resolve()
const deviceTypes = ref([])
const typeName = ref('')
const creatingType = ref(false)
const deviceLibrary = ref([])
const templates = ref([])
const activePanel = ref('content')
const mobileTab = ref('preview')
const showExport = ref(false)
const exportUrl = ref('')
const exportFilename = ref('')
const canShareExport = ref(false)
const sharingExport = ref(false)
let exportFile = null
const search = ref('')
const typeFilter = ref('全部')
const showDeviceModal = ref(false)
const editingDeviceId = ref(null)
const showTemplateModal = ref(false)
const showTemplateList = ref(false)
const busy = ref(false)
const toast = ref('')
const dragIndex = ref(null)
const imageInput = ref(null)
let deviceDialogVersion = 0

const defaultConfig = () => ({
  title: '我的桌搭清单',
  subtitle: '银白极简 · 高效舒适 · 氛围感桌面',
  eyebrow: 'DESK SETUP / PERSONAL COLLECTION',
  listTitle: '桌搭清单',
  listSubtitle: 'MY DESK SETUP',
  account: '@你的账号名称',
  footerNote: 'DESK SETUP NOTES · 设备清单持续更新',
  heroImage: '/default-setup.png',
  imagePosition: 50,
  imagePositionY: 50,
  overlay: 18,
  titleSize: 100,
  subtitleSize: 100,
  heroTextX: 0,
  heroTextY: 7.5,
  accent: '#7893a3',
  layout: 'double',
  devices: []
})

const config = reactive(defaultConfig())
const newDevice = reactive({
  name: '', type: '显示器', detail1: '', detail2: '', brand: '', image: ''
})
const templateName = ref('')
const activeTemplate = computed(() => templates.value.find(t => t.id === activeTemplateId.value))
const filteredTemplates = computed(() => {
  const query = templateSearch.value.trim().toLowerCase()
  return templates.value.filter(t => `${t.name} ${t.id}`.toLowerCase().includes(query))
})

const filteredDevices = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return deviceLibrary.value.filter((device) => {
    const matchesType = typeFilter.value === '全部' || device.type === typeFilter.value
    const matchesSearch = !keyword || `${device.name} ${device.type} ${device.brand}`.toLowerCase().includes(keyword)
    return matchesType && matchesSearch
  })
})

const selectedIds = computed(() => new Set(config.devices.map((item) => item.instanceId || item.id)))
const isEditingDevice = computed(() => Boolean(editingDeviceId.value))

function notify(message) {
  toast.value = message
  window.clearTimeout(notify.timer)
  notify.timer = window.setTimeout(() => (toast.value = ''), 2400)
}

async function api(url, options = {}) {
  const { responseType, ...requestOptions } = options
  const response = await fetch(url, {
    ...requestOptions,
    credentials: 'same-origin',
    headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), 'X-Requested-With': 'desk-setup', ...(revision ? { 'X-Data-Revision': revision } : {}), ...(csrfToken.value ? { 'X-CSRF-Token': csrfToken.value } : {}), ...options.headers }
  })
  if (!response.ok) {
    if (response.status === 401) { authenticated.value = false; showManagement.value = false; csrfToken.value = '' }
    const body = await response.json().catch(() => ({}))
    throw new Error(body.message || '请求失败')
  }
  if (responseType === 'blob') return response.blob()
  return response.status === 204 ? null : response.json()
}

async function applyBootstrap(data, useDraft = false) {
  hydrating = true
  deviceTypes.value = data.types
  deviceLibrary.value = data.devices
  templates.value = data.templates
  revision = data.revision
  managementData.value = data
  if (useDraft) {
    Object.assign(config, defaultConfig(), data.draft?.config || {})
    activeTemplateId.value = data.draft?.templateId || null
    if (!activeTemplate.value) activeTemplateId.value = null
  }
  if (!deviceTypes.value.includes(newDevice.type)) newDevice.type = deviceTypes.value[0] || ''
  if (!deviceTypes.value.includes(typeFilter.value)) typeFilter.value = '全部'
  await nextTick()
  hydrating = false
}

async function initializeData() {
  const data = await api('/api/bootstrap')
  await applyBootstrap(data, true)
  // Import pre-login browser drafts only into an installation that has no server draft.
  if (!data.draft) {
    let saved
    try { saved = JSON.parse(localStorage.getItem('desk-setup-draft') || 'null') } catch { /* ignore damaged browser drafts */ }
    hydrating = true
    if (saved && !saved.revision) Object.assign(config, defaultConfig(), saved)
    else config.devices = data.devices.slice(0, 8).map(item => ({ ...item, instanceId: `${item.id}-${Math.random()}` }))
    await nextTick(); hydrating = false
  }
  await flushDraft()
}

async function login() {
  if (busy.value) return
  busy.value = true; loginError.value = ''
  try {
    const session = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: loginName.value, password: loginPassword.value }) })
    csrfToken.value = session.csrfToken; authenticated.value = true; loginPassword.value = ''
    await initializeData()
  } catch (error) { loginError.value = error.message; if (authenticated.value) notify(error.message) }
  finally { busy.value = false }
}

async function logout() {
  if (busy.value) return
  busy.value = true
  try {
    await flushDraft(); await api('/api/auth/logout', { method: 'POST' })
    authenticated.value = false; csrfToken.value = ''; showManagement.value = false
    showTemplateList.value = false; showTemplateModal.value = false; showExport.value = false; closeDeviceModal()
    if (exportUrl.value) URL.revokeObjectURL(exportUrl.value)
    exportUrl.value = ''; exportFile = null
  } catch (error) { notify(error.message) } finally { busy.value = false }
}

async function flushDraft() {
  clearTimeout(draftTimer)
  if (!authenticated.value || hydrating) return
  const payload = { config: snapshot(), templateId: activeTemplateId.value, revision }
  draftStatus.value = '正在保存草稿…'
  const request = draftQueue.catch(() => {}).then(() => api('/api/draft', { method: 'PUT', body: JSON.stringify(payload) }))
  draftQueue = request
  try {
    await request
    localStorage.setItem('desk-setup-draft', JSON.stringify(payload))
    draftStatus.value = '草稿已保存'
  } catch (error) { draftStatus.value = `草稿未保存：${error.message}`; throw error }
}

async function openManagement() {
  try { await flushDraft(); managementData.value = await api('/api/bootstrap'); showManagement.value = true }
  catch(error) { notify(error.message) }
}
async function managementChanged(data) {
  clearTimeout(draftTimer)
  await applyBootstrap(data, true)
  localStorage.setItem('desk-setup-draft', JSON.stringify({ config: snapshot(), templateId: activeTemplateId.value, revision }))
  draftStatus.value = '草稿已保存'
}

async function addDeviceType(selectForDevice = false) {
  if (creatingType.value) return
  const name = typeName.value.trim()
  if (!name || name.length > 16 || name === '全部') {
    return notify('请输入 1–16 个字符的类型名称，不能使用“全部”')
  }
  const dialogVersion = deviceDialogVersion
  creatingType.value = true
  try {
    const result = await api('/api/types', { method: 'POST', body: JSON.stringify({ name }) })
    deviceTypes.value = result.types
    if (selectForDevice && showDeviceModal.value && dialogVersion === deviceDialogVersion) {
      newDevice.type = result.name
    }
    if (typeName.value.trim() === name) typeName.value = ''
    notify(`类型「${result.name}」已可用`)
  } catch (error) {
    notify(error.message)
  } finally {
    creatingType.value = false
  }
}

async function uploadImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件')
  if (file.size > 12 * 1024 * 1024) throw new Error('图片不能超过 12 MB')
  const data = new FormData()
  data.append('image', file)
  return (await api('/api/upload', { method: 'POST', body: data })).url
}

async function updateImage(file, target) {
  if (busy.value) return notify('正在处理，请稍后再上传图片')
  const dialogVersion = deviceDialogVersion
  busy.value = true
  try {
    const url = await uploadImage(file)
    if (target === 'device') {
      // A closed or reopened dialog must not receive an earlier upload.
      if (!showDeviceModal.value || dialogVersion !== deviceDialogVersion) return
      newDevice.image = url
      notify('设备图片已更新，保存后生效')
    } else {
      config.heroImage = url
      notify('主照片已更新')
    }
  } catch (error) {
    notify(error.message)
  } finally {
    busy.value = false
  }
}

async function onImageUpload(event, target) {
  const file = event.target.files?.[0]
  if (!file) return
  await updateImage(file, target)
  event.target.value = ''
}

function onImagePaste(event) {
  const target = showDeviceModal.value
    ? 'device'
    : !showTemplateModal.value && !showTemplateList.value && event.target?.closest?.('.hero-upload')
      ? 'hero'
      : null
  if (!target || event.defaultPrevented) return
  const items = Array.from(event.clipboardData?.items || [])
  const file = items.find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
    || Array.from(event.clipboardData?.files || []).find(file => file.type.startsWith('image/'))
  if (!file) return
  event.preventDefault()
  return updateImage(file, target)
}

function addDevice(device) {
  config.devices.push({ ...device, instanceId: `${device.id}-${Date.now()}-${Math.random()}` })
  notify(`已添加「${device.name}」`)
}

function removeDevice(index) {
  config.devices.splice(index, 1)
}

function onDragStart(index) {
  dragIndex.value = index
}

function onDrop(index) {
  if (dragIndex.value === null || dragIndex.value === index) return
  const [item] = config.devices.splice(dragIndex.value, 1)
  config.devices.splice(index, 0, item)
  dragIndex.value = null
}

function resetNewDevice() {
  Object.assign(newDevice, { name: '', type: deviceTypes.value[0] || '显示器', detail1: '', detail2: '', brand: '', image: '' })
}

function openCreateDevice() {
  deviceDialogVersion += 1
  editingDeviceId.value = null
  resetNewDevice()
  showDeviceModal.value = true
}

function openEditDevice(device) {
  deviceDialogVersion += 1
  editingDeviceId.value = device.id
  Object.assign(newDevice, {
    name: device.name || '',
    type: device.type || deviceTypes.value[0] || '显示器',
    detail1: device.detail1 || '',
    detail2: device.detail2 || '',
    brand: device.brand || '',
    image: device.image || ''
  })
  showDeviceModal.value = true
}

function closeDeviceModal() {
  deviceDialogVersion += 1
  showDeviceModal.value = false
  editingDeviceId.value = null
  resetNewDevice()
}

async function saveDevice() {
  if (busy.value || creatingType.value) return
  if (!newDevice.name.trim()) return notify('请填写设备名称')
  busy.value = true
  try {
    if (editingDeviceId.value) {
      const updated = await api(`/api/devices/${editingDeviceId.value}`, {
        method: 'PUT',
        body: JSON.stringify(newDevice)
      })
      const libraryIndex = deviceLibrary.value.findIndex((item) => item.id === updated.id)
      if (libraryIndex >= 0) deviceLibrary.value.splice(libraryIndex, 1, updated)
      config.devices = config.devices.map((item) => (
        item.id === updated.id ? { ...updated, instanceId: item.instanceId } : item
      ))
      closeDeviceModal()
      notify('设备信息已更新')
    } else {
      const created = await api('/api/devices', { method: 'POST', body: JSON.stringify(newDevice) })
      deviceLibrary.value.unshift(created)
      addDevice(created)
      closeDeviceModal()
      notify('设备已保存并加入预览')
    }
  } catch (error) {
    notify(error.message)
  } finally {
    busy.value = false
  }
}

function snapshot() {
  return JSON.parse(JSON.stringify(config))
}

function templateCode(template) {
  return template.id.replace(/^template-/, '')
}

async function saveTemplate() {
  if (busy.value) return
  if (!templateName.value.trim()) return notify('请填写模板名称')
  busy.value = true
  try {
    const template = await api('/api/templates', {
      method: 'POST',
      body: JSON.stringify({ name: templateName.value, config: snapshot() })
    })
    templates.value.unshift(template)
    activeTemplateId.value = template.id
    await flushDraft()
    showTemplateModal.value = false
    templateName.value = ''
    notify(`模板已保存 · 编号 ${templateCode(template)}`)
  } catch (error) {
    notify(error.message)
  } finally {
    busy.value = false
  }
}

function openSaveAs() {
  templateName.value = activeTemplate.value ? `${activeTemplate.value.name} 副本` : config.title
  showTemplateModal.value = true
}
async function updateTemplate() {
  if (busy.value || !activeTemplate.value) return
  busy.value = true
  try {
    const updated = await api(`/api/templates/${activeTemplateId.value}`, { method:'PUT', body:JSON.stringify({config:snapshot()}) })
    templates.value.splice(templates.value.findIndex(t=>t.id===updated.id),1,updated)
    await flushDraft(); notify('当前模板修改已保存')
  } catch(error) { notify(error.message) } finally { busy.value=false }
}
async function renameTemplate(template) {
  const name = window.prompt('请输入新的模板名称',template.name)
  if (name === null || name.trim() === template.name) return
  try {
    const updated=await api(`/api/templates/${template.id}`,{method:'PUT',body:JSON.stringify({name})})
    templates.value.splice(templates.value.findIndex(t=>t.id===updated.id),1,updated)
    notify('模板已重命名')
  } catch(error) { notify(error.message) }
}
function loadTemplate(template) {
  Object.assign(config, defaultConfig(), JSON.parse(JSON.stringify(template.config)))
  activeTemplateId.value = template.id
  showTemplateList.value = false
  notify(`已载入「${template.name}」 · 编号 ${templateCode(template)}`)
}
async function deleteTemplate(template) {
  if (!window.confirm(`删除模板“${template.name}”（编号 ${templateCode(template)}）？`)) return
  try {
    clearTimeout(draftTimer); await draftQueue.catch(()=>{})
    await api(`/api/templates/${template.id}`, { method: 'DELETE' })
    templates.value = templates.value.filter(item=>item.id!==template.id)
    if (activeTemplateId.value === template.id) activeTemplateId.value = null
    await flushDraft(); notify('模板已删除')
  } catch(error) { notify(error.message) }
}

function clearCanvas() {
  activeTemplateId.value = null
  Object.assign(config, defaultConfig())
  notify('已恢复默认内容')
}

function resetHeroTextLayout() {
  Object.assign(config, {
    titleSize: 100,
    subtitleSize: 100,
    heroTextX: 0,
    heroTextY: 7.5
  })
  notify('标题字号与位置已恢复')
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, r)
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
}

function drawCover(ctx, image, x, y, width, height, position = 50, positionY = 50) {
  const scale = Math.max(width / image.width, height / image.height)
  const drawWidth = image.width * scale
  const drawHeight = image.height * scale
  const offsetX = x + (width - drawWidth) * (position / 100)
  const offsetY = y + (height - drawHeight) * (positionY / 100)
  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight)
}

function drawContain(ctx, image, x, y, width, height) {
  const scale = Math.min(width / image.width, height / image.height)
  const drawWidth = image.width * scale
  const drawHeight = image.height * scale
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight)
}

function fitText(ctx, text, maxWidth, startSize, weight = 700) {
  let size = startSize
  do {
    ctx.font = `${weight} ${size}px "Microsoft YaHei", sans-serif`
    size -= 2
  } while (ctx.measureText(text).width > maxWidth && size > 24)
}

async function exportPng() {
  if (busy.value) return
  busy.value = true
  notify('正在生成 4K 图片…')
  await nextTick()
  try {
    const width = 3072
    const height = 4096
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    ctx.fillStyle = '#edf2f4'
    ctx.fillRect(0, 0, width, height)

    const heroHeight = 1780
    const hero = await loadImage(config.heroImage)
    ctx.save()
    roundedRect(ctx, 0, 0, width, heroHeight + 50, 0)
    ctx.clip()
    drawCover(ctx, hero, 0, 0, width, heroHeight + 50, config.imagePosition, config.imagePositionY)
    ctx.fillStyle = `rgba(16, 29, 37, ${config.overlay / 100})`
    ctx.fillRect(0, 0, width, heroHeight + 50)
    ctx.restore()

    ctx.textAlign = 'center'
    ctx.fillStyle = '#ffffff'
    ctx.shadowColor = 'rgba(0,0,0,.28)'
    ctx.shadowBlur = 18
    const copyX = width / 2 + width * (config.heroTextX / 100)
    const copyOffsetY = heroHeight * ((config.heroTextY - 7.5) / 100)
    ctx.font = '700 30px Arial, sans-serif'
    ctx.fillText(config.eyebrow, copyX, 180 + copyOffsetY)
    fitText(ctx, config.title, 2660, 204 * (config.titleSize / 100), 700)
    ctx.fillText(config.title, copyX, 340 + copyOffsetY)
    ctx.shadowBlur = 8
    fitText(ctx, config.subtitle, 2500, 58 * (config.subtitleSize / 100), 500)
    ctx.fillText(config.subtitle, copyX, 455 + copyOffsetY)
    ctx.shadowBlur = 0

    const sectionY = 1780
    ctx.fillStyle = 'rgba(244,247,248,.96)'
    ctx.fillRect(0, sectionY, width, height - sectionY)
    const sectionTransition = ctx.createLinearGradient(0, sectionY - 230, 0, sectionY)
    sectionTransition.addColorStop(0, 'rgba(244, 247, 248, 0)')
    sectionTransition.addColorStop(0.45, 'rgba(244, 247, 248, 0.12)')
    sectionTransition.addColorStop(1, 'rgba(244, 247, 248, 0.98)')
    ctx.fillStyle = sectionTransition
    ctx.fillRect(0, sectionY - 230, width, 230)
    ctx.fillStyle = '#253641'
    ctx.textAlign = 'left'
    ctx.font = '800 80px "Microsoft YaHei", sans-serif'
    ctx.fillText(config.listTitle, 132, sectionY + 160)
    ctx.fillStyle = config.accent
    ctx.font = '700 32px Arial, sans-serif'
    ctx.fillText(config.listSubtitle, 640, sectionY + 155)
    ctx.textAlign = 'right'
    ctx.font = '500 34px "Microsoft YaHei", sans-serif'
    ctx.fillText('桌面装备与使用体验分享', width - 132, sectionY + 150)
    ctx.fillStyle = '#bbcad1'
    ctx.fillRect(132, sectionY + 205, width - 264, 4)

    const columns = config.layout === 'single' ? 1 : 2
    const gap = 34
    const cardWidth = columns === 2 ? (width - 264 - gap) / 2 : width - 264
    const rows = Math.ceil(Math.min(config.devices.length, columns === 2 ? 10 : 6) / columns)
    const available = height - sectionY - 455
    const cardHeight = Math.min(330, (available - Math.max(0, rows - 1) * 28) / Math.max(rows, 1))
    const top = sectionY + 260

    for (let i = 0; i < config.devices.length && i < (columns === 2 ? 10 : 6); i += 1) {
      const device = config.devices[i]
      const col = i % columns
      const row = Math.floor(i / columns)
      const x = 132 + col * (cardWidth + gap)
      const y = top + row * (cardHeight + 28)

      ctx.shadowColor = 'rgba(69, 91, 102, .14)'
      ctx.shadowBlur = 18
      ctx.shadowOffsetY = 10
      ctx.fillStyle = 'rgba(255,255,255,.92)'
      roundedRect(ctx, x, y, cardWidth, cardHeight, 32)
      ctx.fill()
      ctx.shadowColor = 'transparent'

      const imageHeight = cardHeight - 42
      const imageWidth = imageHeight * 4 / 3
      const imageX = x + 22
      const imageY = y + 21
      ctx.fillStyle = '#e8eef0'
      roundedRect(ctx, imageX, imageY, imageWidth, imageHeight, 22)
      ctx.fill()
      if (device.image) {
        try {
          const itemImage = await loadImage(device.image)
          ctx.save()
          roundedRect(ctx, imageX, imageY, imageWidth, imageHeight, 22)
          ctx.clip()
          drawContain(ctx, itemImage, imageX, imageY, imageWidth, imageHeight * 0.76)
          ctx.restore()
        } catch { /* keep placeholder */ }
      } else {
        ctx.fillStyle = config.accent
        ctx.textAlign = 'center'
        ctx.font = '800 70px "Microsoft YaHei", sans-serif'
        ctx.fillText(device.type.slice(0, 1), imageX + imageWidth / 2, imageY + imageHeight / 2 + 24)
      }

      ctx.fillStyle = config.accent
      roundedRect(ctx, imageX + 20, imageY + imageHeight - 54, imageWidth - 40, 42, 21)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'center'
      ctx.font = '700 24px "Microsoft YaHei", sans-serif'
      ctx.fillText(device.type, imageX + imageWidth / 2, imageY + imageHeight - 24)

      const textX = imageX + imageWidth + 42
      const textWidth = cardWidth - imageWidth - 92
      ctx.textAlign = 'left'
      ctx.fillStyle = '#172731'
      fitText(ctx, device.name, textWidth, 47, 800)
      ctx.fillText(device.name, textX, y + 85, textWidth)
      ctx.fillStyle = '#536873'
      ctx.font = '500 31px "Microsoft YaHei", sans-serif'
      ctx.fillText(device.detail1 || '设备信息待补充', textX, y + 142, textWidth)
      ctx.fillText(device.detail2 || '使用体验待补充', textX, y + 192, textWidth)
      if (device.brand) {
        ctx.fillStyle = '#8aa0aa'
        ctx.font = '500 25px "Microsoft YaHei", sans-serif'
        ctx.fillText(device.brand, textX, y + cardHeight - 34, textWidth)
      }
    }

    ctx.fillStyle = '#bdcbd1'
    ctx.fillRect(132, height - 160, width - 264, 3)
    ctx.fillStyle = '#6f8792'
    ctx.textAlign = 'left'
    ctx.font = '700 28px Arial, sans-serif'
    ctx.fillText(config.footerNote, 132, height - 92)
    ctx.textAlign = 'right'
    ctx.font = '500 30px "Microsoft YaHei", sans-serif'
    ctx.fillText(config.account, width - 132, height - 92)

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('图片生成失败，请重试')), 'image/png')
    })
    if (exportUrl.value) URL.revokeObjectURL(exportUrl.value)
    exportFilename.value = `${config.title || '桌搭清单'}-4K.png`
    exportUrl.value = URL.createObjectURL(blob)
    exportFile = new File([blob], exportFilename.value, { type: 'image/png' })
    try {
      canShareExport.value = Boolean(window.isSecureContext && navigator.share && navigator.canShare?.({ files: [exportFile] }))
    } catch { canShareExport.value = false }
    showExport.value = true
    // Mobile browsers need a fresh user gesture after asynchronous image generation.
    // Keep the actual image visible even if a browser ignores a download request.
    if (!window.matchMedia('(max-width: 1100px), (pointer: coarse)').matches) downloadExport()
    notify('图片已生成，请在预览中保存')

  } catch (error) {
    console.error(error)
    notify('导出失败，请检查图片后重试')
  } finally {
    busy.value = false
  }
}

function downloadExport() {
  if (!exportUrl.value) return
  const link = document.createElement('a')
  link.href = exportUrl.value
  link.download = exportFilename.value
  document.body.appendChild(link)
  link.click()
  link.remove()
  notify('已请求下载；也可长按图片保存')
}

async function shareExport() {
  if (!exportFile || sharingExport.value) return
  sharingExport.value = true
  try { await navigator.share({ files: [exportFile], title: config.title || '桌搭清单' }) }
  catch (error) { if (error.name !== 'AbortError') notify('暂时无法分享，请长按图片保存或点击下载') }
  finally { sharingExport.value = false }
}

watch([config, activeTemplateId], () => {
  if (!authenticated.value || hydrating) return
  clearTimeout(draftTimer)
  draftStatus.value = '草稿待保存'
  draftTimer = setTimeout(() => flushDraft().catch(() => {}), 500)
}, { deep: true })

onUnmounted(() => { document.removeEventListener('paste', onImagePaste); clearTimeout(draftTimer); if (exportUrl.value) URL.revokeObjectURL(exportUrl.value) })
onMounted(async () => {
  document.addEventListener('paste', onImagePaste)
  try {
    const session = await api('/api/auth/session')
    csrfToken.value = session.csrfToken || ''
    authenticated.value = session.authenticated
    if (authenticated.value) await initializeData()
  } catch(error) { loginError.value = error.message; notify(error.message) }
  finally { authChecking.value = false }
})
</script>

<template>
  <main v-if="authChecking || !authenticated" class="login-page">
    <form class="login-card" @submit.prevent="login">
      <div class="brand-mark">D</div><h1>桌搭清单工作台</h1><p>登录后管理你的设备、模板和图片</p>
      <p v-if="authChecking">正在检查登录状态…</p>
      <template v-else>
        <label class="field"><span>账号</span><input v-model="loginName" autocomplete="username" required /></label>
        <label class="field"><span>密码</span><input v-model="loginPassword" type="password" autocomplete="current-password" required /></label>
        <p v-if="loginError" class="notice error" role="alert">{{ loginError }}</p>
        <button class="btn primary" :disabled="busy">{{ busy ? '正在登录…' : '登录' }}</button>
      </template>
    </form>
  </main>
  <div v-else class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">D</div>
        <div>
          <strong>桌搭清单生成器</strong>
          <span>DESK SETUP STUDIO</span>
        </div>
      </div>
      <div class="top-actions">
        <button class="btn ghost" @click="showTemplateList = true">
          <span class="icon">▣</span> 模板库
          <span v-if="templates.length" class="count">{{ templates.length }}</span>
        </button>
        <button class="btn ghost" :disabled="busy || !activeTemplate" @click="updateTemplate">保存修改</button>
        <button class="btn ghost" :disabled="busy" @click="openSaveAs">另存为</button>
        <button class="btn ghost" :disabled="busy" @click="openManagement">数据管理</button>
        <button class="btn ghost" :disabled="busy" @click="logout">退出</button>
        <button class="btn primary" :disabled="busy" @click="exportPng"><span class="icon">↓</span><span class="desktop-export-label">导出 4K PNG</span><span class="mobile-export-label">导出图片</span></button>
      </div>
    </header>

    <main class="workspace" :class="`mobile-${mobileTab}`">
      <aside class="sidebar settings-panel">
        <nav class="panel-tabs">
          <button :class="{ active: activePanel === 'content' }" @click="activePanel = 'content'">内容</button>
          <button :class="{ active: activePanel === 'style' }" @click="activePanel = 'style'">样式</button>
        </nav>

        <div v-if="activePanel === 'content'" class="panel-scroll">
          <section class="control-section">
            <div class="section-heading"><span>主图</span><small>上半区域</small></div>
            <button class="hero-upload" title="点击选择图片，或聚焦此处后按 ⌘V / Ctrl+V 粘贴图片" @click="imageInput?.click()">
              <img :src="config.heroImage" alt="当前桌搭主图" />
              <span><b>更换照片</b><small>支持粘贴图片 · 不超过 12MB</small></span>
            </button>
            <input ref="imageInput" hidden type="file" accept="image/*" @change="onImageUpload($event, 'hero')" />
            <label class="range-label"><span>照片水平位置</span><b>{{ config.imagePosition }}%</b></label>
            <input v-model.number="config.imagePosition" aria-label="照片水平位置" type="range" min="0" max="100" />
            <label class="range-label"><span>照片垂直位置</span><b>{{ config.imagePositionY }}%</b></label>
            <input v-model.number="config.imagePositionY" aria-label="照片垂直位置" type="range" min="0" max="100" />
            <p class="image-position-hint">调整照片裁切位置；该方向没有超出边框时，拖动不会改变画面。</p>
          </section>

          <section class="control-section">
            <div class="section-heading"><span>标题信息</span><button class="mini-reset" type="button" @click="resetHeroTextLayout">恢复字号与位置</button></div>
            <label class="field"><span>主标题</span><input v-model="config.title" maxlength="18" /></label>
            <label class="field"><span>副标题</span><input v-model="config.subtitle" maxlength="30" /></label>
            <label class="field"><span>清单标题</span><input v-model="config.listTitle" maxlength="10" /></label>
            <label class="field"><span>顶部英文</span><input v-model="config.eyebrow" maxlength="40" /></label>
            <div class="title-layout-controls">
              <label class="range-label"><span>主标题字号</span><b>{{ config.titleSize }}%</b></label>
              <input v-model.number="config.titleSize" type="range" min="60" max="150" step="5" />
              <label class="range-label"><span>副标题字号</span><b>{{ config.subtitleSize }}%</b></label>
              <input v-model.number="config.subtitleSize" type="range" min="60" max="150" step="5" />
              <label class="range-label"><span>标题组水平偏移</span><b>{{ config.heroTextX }}%</b></label>
              <input v-model.number="config.heroTextX" type="range" min="-25" max="25" step="1" />
              <label class="range-label"><span>标题组距顶部</span><b>{{ config.heroTextY }}%</b></label>
              <input v-model.number="config.heroTextY" type="range" min="3" max="45" step="0.5" />
            </div>
          </section>

          <section class="control-section">
            <div class="section-heading"><span>页脚信息</span></div>
            <label class="field"><span>账号名称</span><input v-model="config.account" maxlength="24" /></label>
            <label class="field"><span>左侧说明</span><input v-model="config.footerNote" maxlength="38" /></label>
          </section>
        </div>

        <div v-else class="panel-scroll">
          <section class="control-section">
            <div class="section-heading"><span>清单布局</span></div>
            <div class="segmented">
              <button :class="{ active: config.layout === 'double' }" @click="config.layout = 'double'">双列</button>
              <button :class="{ active: config.layout === 'single' }" @click="config.layout = 'single'">单列</button>
            </div>
          </section>
          <section class="control-section">
            <div class="section-heading"><span>强调色</span></div>
            <div class="color-row">
              <button v-for="color in ['#7893a3','#587888','#8a9b93','#8f7f87','#566c79']" :key="color" class="swatch" :class="{ active: config.accent === color }" :style="{ background: color }" @click="config.accent = color" />
              <input v-model="config.accent" class="color-picker" type="color" title="自定义颜色" />
            </div>
          </section>
          <section class="control-section">
            <label class="range-label"><span>照片遮罩</span><b>{{ config.overlay }}%</b></label>
            <input v-model.number="config.overlay" type="range" min="0" max="55" />
          </section>
          <section class="control-section subtle-box">
            <b>输出规格</b>
            <span>3:4 竖版 · 3072 × 4096 px</span>
            <span>PNG · sRGB · 4K</span>
          </section>
        </div>

        <div class="panel-footer">
          <button class="text-btn" @click="clearCanvas">恢复全部默认</button>
          <span :title="draftStatus">{{ draftStatus }}</span>
        </div>
      </aside>

      <section class="stage">
        <div class="stage-toolbar">
          <span><b>实时预览</b> <i>3:4</i></span>
          <span class="stage-hint">{{ activeTemplate ? `正在编辑：${activeTemplate.name} · ${templateCode(activeTemplate)}` : '新清单 · 尚未另存为模板' }}</span>
        </div>

        <div class="preview-wrap">
          <article class="poster" :style="{
            '--accent': config.accent,
            '--title-scale': config.titleSize / 100,
            '--subtitle-scale': config.subtitleSize / 100,
            '--copy-x': `${config.heroTextX}%`,
            '--copy-y': `${config.heroTextY}%`
          }">
            <section class="poster-hero">
              <img :src="config.heroImage" alt="桌搭主图" :style="{ objectPosition: `${config.imagePosition}% ${config.imagePositionY}%` }" />
              <div class="hero-shade" :style="{ opacity: config.overlay / 100 }" />
              <div class="hero-copy">
                <span>{{ config.eyebrow }}</span>
                <h1>{{ config.title }}</h1>
                <p>{{ config.subtitle }}</p>
              </div>
            </section>

            <section class="poster-list">
              <header class="list-header">
                <div><h2>{{ config.listTitle }}</h2><b>{{ config.listSubtitle }}</b></div>
                <span>我的桌面装备与使用体验分享</span>
              </header>

              <div v-if="config.devices.length" class="device-grid" :class="config.layout">
                <div
                  v-for="(device, index) in config.devices"
                  :key="device.instanceId"
                  class="preview-card"
                  draggable="true"
                  @dragstart="onDragStart(index)"
                  @dragover.prevent
                  @drop="onDrop(index)"
                >
                  <div class="drag-grip">⠿</div>
                  <div class="product-thumb">
                    <img v-if="device.image" :src="device.image" :alt="device.name" />
                    <span v-else>{{ device.type.slice(0, 1) }}</span>
                    <b>{{ device.type }}</b>
                  </div>
                  <div class="product-info">
                    <h3>{{ device.name }}</h3>
                    <p>{{ device.detail1 || '设备信息待补充' }}</p>
                    <p>{{ device.detail2 || '使用体验待补充' }}</p>
                    <small v-if="device.brand">{{ device.brand }}</small>
                  </div>
                  <div class="card-actions">
                    <button type="button" title="从预览中删除" aria-label="从预览中删除" @click.stop="removeDevice(index)">×</button>
                  </div>
                </div>
              </div>
              <div v-else class="empty-preview">
                <span>＋</span>
                <b>从右侧设备库添加设备</b>
                <p>添加后可在这里拖动排序</p>
              </div>

              <footer class="poster-footer">
                <b>{{ config.footerNote }}</b>
                <span>{{ config.account }}</span>
              </footer>
            </section>
          </article>
        </div>
      </section>

      <aside class="sidebar library-panel">
        <div class="library-head">
          <div><h2>设备库</h2><span>{{ deviceLibrary.length }} 个设备</span></div>
          <button class="icon-button" title="新增设备" @click="openCreateDevice">＋</button>
        </div>
        <div class="search-box"><span>⌕</span><input v-model="search" placeholder="搜索设备或品牌" /></div>
        <form class="type-create library-type-create" @submit.prevent="addDeviceType(false)">
          <input v-model="typeName" aria-label="新增设备类型名称" placeholder="新类型，例如：摄像头" maxlength="16" :disabled="creatingType" />
          <button class="btn small" :disabled="creatingType || !typeName.trim()">{{ creatingType ? '添加中…' : '＋ 类型' }}</button>
        </form>
        <div class="type-filters" role="group" aria-label="按设备类型筛选" tabindex="0">
          <button :class="{ active: typeFilter === '全部' }" :aria-pressed="typeFilter === '全部'" @click="typeFilter = '全部'">全部</button>
          <button v-for="type in deviceTypes" :key="type" :class="{ active: typeFilter === type }" :aria-pressed="typeFilter === type" @click="typeFilter = type">{{ type }}</button>
        </div>
        <div class="library-list">
          <article v-for="device in filteredDevices" :key="device.id" class="library-card">
            <div class="library-thumb">
              <img v-if="device.image" :src="device.image" :alt="device.name" />
              <span v-else>{{ device.type.slice(0, 1) }}</span>
            </div>
            <div class="library-info">
              <span>{{ device.type }}</span>
              <h3>{{ device.name }}</h3>
              <p>{{ device.detail1 || '暂无设备说明' }}</p>
            </div>
            <div class="library-card-actions">
              <button class="edit-button" title="编辑设备" @click.stop="openEditDevice(device)">✎</button>
              <button class="add-button" title="添加到预览" @click.stop="addDevice(device)">＋</button>
            </div>
          </article>
          <div v-if="!filteredDevices.length" class="empty-library">没有找到匹配设备</div>
        </div>
        <button class="create-device" @click="openCreateDevice">＋ 新增设备配置</button>
      </aside>
    </main>
    <nav class="mobile-nav" aria-label="工作区切换">
      <button :class="{active:mobileTab==='preview'}" :aria-pressed="mobileTab==='preview'" @click="mobileTab='preview'">预览</button>
      <button :class="{active:mobileTab==='settings'}" :aria-pressed="mobileTab==='settings'" @click="mobileTab='settings'">编辑</button>
      <button :class="{active:mobileTab==='library'}" :aria-pressed="mobileTab==='library'" @click="mobileTab='library'">设备库</button>
    </nav>

    <div v-if="showDeviceModal" class="modal-backdrop">
      <form class="modal" @submit.prevent="saveDevice">
        <header><div><h2>{{ isEditingDevice ? '编辑设备' : '新增设备' }}</h2><p>{{ isEditingDevice ? '保存后会同步更新设备库和当前预览' : '保存后会进入设备库并加入当前预览' }}</p></div><button type="button" @click="closeDeviceModal">×</button></header>
        <div class="modal-grid">
          <label class="image-field" tabindex="0" aria-label="设备图片：点击上传或按 ⌘V / Ctrl+V 粘贴">
            <input hidden type="file" accept="image/*" @change="onImageUpload($event, 'device')" />
            <img v-if="newDevice.image" :src="newDevice.image" alt="设备图片" />
            <span v-else>＋<b>上传设备图</b><small>建议 4:3 横图 · 800×600 PNG</small></span>
          </label>
          <div class="modal-fields">
            <label class="field"><span>设备名称 *</span><input v-model="newDevice.name" placeholder="例如：罗技 MX Master 3S" autofocus /></label>
            <label class="field"><span>设备类型 *</span><select v-model="newDevice.type"><option v-for="type in deviceTypes" :key="type">{{ type }}</option></select></label>
            <div class="type-create" @keydown.enter.prevent.stop="addDeviceType(true)">
              <input v-model="typeName" aria-label="新类型名称" placeholder="输入新类型" maxlength="16" :disabled="creatingType" />
              <button type="button" class="btn small" :disabled="creatingType || !typeName.trim()" @click="addDeviceType(true)">{{ creatingType ? '添加中…' : '新增类型' }}</button>
            </div>
            <label class="field"><span>品牌</span><input v-model="newDevice.brand" placeholder="选填" /></label>
          </div>
        </div>
        <p class="image-paste-hint">可直接按 ⌘V / Ctrl+V 粘贴图片，支持截图或复制的图片，最大 12 MB。</p>
        <label class="field"><span>主要参数 / 特点</span><input v-model="newDevice.detail1" placeholder="例如：人体工学设计 · 静音按键" /></label>
        <label class="field"><span>使用体验</span><input v-model="newDevice.detail2" placeholder="例如：长时间办公也很舒适" /></label>
        <footer><button type="button" class="btn ghost" @click="closeDeviceModal">取消</button><button class="btn primary" :disabled="busy || creatingType">{{ isEditingDevice ? '保存修改' : '保存并添加' }}</button></footer>
      </form>
    </div>

    <div v-if="showTemplateModal" class="modal-backdrop">
      <form class="modal compact" @submit.prevent="saveTemplate">
        <header><div><h2>另存为模板</h2><p>创建独立模板，保留当前照片、文案和设备顺序</p></div><button type="button" @click="showTemplateModal = false">×</button></header>
        <label class="field"><span>模板名称</span><input v-model="templateName" placeholder="例如：银白桌搭 2026" autofocus /></label>
        <footer><button type="button" class="btn ghost" @click="showTemplateModal = false">取消</button><button class="btn primary" :disabled="busy">保存模板</button></footer>
      </form>
    </div>

    <div v-if="showTemplateList" class="modal-backdrop">
      <section class="modal template-modal">
        <header><div><h2>模板库</h2><p>载入以前保存的桌搭清单</p></div><button @click="showTemplateList = false">×</button></header>
        <div class="search-box template-search"><input v-model="templateSearch" aria-label="搜索模板" placeholder="搜索模板名称或编号" /></div>
        <div v-if="filteredTemplates.length" class="template-list">
          <article v-for="template in filteredTemplates" :key="template.id">
            <div class="template-cover"><img :src="template.config.heroImage" alt="模板预览" /></div>
            <div class="template-info">
              <h3>{{ template.name }}</h3>
              <p class="template-id" :title="template.id">编号 {{ templateCode(template) }}</p>
              <p>{{ template.config.devices.length }} 个设备 · {{ new Date(template.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</p>
            </div>
            <button class="btn small" :aria-label="`重命名 ${template.name}，编号 ${templateCode(template)}`" @click="renameTemplate(template)">重命名</button>
            <button class="btn small" :aria-label="`载入 ${template.name}，编号 ${templateCode(template)}`" @click="loadTemplate(template)">载入</button>
            <button class="danger-icon" :title="`删除模板，编号 ${templateCode(template)}`" :aria-label="`删除 ${template.name}，编号 ${templateCode(template)}`" @click="deleteTemplate(template)">×</button>
          </article>
        </div>
        <div v-else class="empty-templates"><span>◇</span><b>{{ templates.length ? '没有匹配模板' : '还没有保存的模板' }}</b><p>可修改搜索条件，或在顶部选择“另存为”</p></div>
      </section>
    </div>

    <div v-if="showExport" class="modal-backdrop export-backdrop">
      <section class="modal export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <header><div><h2 id="export-title">图片已生成</h2><p>3072 × 4096 · PNG</p></div><button aria-label="关闭导出预览" @click="showExport=false">×</button></header>
        <p class="export-help">手机上可长按下方图片，选择“存储图像”或“保存图片”。下载按钮通常保存到“文件”或“下载”目录。</p>
        <div class="export-actions">
          <button class="btn primary" @click="downloadExport">下载 PNG</button>
          <a class="btn ghost" :href="exportUrl" target="_blank" rel="noopener">打开原图</a>
          <button v-if="canShareExport" class="btn ghost" :disabled="sharingExport" @click="shareExport">分享图片</button>
        </div>
        <div class="export-preview"><img :src="exportUrl" :alt="exportFilename" /></div>
        <p class="export-footnote">若当前应用无法保存，请使用系统浏览器打开网页后导出。</p>
      </section>
    </div>
    <AdminPanel v-if="showManagement" :request="api" :data="managementData" @close="showManagement=false" @change="managementChanged" />
    <transition name="toast"><div v-if="toast" class="toast">{{ toast }}</div></transition>
  </div>
</template>
