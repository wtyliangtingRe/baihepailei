# XWiki 备份审计计划

本项目用于离线分析旧 AWS XWiki 站点备份，目标是区分个人内容、系统页面、垃圾账号/垃圾页面，并把有价值资料导出，供后续新网站重建使用。

## 数据来源

原始备份只保存在本地，不提交到 GitHub：

```text
E:\baihepaileiwikiR\backup\baihepailei_data_backup
```

核心 SQL dump：

```text
baihepailei_data.sql.gz
```

其他备份包包括：

```text
mysql-data-raw.tar.gz
xwiki-data.tar.gz
docker-containers-config.tar.gz
docker-core-metadata-no-overlay.tar.gz
nginx-config.tar.gz
letsencrypt-config.tar.gz
old-home-opt-root.tar.gz
```

## 已知数据库统计

| 表 | 数量 |
|---|---:|
| xwikidoc | 1645 |
| xwikiattachment | 111 |
| xwikircs | 2439 |
| xwikiobjects | 1383 |
| xwikirecyclebin | 56 |

正文总大小约 4.34 MB。附件总大小约 12.98 MB。

## 安全原则

- 不提交 SQL dump。
- 不提交 MySQL / XWiki 数据卷。
- 不提交 Let's Encrypt 证书和私钥。
- 不提交旧服务器 home/root/opt 目录。
- 不提交 `.env`、私钥、token、数据库密码。
- 分析脚本只读取本地备份，不修改原始文件。

## 分类目标

审计脚本会把页面初步分成四类：

1. `candidate_user_content`：疑似个人内容或有价值资料。
2. `needs_review`：需要人工复查，不能直接丢弃。
3. `candidate_system_page`：XWiki 系统页、配置页、默认页面候选。
4. `candidate_spam_or_junk`：垃圾账号、垃圾链接页、异常短页候选。

## 初步判断依据

### 个人内容候选

- 正文较长。
- 有中文内容。
- 非系统空间。
- 非隐藏页。
- 有附件。
- 页面名不像 XWiki 默认页面。

### 系统页面候选

常见系统空间：

```text
XWiki
Main
Sandbox
Panels
Scheduler
Dashboard
ColorThemes
IconThemes
Help
Tour
AppWithinMinutes
AnnotationCode
```

常见系统页面名：

```text
WebPreferences
WebHome
XWikiPreferences
XWikiServerClass
XWikiUsers
XWikiGroups
```

### 垃圾页面候选

- 作者异常。
- 正文很短但外链很多。
- 含广告、博彩、SEO、药品等关键词。
- 用户页大量随机生成。
- 非中文内容且无明确资料价值。

## 审计输出

计划生成：

```text
xwiki_docs_inventory.csv
xwiki_candidate_user_content.csv
xwiki_needs_review.csv
xwiki_candidate_system_page.csv
xwiki_candidate_spam_or_junk.csv
xwiki_author_summary.csv
xwiki_space_summary.csv
xwiki_attachment_inventory.csv
xwiki_object_class_summary.csv
exported_pages_xwiki_syntax/
```

## 后续步骤

1. 先跑 SQL 审计。
2. 查看作者汇总。
3. 查看空间汇总。
4. 人工复查 candidate 和 needs_review。
5. 再决定是否解析 `xwiki-data.tar.gz` 中的附件实体。
6. 最后将有价值页面转换为 Markdown 或 HTML。
