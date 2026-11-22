import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { gzipSync, gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
const password = 'integration-only-password-2026'
const config = (devices=[]) => ({ title:'测试清单',heroImage:'/default-setup.png',devices })

test('single-admin data management lifecycle', { timeout: 60000 }, async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'desk-integration-'))
  const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve))
  const base=`http://127.0.0.1:${port}`
  let child,cookie='',csrf='',revision='',savedBackup,uploaded,device,template
  async function start() {
    child=spawn(process.execPath,['server/index.js'],{cwd:root,env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_PASSWORD:password,ADMIN_USERNAME:'admin',COOKIE_SECURE:'false',PUBLIC_ORIGIN:''},stdio:['ignore','pipe','pipe']})
    let stderr='';child.stderr.on('data',d=>stderr+=d)
    await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',code=>reject(Error(`Server exited ${code}: ${stderr}`)))})
  }
  async function stop() {if(child?.exitCode===null){const ended=once(child,'exit');child.kill();await ended}}
  async function request(url,{method='GET',body,auth=true,token=true,headers={}}={}) {
    return fetch(base+url,{method,headers:{...(auth&&cookie?{Cookie:cookie}:{}),...(token&&csrf?{'X-CSRF-Token':csrf}:{}),'X-Requested-With':'desk-setup',...(body && !(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},body:body instanceof FormData?body:body?JSON.stringify(body):undefined})
  }
  async function json(url,options={}) {const r=await request(url,options);assert(r.ok,`${url}: ${r.status} ${await r.clone().text()}`);return r.status===204?null:r.json()}
  async function login() {const r=await request('/api/auth/login',{method:'POST',auth:false,body:{username:'admin',password}});assert.equal(r.status,200);const set=r.headers.get('set-cookie');assert.match(set,/HttpOnly/i);assert.match(set,/SameSite=Strict/i);assert(!/; Secure/i.test(set));cookie=set.split(';')[0];csrf=(await r.json()).csrfToken}
  async function upload(content=png,name='test.png') {const form=new FormData();form.append('image',new Blob([content]),name);return json('/api/upload',{method:'POST',body:form})}
  async function backupForm(buffer,confirm=false) {const form=new FormData();form.append('backup',new Blob([buffer]),'test.deskbackup.gz');if(confirm)form.append('confirm','RESTORE');return form}
  t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true})})
  await start()
  await t.test('private API and images require login; HTTP cookie works and CSRF is enforced',async()=>{
    assert.equal((await request('/api/bootstrap',{auth:false})).status,401)
    assert.equal((await request('/uploads/test.png',{auth:false})).status,401)
    assert.equal((await request('/api/auth/login',{method:'POST',body:{username:'admin',password:'wrong'}})).status,401)
    await login()
    assert.equal((await json('/api/auth/session')).authenticated,true)
    assert.equal((await request('/api/types',{method:'POST',token:false,body:{name:'bad'}})).status,403)
    assert.equal((await request('/api/types',{method:'POST',headers:{Origin:'http://evil.invalid'},body:{name:'bad'}})).status,403)
    revision=(await json('/api/bootstrap')).revision
  })
  await t.test('uploads are validated; used images cannot be deleted',async()=>{
    const form=new FormData();form.append('image',new Blob(['<script>bad</script>'],{type:'image/png'}),'fake.png')
    assert.equal((await request('/api/upload',{method:'POST',body:form})).status,400)
    uploaded=await upload()
    assert.equal((await request(uploaded.url)).status,200)
    assert.equal((await request(uploaded.url,{auth:false})).status,401)
    device=await json('/api/devices',{method:'POST',body:{name:'显示器测试',type:'显示器',image:uploaded.url}})
    assert.equal((await request('/api/assets/'+uploaded.url.slice(9),{method:'DELETE'})).status,409)
    const unused=await upload();await json('/api/assets/'+unused.url.slice(9),{method:'DELETE'})
    assert.equal((await request(unused.url)).status,404)
  })
  await t.test('same-name templates stay independent; update and rename retain ID and content',async()=>{
    template=await json('/api/templates',{method:'POST',body:{name:'同名',config:config([device])}})
    const other=await json('/api/templates',{method:'POST',body:{name:'同名',config:config()}})
    assert.notEqual(template.id,other.id)
    const updated=await json('/api/templates/'+template.id,{method:'PUT',body:{config:{...template.config,title:'已修改'}}})
    assert.equal(updated.id,template.id)
    const renamed=await json('/api/templates/'+template.id,{method:'PUT',body:{name:'新名称'}})
    assert.equal(renamed.config.title,'已修改');assert.equal(renamed.id,template.id)
    await json('/api/templates/'+other.id,{method:'DELETE'})
    await json('/api/draft',{method:'PUT',body:{config:config([device]),templateId:template.id,revision}})
  })
  await t.test('vertical crop persists in templates and draft; invalid values do not replace saved content',async()=>{
    const updated=await json('/api/templates/'+template.id,{method:'PUT',body:{config:{...template.config,imagePositionY:85}}})
    assert.equal(updated.config.imagePositionY,85)
    await json('/api/draft',{method:'PUT',body:{config:updated.config,templateId:template.id,revision}})
    for(const imagePositionY of [-1,101,'50']) {
      assert.equal((await request('/api/templates/'+template.id,{method:'PUT',body:{config:{...updated.config,imagePositionY}}})).status,400)
    }
    await stop();await start();await login()
    const data=await json('/api/bootstrap')
    assert.equal(data.templates.find(t=>t.id===template.id).config.imagePositionY,85)
    assert.equal(data.draft.config.imagePositionY,85)
  })
  await t.test('type rename/merge updates devices, template snapshots and draft; deletion checks all references',async()=>{
    await json('/api/types',{method:'POST',body:{name:'办公显示器'}})
    let data=await json('/api/types/manage',{method:'POST',body:{action:'rename',from:'显示器',to:'屏幕'}})
    assert.equal(data.devices.find(d=>d.id===device.id).type,'屏幕')
    assert.equal(data.templates.find(t=>t.id===template.id).config.devices[0].type,'屏幕')
    assert.equal(data.draft.config.devices[0].type,'屏幕')
    assert.equal((await request('/api/types/manage',{method:'POST',body:{action:'delete',from:'屏幕'}})).status,409)
    data=await json('/api/types/manage',{method:'POST',body:{action:'merge',from:'屏幕',to:'办公显示器'}})
    assert(!data.types.includes('屏幕'));assert.equal(data.draft.config.devices[0].type,'办公显示器')
    await json('/api/types',{method:'POST',body:{name:'空类型'}})
    await json('/api/types/manage',{method:'POST',body:{action:'delete',from:'空类型'}})
    const types=(await json('/api/bootstrap')).types.reverse()
    await json('/api/types/order',{method:'PUT',body:{types}})
    assert.equal((await request('/api/types/order',{method:'PUT',body:{types:['办公显示器']}})).status,400)
    await stop();await start();assert.equal((await request('/api/bootstrap')).status,401);await login()
    data=await json('/api/bootstrap');assert.deepEqual(data.types,types);assert(!data.types.includes('显示器'))
  })
  await t.test('backup includes images, validates before restore, and preserves original state on invalid input',async()=>{
    savedBackup=Buffer.from(await (await request('/api/backup')).arrayBuffer())
    const bundle=JSON.parse(gunzipSync(savedBackup))
    assert.equal(bundle.format,'desk-setup-backup');assert(bundle.assets.some(a=>a.name===uploaded.url.slice(9)))
    assert(!gunzipSync(savedBackup).toString().includes(password))
    const preview=await json('/api/restore/preview',{method:'POST',body:await backupForm(savedBackup)})
    assert.equal(preview.assets,1)
    const original=await json('/api/bootstrap')
    for (const bad of [Buffer.from('garbage'),gzipSync(JSON.stringify({...bundle,assets:[]})),gzipSync(JSON.stringify({...bundle,assets:[{name:'../escape.png',content:png.toString('base64')}]}))]) {
      const result=await request('/api/restore',{method:'POST',body:await backupForm(bad,true)})
      assert.equal(result.status,400)
      assert.deepEqual(await json('/api/bootstrap'),original)
    }
  })
  await t.test('restore roundtrip replaces data/assets; recovery snapshot and revision protect previous work',async()=>{
    await json('/api/types',{method:'POST',body:{name:'恢复前新增'}})
    const extra=await upload()
    const before=await json('/api/bootstrap')
    const restored=await json('/api/restore',{method:'POST',body:await backupForm(savedBackup,true)})
    assert(!restored.types.includes('恢复前新增'));assert.notEqual(restored.revision,revision)
    assert.equal((await request(extra.url)).status,404)
    assert.deepEqual(Buffer.from(await (await request(uploaded.url)).arrayBuffer()),png)
    assert.equal((await request('/api/draft',{method:'PUT',body:{config:config(),templateId:null,revision}})).status,409)
    const list=await json('/api/backups');assert.equal(list.length,1)
    const recovery=Buffer.from(await (await request('/api/backups/'+list[0].name)).arrayBuffer())
    const previous=JSON.parse(gunzipSync(recovery));assert.deepEqual(previous.data.types,before.types);assert.equal(previous.assets.length,2)
    assert.equal((await request('/api/templates',{method:'POST',headers:{'X-Data-Revision':revision},body:{name:'旧页面',config:config()}})).status,409)
    revision=restored.revision
  })
  await t.test('draft-only image is protected; deleting all devices stays empty after restart',async()=>{
    const draftImage=await upload()
    await json('/api/draft',{method:'PUT',body:{config:{...config(),heroImage:draftImage.url},templateId:null,revision}})
    assert.equal((await request('/api/assets/'+draftImage.url.slice(9),{method:'DELETE'})).status,409)
    await json('/api/draft',{method:'PUT',body:{config:config(),templateId:null,revision}})
    await json('/api/assets/'+draftImage.url.slice(9),{method:'DELETE'})
    for(const d of (await json('/api/bootstrap')).devices)await json('/api/devices/'+d.id,{method:'DELETE'})
    await stop();await start();await login();assert.equal((await json('/api/bootstrap')).devices.length,0)
  })
  await t.test('logout revokes session; failed logins are rate limited',async()=>{
    await json('/api/auth/logout',{method:'POST'})
    assert.equal((await request('/api/bootstrap')).status,401)
    for(let i=0;i<10;i++)assert.equal((await request('/api/auth/login',{method:'POST',auth:false,body:{username:'admin',password:'bad'}})).status,401)
    assert.equal((await request('/api/auth/login',{method:'POST',auth:false,body:{username:'admin',password}})).status,429)
  })
})
