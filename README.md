# baihepailei

白河排列旧 XWiki 站点恢复、清洗、导出与新网站重建项目。

## 当前目标

1. 离线分析旧 AWS XWiki 备份。
2. 区分个人内容、系统页面、垃圾账号/垃圾页面。
3. 导出有价值资料。
4. 将清洗后的内容迁移到新的静态/动态网站。
5. 最终在本仓库维护新网站代码。

## 原始备份位置

原始备份只保存在本地，不提交到 GitHub：

```text
E:\baihepaileiwikiR\backup\baihepailei_data_backup
```

## 安全原则

- 不提交 SQL dump。
- 不提交 XWiki / MySQL data volume。
- 不提交 Let's Encrypt 证书和私钥。
- 不提交旧服务器 home/root/opt 目录。
- 不提交任何 `.env`、私钥、token、数据库密码。
- 分析脚本只读取本地备份，不修改原始文件。

## 目录规划

```text
docs/       项目说明、迁移记录、安全说明
tools/      备份审计、导出、转换脚本
exports/    本地导出结果，默认不提交
site/       未来新网站代码
infra/      部署模板，不含真实密钥
```

## 运行 XWiki 备份审计

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

.\tools\xwiki_audit\run_audit_windows.ps1 `
  -BackupDir "E:\baihepaileiwikiR\backup\baihepailei_data_backup" `
  -OutDir "E:\baihepaileiwikiR\backup\baihepailei_audit_out"
```

输出会写到本地 `OutDir`，不要直接提交到 GitHub。
