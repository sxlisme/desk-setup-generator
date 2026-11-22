<script setup>
import { computed, onMounted, ref } from 'vue'
const props = defineProps({ request: Function, data: Object })
const emit = defineEmits(['close','change'])
const tab = ref('types')
const working = ref(false)
const error = ref('')
const message = ref('')
const renameFrom = ref('')
const renameTo = ref('')
const mergeFrom = ref('')
const mergeTo = ref('')
const assets = ref([])
const onlyUnused = ref(false)
const assetSearch = ref('')
const selectedAsset = ref(null)
const backupFile = ref(null)
const preview = ref(null)
const backups = ref([])
const shownAssets = computed(() => assets.value.filter(asset => (!onlyUnused.value || !asset.references.length) && asset.name.includes(assetSearch.value.trim())))
const formatSize = size => size < 1024*1024 ? `${(size/1024).toFixed(1)} KB` : `${(size/1024/1024).toFixed(1)} MB`
async function act(fn) {
  if (working.value) return
  working.value = true; error.value = ''; message.value = ''
  try { await fn() } catch(e) { error.value = e.message } finally { working.value = false }
}
async function refreshAssets() { assets.value = await props.request('/api/assets') }
async function selectTab(value) {
  tab.value = value
  await act(async() => {
    if(value === 'assets') await refreshAssets()
    if(value === 'backup') backups.value = await props.request('/api/backups')
  })
}
async function manageType(action,from,to) {
  if(action === 'merge' && !window.confirm(`将“${from}”合并到“${to}”？设备、模板和草稿会同步更新。`)) return
  if(action === 'delete' && !window.confirm(`删除空类型“${from}”？`)) return
  await act(async()=>{
    const data = await props.request('/api/types/manage',{method:'POST',body:JSON.stringify({action,from,to})})
    emit('change',data)
    renameFrom.value=''; mergeFrom.value=''; message.value='类型已更新'
  })
}
async function moveType(index,delta) {
  const types=[...props.data.types];[types[index],types[index+delta]]=[types[index+delta],types[index]]
  await act(async()=>emit('change',await props.request('/api/types/order',{method:'PUT',body:JSON.stringify({types})})))
}
async function deleteAsset(asset) {
  if(!window.confirm(`永久删除图片“${asset.name}”？此操作无法撤销。`)) return
  await act(async()=>{ await props.request(`/api/assets/${encodeURIComponent(asset.name)}`,{method:'DELETE'});await refreshAssets();message.value='图片已删除' })
}
async function download(url,name) {
  await act(async()=>{
    const blob=await props.request(url,{responseType:'blob'})
    const href=URL.createObjectURL(blob);const link=document.createElement('a');link.href=href;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(href),1000)
    message.value='备份已下载'
  })
}
async function chooseBackup(event) {
  preview.value=null;backupFile.value=event.target.files?.[0]||null
  if(!backupFile.value) return
  await act(async()=>{
    const form=new FormData();form.append('backup',backupFile.value)
    preview.value=await props.request('/api/restore/preview',{method:'POST',body:form})
  })
}
async function restore() {
  if(!preview.value || !window.confirm('恢复会覆盖当前设备、类型、模板、草稿和上传图片。系统将先备份当前数据。确定继续？')) return
  await act(async()=>{
    const form=new FormData();form.append('backup',backupFile.value);form.append('confirm','RESTORE')
    const data=await props.request('/api/restore',{method:'POST',body:form})
    emit('change',data);preview.value=null;backupFile.value=null
    backups.value=await props.request('/api/backups');message.value='恢复完成。恢复前的数据可在下方下载。'
  })
}
onMounted(()=>selectTab('types'))
</script>
<template>
  <div class="modal-backdrop management-backdrop">
    <section class="modal management-modal">
      <header><div><h2>数据管理</h2><p>管理设备类型、图片资产与完整备份</p></div><button :disabled="working" aria-label="关闭数据管理" @click="emit('close')">×</button></header>
      <nav class="management-tabs"><button v-for="item in [['types','类型管理'],['assets','图片资产'],['backup','备份恢复']]" :key="item[0]" :class="{active:tab===item[0]}" :disabled="working" @click="selectTab(item[0])">{{ item[1] }}</button></nav>
      <p v-if="error" class="notice error" role="alert">{{ error }}</p><p v-if="message" class="notice success" role="status">{{ message }}</p>
      <div class="management-content">
        <template v-if="tab==='types'">
          <p class="management-help">上下移动调整顺序；改名或合并会同步到设备、模板及草稿。只有无引用的类型可以删除。</p>
          <div v-for="(type,index) in data.types" :key="type" class="type-row">
            <div class="type-row-name"><strong>{{ type }}</strong><small>{{ data.typeUsage?.[type] || 0 }} 处引用</small></div>
            <button class="btn small" :disabled="working || index===0" :aria-label="`上移 ${type}`" @click="moveType(index,-1)">↑</button>
            <button class="btn small" :disabled="working || index===data.types.length-1" :aria-label="`下移 ${type}`" @click="moveType(index,1)">↓</button>
            <button class="btn small" :disabled="working" @click="renameFrom=type;renameTo=type;mergeFrom=''">重命名</button>
            <button class="btn small" :disabled="working || data.types.length<2" @click="mergeFrom=type;mergeTo=data.types.find(t=>t!==type);renameFrom=''">合并</button>
            <button class="btn small danger-text" :disabled="working || !!data.typeUsage?.[type]" @click="manageType('delete',type)">删除</button>
            <form v-if="renameFrom===type" class="type-action" @submit.prevent="manageType('rename',type,renameTo)"><input v-model="renameTo" aria-label="新的类型名称" maxlength="16" required /><button class="btn primary small" :disabled="working">保存名称</button><button type="button" class="btn small" @click="renameFrom=''">取消</button></form>
            <div v-if="mergeFrom===type" class="type-action"><span>合并到</span><select v-model="mergeTo" aria-label="合并目标类型"><option v-for="target in data.types.filter(t=>t!==type)" :key="target">{{ target }}</option></select><button class="btn primary small" :disabled="working" @click="manageType('merge',type,mergeTo)">确认合并</button><button class="btn small" @click="mergeFrom=''">取消</button></div>
          </div>
          <p v-if="!data.types.length">暂无类型，可回到设备库新增。</p>
        </template>
        <template v-else-if="tab==='assets'">
          <div class="asset-toolbar"><input v-model="assetSearch" aria-label="搜索图片文件名" placeholder="搜索文件名" /><label><input v-model="onlyUnused" type="checkbox" /> 仅看未使用</label><span>{{ shownAssets.length }} 张 · {{ formatSize(shownAssets.reduce((n,a)=>n+a.size,0)) }}</span></div>
          <p class="management-help">引用包括设备库、保存的模板和当前草稿。先移除引用，再删除图片。</p>
          <div class="asset-grid"><article v-for="asset in shownAssets" :key="asset.name" class="asset-card">
            <button class="asset-preview" :aria-label="`查看图片 ${asset.name}`" @click="selectedAsset=asset"><img :src="asset.url" loading="lazy" :alt="asset.name" /></button>
            <strong :title="asset.name">{{ asset.name }}</strong><small>{{ formatSize(asset.size) }} · {{ asset.references.length ? '使用中' : '未使用' }}</small>
            <details v-if="asset.references.length"><summary>{{ asset.references.length }} 处引用</summary><p v-for="(ref,index) in asset.references" :key="index">{{ ref }}</p></details>
            <button class="btn small danger-text" :disabled="working || !!asset.references.length" @click="deleteAsset(asset)">删除图片</button>
          </article></div><p v-if="!shownAssets.length" class="empty-library">没有符合条件的图片</p>
        </template>
        <template v-else>
          <section class="backup-section"><h3>导出完整备份</h3><p>包含设备、类型、模板、当前草稿和全部上传图片。账号密码不包含在备份中。支持图片总量最多 150 MB。</p><button class="btn primary" :disabled="working" @click="download('/api/backup',`desk-setup-${new Date().toISOString().slice(0,10)}.deskbackup.gz`)">下载完整备份</button></section>
          <section class="backup-section"><h3>从备份恢复</h3><p>先校验备份，再确认覆盖。恢复前会自动保存当前数据快照。</p><input type="file" accept=".gz,.deskbackup.gz" aria-label="选择恢复备份" :disabled="working" @change="chooseBackup" /><div v-if="preview" class="restore-preview"><p>校验通过：{{ preview.devices }} 个设备、{{ preview.types }} 个类型、{{ preview.templates }} 个模板、{{ preview.assets }} 张图片</p><button class="btn primary" :disabled="working" @click="restore">确认覆盖恢复</button></div></section>
          <section class="backup-section"><h3>恢复前自动备份</h3><p v-if="!backups.length">尚无恢复记录</p><div v-for="backup in backups" :key="backup.name" class="backup-row"><span>{{ backup.name }}<small>{{ formatSize(backup.size) }}</small></span><button class="btn small" :disabled="working" @click="download(`/api/backups/${backup.name}`,backup.name)">下载</button></div></section>
        </template>
      </div>
      <p v-if="working" class="management-help" role="status">正在处理，请稍候…</p>
    </section>
    <div v-if="selectedAsset" class="asset-lightbox"><button class="btn" @click="selectedAsset=null">关闭图片预览</button><img :src="selectedAsset.url" :alt="selectedAsset.name" /><span>{{ selectedAsset.name }}</span></div>
  </div>
</template>
