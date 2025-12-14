# ChronoFrame

> 本项目 fork 自 [HoshinoSuzumi/chronoframe](https://github.com/HoshinoSuzumi/chronoframe)，在原项目基础上进行了功能增强和优化，供个人使用。

丝滑的照片展示和管理应用，支持多种图片格式和大尺寸图片渲染。

## 🎯 新增功能

基于原项目，本版本新增了以下功能：

- **高德地图支持** - 新增高德地图作为地图服务提供商，适配国内使用场景
- **相册管理增强**
  - 隐藏相册功能 - 支持将相册设置为隐藏状态
  - 照片分配相册 - 可以将照片批量分配到指定相册
  - 相册上传入口 - 在相册详情和列表页面增加直接上传入口
  - 相册预览优化 - 在相册中打开预览时，仅显示当前相册的照片
- **上传功能优化**
  - 上传组件支持选择目标相册
  - 上传前进行照片已存在检查，避免重复上传
  - 修复上传组件选择相册后无法正确添加照片的问题
- **系统设置** - 新增系统设置页面，方便配置管理
- **照片管理优化** - 优化照片管理和设置页面的交互体验

## ✨ 核心特性

- **在线管理照片** - 通过 Web 界面管理和浏览照片
- **地图探索** - 在地图上浏览照片拍摄位置（支持 Mapbox/MapLibre/高德地图）
- **智能 EXIF 解析** - 自动提取拍摄时间、地理位置、相机参数等元数据
- **多格式支持** - 支持 JPEG、PNG、HEIC/HEIF、MOV(实况照片) 等格式
- **多存储后端** - 支持 S3 兼容存储、本地文件系统
- **技术栈** - Nuxt 4 + TypeScript + TailwindCSS + Drizzle ORM

## 🐳 快速部署

### Docker Compose（推荐）

创建 `docker-compose.yml`：

```yaml
services:
  chronoframe:
    image: ghcr.io/hoshinosuzumi/chronoframe:latest
    container_name: chronoframe
    restart: unless-stopped
    ports:
      - '3000:3000'
    volumes:
      - ./data:/app/data
    env_file:
      - .env
```

创建 `.env` 配置文件（最小化配置）：

```bash
# 管理员配置
CFRAME_ADMIN_EMAIL=your@email.com
CFRAME_ADMIN_PASSWORD=your_password

# 地图服务（可选：maplibre/mapbox/amap）
NUXT_PUBLIC_MAP_PROVIDER=amap
NUXT_PUBLIC_AMAP_KEY=your_amap_key

# 存储配置
NUXT_STORAGE_PROVIDER=local
NUXT_PROVIDER_LOCAL_PATH=/app/data/storage

# 会话密码（32位随机字符串）
NUXT_SESSION_PASSWORD=your_32_char_random_string
```

启动服务：

```bash
docker-compose up -d
```

访问 `http://localhost:3000` 即可使用。

> 完整配置项请参考原项目文档：https://chronoframe.bh8.ga/zh/guide/configuration.html

## 🛠️ 本地开发

```bash
# 安装依赖
pnpm install

# 配置环境变量
cp .env.example .env

# 数据库迁移
pnpm db:migrate

# 启动开发服务器
pnpm dev
```

应用将在 `http://localhost:3000` 启动。

## 📄 许可证

本项目基于 [MIT 许可证](LICENSE) 开源。

## 🙏 致谢

- 原项目：[HoshinoSuzumi/chronoframe](https://github.com/HoshinoSuzumi/chronoframe)
- 技术栈：[Nuxt](https://nuxt.com/) · [TailwindCSS](https://tailwindcss.com/) · [Drizzle ORM](https://orm.drizzle.team/)
