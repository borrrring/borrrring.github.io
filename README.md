# borrrring的个人博客

基于 [Astro Theme Iris](https://github.com/LemonAdorable/astro-theme-iris) 构建的个人博客与知识管理系统。

访问地址：**[https://borrrring.github.io](https://borrrring.github.io)**

---

## 技术栈

- **框架**: [Astro](https://astro.build/) 6.x
- **主题**: [astro-pure](https://github.com/cworld1/astro-theme-pure) 定制版 Iris
- **全文搜索**: FlexSearch
- **知识图谱**: D3.js
- **双链预览**: Tippy.js
- **评论**: Giscus（GitHub Discussions）
- **包管理**: Bun

## 本地开发

```shell
# 安装依赖
bun install

# 启动开发服务器
bun dev

# 构建
bun run build

# 预览
bun preview
```

## 部署

推送到 `master` 分支后，GitHub Actions 自动构建并部署到 GitHub Pages。

```shell
git push origin master
```

## 配置

主要配置文件：`src/site.config.ts`，可配置站点信息、社交链接、评论系统等。

## 许可证

[Apache 2.0](LICENSE)
