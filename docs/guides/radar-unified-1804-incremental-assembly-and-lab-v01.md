# Radar 1,804 条统一增量 assembly 与隔离存储演练 v0.1

状态：本流程仅生成统一公共 AI 结论输入，并在一次性隔离 PostgreSQL 中完成 apply / acceptance / exact rollback。生产数据库始终只读，尚未生成生产执行授权。

## 输入

流程绑定三个不可变证据包：

- 既有 683 条 storage-normalized assembly；
- 既有 683 条已通过隔离演练的 evidence ZIP；
- 剩余 1,122 条 Phase 2 live closeout，其中 1,121 条为 canonical AI 结论，1 条为明确的 noncanonical merge-out 豁免。

## 统一结果

统一存储输入固定为：

- 683 条既有已接受结论；
- 1,121 条 Phase 2 新结论；
- 共 1,804 个唯一 canonical Work、publicationKey 和 conclusion SHA-256；
- 生产基线 9,000 条；
- 隔离 apply 后 10,804 条；
- exact rollback 后恢复 9,000 条。

noncanonical Work `25561` 不产生第二条 current AI 结论，其 AI 覆盖由 canonical Work `32094` 承担。

## 双轨与证据规则

Human track 与 AI track 独立存储。Human 优先只用于窗口、搜索、过滤、排序与兼容展示，不得阻止 AI 结论创建。

证据不足不允许 AI 轨道为空：

- 单来源结论仍被存储；
- `evidenceStrength = weak`；
- `ratingNotice = insufficient_information`；
- 保留低覆盖、弱来源和暂定判断的复核原因；
- grade 与 decisive rule 不因包装或存储阶段而改变；
- 后续多语言作品级研究以完整新快照 supersede bootstrap 结论。

当前公共 schema 不包含内部状态 `single_traceable_source_ai_conclusion`。统一 assembly 仅在存储表示层将其映射为既有 enum `single_secondary_supported`；原状态保留在 lineage/warning，grade、decisive rule、sourceCount、confidence 与 coverage 均不改变。

## 隔离演练

runner 执行：

1. 对生产 PostgreSQL 做只读 preflight、指纹、sequence 和全部 public 表计数；
2. 创建同窗口 custom-format fresh `pg_dump`；
3. 使用生产 PostgreSQL 镜像启动 `--network none` 一次性容器；
4. 完整恢复 dump；
5. 在隔离库写入 1,804 条公共 AI 结论及其子表；
6. 验证主表、review reasons、matched rules、contradictions、等级分布和 hash；
7. 验证原 9,000 条与全部非 Radar 表未变化；
8. exact rollback 1,804 条并恢复 sequence；
9. 验证隔离库完整回到基线；
10. 删除隔离容器；
11. 再次证明生产库零漂移。

## 安全边界

- 不写 Works；
- 不写 humanAssessment；
- 不通过 Payload 发布草稿；
- 不在生产库执行 assembly apply；
- 生产库仅做只读查询与 `pg_dump`；
- 写入只发生在 `--network none` 隔离恢复库；
- evidence ZIP 不包含完整数据库 dump；
- 完整 dump 仅保留在用户本机忽略目录；
- 本流程不生成 production gate，也不接受自然语言作为生产授权。
