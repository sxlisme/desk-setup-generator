<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'

const deviceTypes = ref([])
const deviceLibrary = ref([])
const templates = ref([])
const activePanel = ref('content')
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
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.message || '请求失败')
  }
  return response.status === 204 ? null : response.json()
}

async function uploadImage(file) {
  const data = new FormData()
  data.append('image', file)
  const response = await fetch('/api/upload', { method: 'POST', body: data })
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || '上传失败')
  return (await response.json()).url
}

async function onHeroUpload(event) {
  const file = event.target.files?.[0]
  if (!file) return
  busy.value = true
  try {
    config.heroImage = await uploadImage(file)
    notify('主照片已更新')
  } catch (error) {
    notify(error.message)
  } finally {
    busy.value = false
    event.target.value = ''
  }
}

async function onDeviceImageUpload(event) {
  const file = event.target.files?.[0]
  if (!file) return
  busy.value = true
  try {
    newDevice.image = await uploadImage(file)
  } catch (error) {
    notify(error.message)
  } finally {
    busy.value = false
  }
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
  editingDeviceId.value = null
  resetNewDevice()
  showDeviceModal.value = true
}

function openEditDevice(device) {
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
  showDeviceModal.value = false
  editingDeviceId.value = null
  resetNewDevice()
}

