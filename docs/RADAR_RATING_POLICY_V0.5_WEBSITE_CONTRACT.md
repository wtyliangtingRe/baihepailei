# 百合排雷网站 v0.5 展示与兼容合同

状态：**active**。Activation epoch：`radar-rating-policy-v0.5-activation-20260807-01`。运行时激活状态以 `config/radar-policy-status-registry-v05.json` 与其 SHA-256 绑定 activation record 为准；bundle/component 内嵌的 `approved_pending_activation_gates` 保留为组件获批时的冻结 provenance，不再作为运行时状态源。

权威政策：`radar-rating-policy-v0.5`

研究仓库基线：`14a14c27721470e859c56ca871a4f3029b57bb2c`
网站仓库基线：`84ecc074a8ffd6065ace52301954382806a5c990`

## 核心展示

- `fixed_grade`：显示“AI 暂定等级”。
- `bounded_range`：显示“AI 暂定评级范围”，必须同时展示 best / likely / worst；`coreGrade` 只是 likely 的兼容投影。
- `labels_only`：显示研究记录，不显示等级徽章。
- `blocked`：显示尚未完成 AI 评估。

## 加速排雷

设定 profile 不会单独改变核心等级，但有肯定证据时必须在 `加速排雷` group 显示：

- TS / 性别转换设定
- 扶她设定
- ABO 设定
- 男娘 / 女装设定
- 泛 queer 设定
- 核心身份边界

这使没有欺诈、但身份或设定会显著影响偏好的作品，能够保留正常核心评级并同时给出醒目提示。

## X 风险候选

机器不能赋 X。满足研究仓库公开证据门槛的候选可以显示：

> X 风险候选：存在需要人工核验的严重欺诈或恶意风险候选；当前并非 X 评级。

该标签不改变核心等级，必须进入人工优先队列，并在裁决后更新。

## 旧规则

`radar-rating-policy-v0.4-draft`、`radar-public-tag-contract-v01` 与 `D-UNCLEAR` 展示语义在 v0.5 激活后标记为历史过时。历史 release-bound 文件不修改。

本合同不授权数据库迁移、Payload、PostgreSQL 或生产写入。
