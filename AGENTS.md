# AGENTS.md — ChronoFrame

为 AI 编程助手提供的项目上下文和开发规范。

## 项目概述

ChronoFrame 是一个照片展示与管理 Web 应用，Fork 自 HoshinoSuzumi/chronoframe，在此基础上增强了高德地图、视频、全景照片、相册管理等功能。

- **技术栈**: Nuxt 4 + TypeScript + TailwindCSS v4 + Drizzle ORM (SQLite)
- **包管理器**: pnpm（monorepo，含 `packages/webgl-image` 子包）
- **运行时依赖**: exiftool（EXIF 解析）、ffmpeg（视频缩略图）
- **容器化**: Docker / Docker Compose

## 目录结构

```
app/                  # Nuxt 前端
  pages/              # 路由页面 (albums, dashboard, globe, signin, onboarding)
    [...slug].vue     # 全局照片详情 Catch-all 路由
  components/         # Vue 组件 (含 components/ui 路径前缀为空的 UI 组件)
  composables/        # 组合式函数 (usePhotos, useAlbums, useUpload, useImageLoader 等)
  stores/             # Pinia 状态管理 (settings, viewer, wizard)
  layouts/            # 布局
  middleware/         # 路由中间件
  plugins/            # 插件
  libs/               # 客户端库
  utils/              # 工具函数
  workers/            # Web Workers

server/               # Nitro 服务端
  api/                # API 路由
    photos/           # 照片 CRUD、上传、EXIF、LivePhoto、全景
    albums/           # 相册管理
    auth/             # 认证
    settings/         # 系统设置
    system/           # 系统信息
    queue/            # 上传处理队列
    wizard/           # 初始化向导
  database/
    schema.ts         # Drizzle ORM Schema（users, photos, albums, pipeline_queue 等）
    migrations/       # SQLite 迁移文件
  services/           # 业务逻辑层 (storage, image, video, location, pipeline-queue, settings)
  middleware/         # 服务端中间件
  plugins/            # Nitro 插件
  utils/              # 服务端工具
  routes/             # 自定义路由

shared/
  types/              # 共享类型定义 (photo, config, map, storage, settings, auth)
  utils/              # 共享工具

packages/webgl-image/ # WebGL 图片渲染子包 (workspace dependency)

i18n/                 # 国际化
  i18n.config.ts      # i18n 配置
  localeDetector.ts   # 语言检测器
  locales/            # 翻译文件 (zh-Hans, zh-Hant-TW, zh-Hant-HK, en, ja)

scripts/
  migrate.mjs         # 数据库迁移脚本 (容器启动时执行)

tests/                # vitest 测试 (.test.mjs)

data/                 # 运行时数据 (SQLite、本地存储，Git 忽略)
```

## 常用命令

| 操作 | 命令 |
|------|------|
| 安装依赖 | `pnpm install` |
| 开发服务器 | `pnpm dev` (先构建 webgl-image 依赖，再启动 Nuxt) |
| 仅 Nuxt 开发 | `pnpm dev:only` |
| 仅 webgl-image 开发 | `pnpm dev:dep` |
| 生产构建 | `pnpm build` (先 `build:deps` 再 `nuxt build`) |
| 数据库迁移 | `pnpm db:migrate` |
| 数据库 Schema 生成 | `pnpm db:generate` |
| 数据库推送 | `pnpm db:push` |
| Lint 检查 | `pnpm lint` |
| Lint 修复 | `pnpm lint:fix` |
| 文档开发 | `pnpm docs:dev` |
| Docker 构建 | `docker build -t chronoframe:latest .` |
| Docker Compose | `docker compose up -d` |

## 技术要点

### Nuxt + Nitro
- 使用 Nuxt 4 的 `compatibilityDate: '2025-07-15'`
- Nitro preset 为 `node_server`，启用 WebSocket 和实验性 Tasks
- 开发服务器绑定 `0.0.0.0:3000`

### 数据库 (Drizzle + SQLite)
- Schema 定义在 `server/database/schema.ts`
- 使用 `better-sqlite3` 驱动
- Docker 启动时自动执行 `scripts/migrate.mjs` 运行迁移
- 默认数据库路径: `data/app.sqlite3` (可通过 `DATABASE_URL` 环境变量配置)

### 国际化 (i18n)
- 使用 `@nuxtjs/i18n`
- 策略: `no_prefix`（默认英文，其他语言通过检测自动切换）
- 支持语言: 简体中文、繁体中文(台湾/香港)、English、日本語
- 语言检测基于浏览器设置，不使用 Cookie

### 存储后端
- 支持三种存储后端: `local` / `s3` / `openlist`
- 通过 `NUXT_STORAGE_PROVIDER` 环境变量切换
- 存储服务抽象在 `server/services/storage/`

### 上传处理管线
- 上传进入 `pipeline_queue` 表排队处理
- 处理阶段: preprocessing → metadata → thumbnail → exif → reverse-geocoding → live-photo → video
- 队列服务在 `server/services/pipeline-queue/`

### 地图集成
- 支持 Mapbox / MapLibre / AMap（高德）三种地图提供商
- 位置服务支持 Mapbox / Nominatim / AMap 三种提供商
- 相关配置在 `nuxt.config.ts` 的 `runtimeConfig.public.map` 和 `runtimeConfig.location`

### 环境变量
- 详见 `.env.example`，包含完整的配置项说明
- 默认部署不需要传 `.env` 文件或任何环境变量，挂载数据目录即可运行
- 运行时动态配置通过系统设置页面管理

## 代码规范

### Vue 组件
- 使用 `<script setup>` 语法
- `components/ui/` 下的组件使用 `pathPrefix: false`，可直接以组件名引用
- 组合式函数统一放在 `app/composables/`，以 `use` 前缀命名

### TypeScript
- 项目启用了 `no-explicit-any: off`（ESLint），允许适度使用 `any`
- 共享类型放在 `shared/types/`
- 不使用 `as any` 绕过类型检查，应正确推导类型

### Lint
- ESLint + Prettier 自动格式化
- 配置文件: `eslint.config.mjs`（使用 Nuxt 生成的 ESLint 配置）

### API 路由
- 遵循 Nitro 文件路由约定
- 放在 `server/api/` 下，按资源分组
- 请求验证使用 `zod`

### 样式
- 使用 TailwindCSS v4（通过 Vite 插件集成）
- 支持暗色模式（存储键: `cframe-color-mode`）
- 不使用 Google Fonts，字体本地提供

## Docker 部署

```yaml
services:
  chronoframe:
    image: kenv1e/chronoframe-private:latest
    container_name: chronoframe
    restart: unless-stopped
    ports:
      - '3000:3000'
    volumes:
      - ./data:/app/data
```

- 镜像内安装有 exiftool 和 ffmpeg
- 容器启动命令: `node scripts/migrate.mjs && node .output/server/index.mjs`

## 许可

MIT License
