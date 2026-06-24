# XWiki Audit Tools

离线读取旧 XWiki 的 MySQL dump，生成页面清单、作者汇总、空间汇总、附件清单，并初步区分个人内容、系统页面和垃圾页面。

## 输入

默认分析这个文件：

```text
E:\baihepaileiwikiR\backup\baihepailei_data_backup\baihepailei_data.sql.gz
```

## 快速运行：Windows PowerShell

在仓库根目录执行：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

.\tools\xwiki_audit\run_audit_windows.ps1 `
  -BackupDir "E:\baihepaileiwikiR\backup\baihepailei_data_backup" `
  -OutDir "E:\baihepaileiwikiR\backup\baihepailei_audit_out"
```

## 直接运行 Python

```powershell
python .\tools\xwiki_audit\analyze_xwiki_dump.py `
  --dump "E:\baihepaileiwikiR\backup\baihepailei_data_backup\baihepailei_data.sql.gz" `
  --out "E:\baihepaileiwikiR\backup\baihepailei_audit_out" `
  --export-pages
```

## 输出文件

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

## 注意

- 脚本只读取 SQL dump，不修改原始备份。
- 输出目录可能包含旧站正文，默认不应提交到 GitHub。
- 分类结果只是第一轮筛选，`needs_review` 不要直接删除。
