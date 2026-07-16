# ADR 001：Agent Runtime 采用单 Node 进程 + SQLite

## 状态

Accepted（2026-07-14）

## 决策

llmlint Web 的 Agent Runtime 明确只支持一个 Node 进程连接本地 `file:` SQLite。`PrismaSessionStore` 在进程内按 Session 串行化 commit，并按 revision/profile 串行化幂等 create。

本版本不提供多进程 lease、跨进程 EventHub、分布式锁或分布式事务。Core snapshot 是恢复真相源；SSE cursor 只在当前 Node 进程 epoch 内可 replay，进程变化时客户端必须重新获取 snapshot。

## 原因

- llmlint 当前部署目标是单机采集站，SQLite 与单 Node 进程符合实际运行形态。
- SQLite 多连接并发写同一 Session 会产生 `SQLITE_BUSY`；进程内 per-session queue 能直接约束当前支持范围。
- 在没有多进程部署需求前引入 lease 和分布式事件基础设施会增加故障模式与维护成本。

## 后果

- 同一数据库不得同时启动两个 llmlint Web Agent 进程。
- 如果未来需要横向扩展，必须先新增独立 ADR，设计数据库 lease、跨进程事件恢复和幂等 observer，再改变部署约束。