async function saveDevice() {
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

async function saveTemplate() {
  if (!templateName.value.trim()) return notify('请填写模板名称')
  busy.value = true
  try {
    const template = await api('/api/templates', {
      method: 'POST',
      body: JSON.stringify({ name: templateName.value, config: snapshot() })
    })
    templates.value.unshift(template)
    showTemplateModal.value = false
    templateName.value = ''
    notify('模板已保存')
  } catch (error) {
    notify(error.message)
  } finally {
    busy.value = false
  }
}

function loadTemplate(template) {
  Object.assign(config, defaultConfig(), JSON.parse(JSON.stringify(template.config)))
  showTemplateList.value = false
  notify(`已载入「${template.name}」`)
}

async function deleteTemplate(template) {
  await api(`/api/templates/${template.id}`, { method: 'DELETE' })
  templates.value = templates.value.filter((item) => item.id !== template.id)
  notify('模板已删除')
}

function clearCanvas() {
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

function drawCover(ctx, image, x, y, width, height, position = 50) {
  const scale = Math.max(width / image.width, height / image.height)
  const drawWidth = image.width * scale
  const drawHeight = image.height * scale
  const offsetX = x + (width - drawWidth) * (position / 100)
  const offsetY = y + (height - drawHeight) / 2
  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight)
}

function fitText(ctx, text, maxWidth, startSize, weight = 700) {
  let size = startSize
  do {
    ctx.font = `${weight} ${size}px "Microsoft YaHei", sans-serif`
    size -= 2
  } while (ctx.measureText(text).width > maxWidth && size > 24)
}

async function exportPng() {
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
    drawCover(ctx, hero, 0, 0, width, heroHeight + 50, config.imagePosition)
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

      const imageSize = cardHeight - 42
      const imageX = x + 22
      const imageY = y + 21
      ctx.fillStyle = '#e8eef0'
      roundedRect(ctx, imageX, imageY, imageSize, imageSize, 22)
      ctx.fill()
      if (device.image) {
        try {
          const itemImage = await loadImage(device.image)
          ctx.save()
          roundedRect(ctx, imageX, imageY, imageSize, imageSize, 22)
          ctx.clip()
          drawCover(ctx, itemImage, imageX, imageY, imageSize, imageSize)
          ctx.restore()
        } catch { /* keep placeholder */ }
      } else {
        ctx.fillStyle = config.accent
        ctx.textAlign = 'center'
        ctx.font = '800 70px "Microsoft YaHei", sans-serif'
        ctx.fillText(device.type.slice(0, 1), imageX + imageSize / 2, imageY + imageSize / 2 + 24)
      }

      ctx.fillStyle = config.accent
      roundedRect(ctx, imageX + 20, imageY + imageSize - 54, imageSize - 40, 42, 21)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'center'
      ctx.font = '700 24px "Microsoft YaHei", sans-serif'
      ctx.fillText(device.type, imageX + imageSize / 2, imageY + imageSize - 24)

      const textX = imageX + imageSize + 42
      const textWidth = cardWidth - imageSize - 92
      ctx.textAlign = 'left'
      ctx.fillStyle = '#172731'
      fitText(ctx, device.name, textWidth, 47, 800)
      ctx.fillText(device.name, textX, y + 85)
      ctx.fillStyle = '#536873'
      ctx.font = '500 31px "Microsoft YaHei", sans-serif'
      ctx.fillText(device.detail1 || '设备信息待补充', textX, y + 142)
      ctx.fillText(device.detail2 || '使用体验待补充', textX, y + 192)
      if (device.brand) {
        ctx.fillStyle = '#8aa0aa'
        ctx.font = '500 25px "Microsoft YaHei", sans-serif'
        ctx.fillText(device.brand, textX, y + cardHeight - 34)
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

    const link = document.createElement('a')
    link.download = `${config.title || '桌搭清单'}-4K.png`
    link.href = canvas.toDataURL('image/png', 1)
    link.click()
    notify('4K 图片已导出')
  } catch (error) {
    console.error(error)
    notify('导出失败，请检查图片后重试')
  } finally {
    busy.value = false
  }
}

watch(config, () => {
  localStorage.setItem('desk-setup-draft', JSON.stringify(snapshot()))
}, { deep: true })

onMounted(async () => {
  try {
    const bootstrap = await api('/api/bootstrap')
    deviceTypes.value = bootstrap.types
    deviceLibrary.value = bootstrap.devices
    templates.value = bootstrap.templates
    newDevice.type = bootstrap.types[0]
    const saved = localStorage.getItem('desk-setup-draft')
    if (saved) {
      Object.assign(config, defaultConfig(), JSON.parse(saved))
    } else {
      config.devices = bootstrap.devices.slice(0, 8).map((item) => ({
        ...item,
        instanceId: `${item.id}-${Math.random()}`
      }))
    }
  } catch (error) {
    notify('数据服务连接失败')
  }
})
</script>

<template>
  <div class="app-shell">
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
        <button class="btn ghost" @click="showTemplateModal = true"><span class="icon">◇</span> 保存模板</button>
        <button class="btn primary" :disabled="busy" @click="exportPng"><span class="icon">↓</span> 导出 4K PNG</button>
      </div>
    </header>

    <main class="workspace">
      <aside class="sidebar settings-panel">
        <nav class="panel-tabs">
          <button :class="{ active: activePanel === 'content' }" @click="activePanel = 'content'">内容</button>
          <button :class="{ active: activePanel === 'style' }" @click="activePanel = 'style'">样式</button>
        </nav>

        <div v-if="activePanel === 'content'" class="panel-scroll">
          <section class="control-section">
            <div class="section-heading"><span>主图</span><small>上半区域</small></div>
            <button class="hero-upload" @click="imageInput?.click()">
              <img :src="config.heroImage" alt="当前桌搭主图" />
              <span><b>更换照片</b><small>JPG / PNG，不超过 12MB</small></span>
            </button>
            <input ref="imageInput" hidden type="file" accept="image/*" @change="onHeroUpload" />
            <label class="range-label"><span>照片水平位置</span><b>{{ config.imagePosition }}%</b></label>
            <input v-model.number="config.imagePosition" type="range" min="0" max="100" />
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
          <span>草稿自动保存</span>
        </div>
      </aside>

      <section class="stage">
        <div class="stage-toolbar">
          <span><b>实时预览</b> <i>3:4</i></span>
          <span class="stage-hint">拖动清单卡片可调整顺序</span>
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
              <img :src="config.heroImage" alt="桌搭主图" :style="{ objectPosition: `${config.imagePosition}% center` }" />
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
        <div class="type-filters">
          <button :class="{ active: typeFilter === '全部' }" @click="typeFilter = '全部'">全部</button>
          <button v-for="type in deviceTypes" :key="type" :class="{ active: typeFilter === type }" @click="typeFilter = type">{{ type }}</button>
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

    <div v-if="showDeviceModal" class="modal-backdrop" @click.self="closeDeviceModal">
      <form class="modal" @submit.prevent="saveDevice">
        <header><div><h2>{{ isEditingDevice ? '编辑设备' : '新增设备' }}</h2><p>{{ isEditingDevice ? '保存后会同步更新设备库和当前预览' : '保存后会进入设备库并加入当前预览' }}</p></div><button type="button" @click="closeDeviceModal">×</button></header>
        <div class="modal-grid">
          <label class="image-field">
            <input hidden type="file" accept="image/*" @change="onDeviceImageUpload" />
            <img v-if="newDevice.image" :src="newDevice.image" alt="设备图片" />
            <span v-else>＋<b>上传设备图</b><small>建议透明背景 PNG</small></span>
          </label>
          <div class="modal-fields">
            <label class="field"><span>设备名称 *</span><input v-model="newDevice.name" placeholder="例如：罗技 MX Master 3S" autofocus /></label>
            <label class="field"><span>设备类型 *</span><select v-model="newDevice.type"><option v-for="type in deviceTypes" :key="type">{{ type }}</option></select></label>
            <label class="field"><span>品牌</span><input v-model="newDevice.brand" placeholder="选填" /></label>
          </div>
        </div>
        <label class="field"><span>主要参数 / 特点</span><input v-model="newDevice.detail1" placeholder="例如：人体工学设计 · 静音按键" /></label>
        <label class="field"><span>使用体验</span><input v-model="newDevice.detail2" placeholder="例如：长时间办公也很舒适" /></label>
        <footer><button type="button" class="btn ghost" @click="closeDeviceModal">取消</button><button class="btn primary" :disabled="busy">{{ isEditingDevice ? '保存修改' : '保存并添加' }}</button></footer>
      </form>
    </div>

    <div v-if="showTemplateModal" class="modal-backdrop" @click.self="showTemplateModal = false">
      <form class="modal compact" @submit.prevent="saveTemplate">
        <header><div><h2>保存当前模板</h2><p>保存照片、文案、样式和设备顺序</p></div><button type="button" @click="showTemplateModal = false">×</button></header>
        <label class="field"><span>模板名称</span><input v-model="templateName" placeholder="例如：银白桌搭 2026" autofocus /></label>
        <footer><button type="button" class="btn ghost" @click="showTemplateModal = false">取消</button><button class="btn primary" :disabled="busy">保存模板</button></footer>
      </form>
    </div>

    <div v-if="showTemplateList" class="modal-backdrop" @click.self="showTemplateList = false">
      <section class="modal template-modal">
        <header><div><h2>模板库</h2><p>载入以前保存的桌搭清单</p></div><button @click="showTemplateList = false">×</button></header>
        <div v-if="templates.length" class="template-list">
          <article v-for="template in templates" :key="template.id">
            <div class="template-cover"><img :src="template.config.heroImage" alt="模板预览" /></div>
            <div><h3>{{ template.name }}</h3><p>{{ template.config.devices.length }} 个设备 · {{ new Date(template.createdAt).toLocaleDateString('zh-CN') }}</p></div>
            <button class="btn small" @click="loadTemplate(template)">载入</button>
            <button class="danger-icon" title="删除模板" @click="deleteTemplate(template)">×</button>
          </article>
        </div>
        <div v-else class="empty-templates"><span>◇</span><b>还没有保存的模板</b><p>完成一套配置后，在顶部选择“保存模板”</p></div>
      </section>
    </div>

    <transition name="toast"><div v-if="toast" class="toast">{{ toast }}</div></transition>
  </div>
</template>
