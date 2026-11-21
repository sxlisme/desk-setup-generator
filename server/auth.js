import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'

export function installAuth(app) {
  const password = process.env.ADMIN_PASSWORD
  if (!password || password.length < 12) throw new Error('请在 .env 中设置至少 12 位的 ADMIN_PASSWORD 后启动服务')
  const username = process.env.ADMIN_USERNAME || 'admin'
  const salt = randomBytes(16)
  const expected = scryptSync(password, salt, 32)
  const sessions = new Map()
  const attempts = new Map()
  const duration = 7 * 24 * 60 * 60 * 1000
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', path: '/', maxAge: duration }
  const hash = token => createHash('sha256').update(token).digest('hex')
  const tokenFrom = req => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('desk_session='))?.slice(13) || ''
  const getSession = req => {
    const key = hash(tokenFrom(req))
    const session = sessions.get(key)
    if (session && session.expires > Date.now()) return session
    sessions.delete(key)
    return null
  }
  const sameOrigin = req => {
    if (req.headers['sec-fetch-site'] === 'cross-site') return false
    if (!req.headers.origin) return true
    try {
      const origin = new URL(req.headers.origin)
      return process.env.PUBLIC_ORIGIN ? origin.origin === new URL(process.env.PUBLIC_ORIGIN).origin : origin.host === req.get('host')
    } catch { return false }
  }
  app.get('/api/auth/session', (req, res) => {
    const session = getSession(req)
    res.json({ authenticated: Boolean(session), username: session ? username : null, csrfToken: session?.csrfToken })
  })
  app.post('/api/auth/login', (req, res) => {
    if (!sameOrigin(req) || req.get('X-Requested-With') !== 'desk-setup') return res.status(403).json({ message: '请求来源无效，请刷新页面' })
    const now = Date.now()
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key)
    for (const [key, value] of sessions) if (value.expires < now) sessions.delete(key)
    const ip = req.ip
    const attempt = attempts.get(ip) || { count: 0, until: now + 15 * 60 * 1000 }
    if (attempt.count >= 10 || attempts.size > 10000) return res.status(429).json({ message: '尝试次数过多，请 15 分钟后再试' })
    attempt.count += 1
    attempts.set(ip, attempt)
    const supplied = typeof req.body?.password === 'string' ? req.body.password : ''
    if (supplied.length > 1024) return res.status(401).json({ message: '账号或密码不正确' })
    const validPassword = timingSafeEqual(scryptSync(supplied, salt, 32), expected)
    if (req.body?.username !== username || !validPassword) return res.status(401).json({ message: '账号或密码不正确' })
    attempts.delete(ip)
    sessions.delete(hash(tokenFrom(req)))
    if (sessions.size >= 100) sessions.delete(sessions.keys().next().value)
    const token = randomBytes(32).toString('hex')
    const session = { csrfToken: randomBytes(24).toString('hex'), expires: now + duration }
    sessions.set(hash(token), session)
    res.cookie('desk_session', token, cookieOptions).json({ authenticated: true, username, csrfToken: session.csrfToken })
  })
  const requireAuth = (req, res, next) => {
    const session = getSession(req)
    if (!session) return res.status(401).json({ message: '请先登录' })
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (!sameOrigin(req) || req.get('X-CSRF-Token') !== session.csrfToken)) return res.status(403).json({ message: '会话校验失败，请刷新页面' })
    next()
  }
  app.use('/api', requireAuth)
  app.use('/uploads', requireAuth)
  app.post('/api/auth/logout', (req, res) => {
    sessions.delete(hash(tokenFrom(req)))
    const { maxAge, ...clearOptions } = cookieOptions
    res.clearCookie('desk_session', clearOptions).status(204).end()
  })
}
