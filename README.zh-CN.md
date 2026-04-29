# codex-web-console

[English](README.md) | [简体中文](README.zh-CN.md)

一个轻量、本地优先的 Codex Web 控制台。

npm 包地址：https://www.npmjs.com/package/codex-web-console

## 当前范围

- 仅本地运行：连接单个本地 `codex app-server`
- 单 token 认证：一个登录输入框，一个访问 token
- 可查看所有本地 provider 下的线程列表
- 线程支持 URL 定位：`/` 打开新线程，`/?thread=<id>` 打开已有线程
- 通过 SSE 接收实时 timeline 更新
- 内置工作区浏览器，用于选择本地目录
- 支持命令、文件变更和权限请求的审批处理
- 轮次控制：停止当前轮次，跳转到上一个/下一个历史轮次

这个项目刻意保持范围很窄。它不会在 Codex 线程之上再实现用户系统、远程服务或第二套会话系统。

## 开发

```sh
bun install
bun run dev
```

## 快速开始

使用 npx 启动控制台：

```sh
npx codex-web-console
```

可选参数：

```sh
npx codex-web-console --host 127.0.0.1 --port 3000 --no-open
```

在当前仓库本地测试：

```sh
bun run build
npx . --no-open
```

## 认证

启动前设置一个访问 token，或者复制 `.env.example` 为 `.env`：

```sh
export CODEX_WEB_CONSOLE_TOKEN=your-token
```

SvelteKit 会在开发环境中自动加载 `.env`。如果 shell 中也导出了同名变量，shell 中的值优先级更高。

登录页只接受这一个 token，并在本地保存已登录 cookie。

开发环境下，如果没有配置该环境变量，会启用一个备用 token：

```text
codex-web-console
```

## 构建

```sh
bun run build
```

## 发布

CI 会在推送到 `main` 以及所有 Pull Request 时执行：

```sh
bun run check
bun run build
```

CD 通过 `semantic-release` 在 `main` 分支自动发布 npm 并创建 GitHub Release。
版本规则遵循 Conventional Commits：

- `feat:` -> 次版本发布
- `fix:` -> 补丁发布
- `perf:` 和 `refactor:` -> 补丁发布
- `feat!:` / `fix!:` / `BREAKING CHANGE:` -> 主版本发布

推送到 `main` 的自动发布默认走 npm Trusted Publishing（OIDC）。
手动执行 `workflow_dispatch` 时，可以选择：

- `oidc`：通过 npm Trusted Publishing 发布
- `npm-token`：通过 GitHub Secret 中的 `NPM_TOKEN` 兜底发布

如果要启用手动 token 发布，需要在 GitHub Actions Secrets 中配置：

```text
NPM_TOKEN
```

这个 npm token 需要对 `codex-web-console` 包具有发布权限。

## 环境要求

- `PATH` 中必须可以访问 Bun
- `PATH` 中必须可以访问 Codex
- UI 会启动并连接一个本地 `codex app-server`
- 非开发环境必须配置访问 token

## 说明

- 线程列表通过 app-server 获取，并传入 `modelProviders: []`，所以侧边栏会包含不同 provider 下的线程。
- 部分 reasoning 内容可以实时显示，但不一定能通过 `thread/read` 完整恢复；为了保持连续性，UI 会在当前浏览器会话中保留这些内容。
- 当前版本专注单机使用路径，并有意保持架构轻薄。
