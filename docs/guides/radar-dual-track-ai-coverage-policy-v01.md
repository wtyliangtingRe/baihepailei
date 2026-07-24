# Radar human/AI 双轨与 AI 全覆盖规则 v0.1

状态：规则已锁定；适用于数据模型、研究、公共 AI 结论、窗口展示和搜索展示。

## 1. 双轨完全独立

每个 canonical Work 有两条互不覆盖的评级轨道：

1. canonical human track：`humanAssessment`；
2. current public AI track：`radar-public-conclusions`。

两条轨道分别保存自己的等级、证据、来源、规则、冲突、置信度、覆盖度、评估时间和 provenance。

禁止：

- human 结论覆盖、删除、阻止或使 AI 结论失效；
- AI 结论覆盖、删除或改写 human 结论；
- 因两条轨道意见不一致而隐藏其中一条；
- 把展示优先级误用成存储或发布优先级。

## 2. canonical Work 必须拥有 AI 结论

每个 canonical Work 必须收敛到恰好一条 `current` 公共 AI 结论。

下列情况不能成为“没有 AI 结论”的理由：

- 已存在有效 human track；
- human 与 AI 结论冲突；
- 只有一个可追溯来源；
- 证据覆盖度较低；
- 仍需人工复核；
- Work 当前隐藏、非 active 或未在搜索中展示。

证据不足时，AI 轨道必须明确记录：

- 当前最合理的 grade 与 decisive rule；
- 真实的 `sourceCount`；
- 较低的 confidence / evidence coverage；
- `requiresHumanReview = true`；
- 证据不足、单来源或冲突 warning。

证据不足影响结论强度，不影响 AI 轨道是否存在。

## 3. canonical identity 例外

AI 结论必须绑定 canonical Work identity。

明确的 merge-out、重复源拆分记录或尚未解析的错误 identity 不单独创建第二条 AI 结论。其内容结论归属于 canonical Work。

因此，“每个作品必须有 AI 结论”在数据库层解释为：

```text
每个 canonical Work
→ 恰好一个 current AI conclusion
```

而不是为同一作品的重复记录各写一份公共结论。

## 4. human 优先仅用于展示与搜索

窗口和搜索的派生展示等级按下列顺序选择：

```text
有效 human grade
→ 否则 current AI grade
→ 否则 unknown
```

该顺序只影响：

- Work 详情窗口的主显示等级；
- 搜索卡片的主显示等级；
- 搜索过滤、排序和聚合；
- 旧客户端兼容 `rank` 输出。

该顺序不影响：

- AI 结论生成；
- AI 结论存储或更新；
- AI 研究和补来源；
- human 轨道存储；
- 两条轨道的独立展示。

当 human 和 AI 不一致时，页面应同时展示两条轨道；主显示等级可以采用 human，但 AI 结论仍保持 current、可见且可审计。

## 5. lifecycle 与 visibility

`catalogStatus`、Payload `_status`、lite/full visibility 决定 Work 是否在对应页面或搜索入口展示。

这些字段不决定 AI 结论是否应存在。隐藏或归档 Work 的 AI 结论仍可在独立集合中保存；正常用户界面是否展示该结论，跟随 Work 的可见性规则。

## 6. supersession

同一 canonical Work 的新 AI 结论按锁定的 whole-snapshot 规则更新同一条 current record：

- latest structurally valid identity-resolved snapshot wins；
- whole snapshot replacement；
- explicit null 清空旧值；
- 禁止旧字段残留合并；
- 历史候选和冲突证据继续保留。

human track 不参与 AI supersession 排序。

## 7. 每部作品的外部研究责任

每个 canonical Work 都必须至少完成一次标准化的中文、日文、英文外部研究扫描。没有 Wiki、攻略、长评或社区讨论时，也必须记录已经尝试的语言、查询和来源类别，不能把“搜不到”写成“没有搜索”。

所有作品执行标准扫描；高等级、严重雷点、多路线游戏、版本冲突、男性风险、单来源或身份不稳定作品进入更深的作品级调查。

社区材料只能先转成可验证的剧情事实主张，再参与判断。严重雷点不得仅凭一条模糊论坛短评定案。研究必须同时搜索支持证据、反证和冲突。

完整规则见：

```text
docs/guides/radar-work-level-multilingual-research-policy-v01.md
```

标准扫描尚未完成时，AI 结论可以作为显式低置信度 bootstrap snapshot 存在，但不得标记为研究完成。完成扫描后由新 snapshot supersede；AI 轨道始终不得为空。

## 8. 验收门槛

AI 全覆盖批次只有在以下条件满足时才能结束：

- 每个 canonical Work 已有 current AI 结论，或已进入本次 create/update 集；
- 不存在仅因 human track 而被阻塞的行；
- 不存在仅因单来源或低置信度而缺失 AI 结论的行；
- 非 canonical merge-out 豁免有明确 canonical target；
- human 和 AI 均未被另一轨道改写；
- 展示优先级与存储优先级在报告中明确分离；
- 每部作品的标准扫描状态可追踪，未完成扫描的 bootstrap 结论带明确不确定性和后续 supersession 任务。
