# 桌搭清单生成器

一个用于制作 3:4 桌搭清单图片的轻量全栈项目。支持上传主图、维护设备库、拖动设备排序、保存模板，并导出 `3072 × 4096` 的 4K PNG。

## 本地开发

```bash
npm install
npm run dev
```

- 前端：http://localhost:5173
- API：http://localhost:3000

## 生产运行

```bash
npm run build
npm start
```

访问 http://localhost:3000。

## Docker 部署

```bash
docker compose up -d --build
```

设备库、模板和上传图片存放于 `data` 目录，并通过 Docker volume 持久化。
