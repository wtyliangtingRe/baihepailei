# 百合雷达公开规则与私有处理边界

## 网站仓库保留什么

`wtyliangtingRe/baihepailei` 只保留面向用户和导入程序的显式契约：

- S / A / B / C / D / E / F / X 的公开含义；
- 各排雷类别的公开名称和解释；
- 警告模板、标签组、标签值和模板 ID；
- 数据库字段、导入校验和前端展示逻辑。

其中以下公开标签契约保持稳定：

| 内部键 | 标签组 | 标签值 | 模板 ID |
|---|---|---|---|
| `staff-small-work` | 排雷协作-站务提示 | 小作品 | `info-insufficient` |
| `accelerated-radar-matching-conflict` | 加速排雷 | 匹配冲突 | `identity-conflict` |
| `relationship-needs-radar` | 关系提示 | 需要排雷 | `needs-radar` |
| `content-unsuitable` | 内容提示 | 不适内容 | `adult-visibility-warning` |

## 网站仓库不再保存什么

以下内容属于私有研究处理规则，应只存在于 `wtyliangtingRe/baihepailei-research-data`：

- 内部检索关键词、正则表达式和触发阈值；
- 证据采用优先级和疑义利益执行细节；
- 身份冲突的加速处理方法；
- 成人内容内部识别信号；
- 批量研究恢复状态、失败记录和审计中间产物；
- 不适合向网站用户公开的研究备注。

## 显式排雷规则仍然公开

`src/lib/radar/ratingPolicy.ts` 和公开警告模板继续作为网站可解释规则存在。把内部处理规则迁出网站仓库，不代表隐藏最终等级含义，也不影响用户查看具体排雷原因。

## 最终公开结果

网站数据库可以公开：

- 最终等级和命中的公开类别；
- 公开提示与标签；
- 可公开的证据摘要和来源链接；
- 评级版本、更新时间和人工审核状态。

内部处理策略、私有证据缓存和自动识别词表不随最终结果公开。
