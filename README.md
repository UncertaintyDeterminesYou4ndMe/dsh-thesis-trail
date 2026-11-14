# dsh-thesis-trail · 循迹

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）里长期跟踪可证伪的投资命题。

一个标的（一家公司或一个资产）下面有几条议题。每条议题是一个可以被证伪的命题，写明什么情况算证伪，再加上多头预期、空头担忧和观察指标。到了你设定的巡检时间，循迹自己调用 DeepSeek API，对每个到期的议题做一次联网研究：搜索、打开网页、核对证伪条件，把新证据、判断（-1 到 +1）和理由写回议题。证伪条件被触发时，议题上会出现提醒，侧栏图标亮红点。

议题是你和 AI 共用的文档：

- 你可以直接改原文，可以选中一句话评论，勾选「让 AI 处理」后 AI 立即研究并回复。
- AI 改你没写过的段落会直接生效，可以一键撤销；想改你写过的段落，只能提建议，等你采纳或拒绝。
- 每次修改、评论和回复都留痕，可以恢复到任意版本。

不需要开 dsh 会话，也不占用 dsh 的定时任务。所有数据在本机一个 SQLite 文件里。

## 安装

需要 dsh ≥ 0.2.2（Node ≥ 24.9）和一个 DeepSeek API key。

官方桌面版（deepseek.com/harness/ 下载）：先打开过一次桌面版并完全退出，再用它自带的命令安装：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add github:UncertaintyDeterminesYou4ndMe/dsh-thesis-trail
```

`dsh web`：

```sh
dsh plugin --profile web add github:UncertaintyDeterminesYou4ndMe/dsh-thesis-trail   # 从 GitHub
dsh plugin --profile web add /path/to/dsh-thesis-trail                              # 或本地目录
```

装好后重新打开 dsh，左侧栏多一个「循迹」图标。

## DeepSeek API key

研究请求直接发给 DeepSeek API，按 DeepSeek 的价格计费。循迹按顺序找 key：

1. dsh 模型设置里保存的 DeepSeek key（和 dsh 用的是同一把）；
2. 环境变量 `DEEPSEEK_API_KEY`；
3. `~/.dsh/.env` 里的一行 `DEEPSEEK_API_KEY=...`。

没有 key 时不会发任何请求，面板顶部会提示。

费用参考（2026-11 实测，每个议题研究一次）：重要性高用深度搜索，约 ¥0.20；中用普通搜索，约 ¥0.05；低只看有没有重大事件，更便宜。查过的议题按重要性隔 1 天、7 天或 30 天再到期，所以十个中等议题的标的平均每天不到一毛钱。面板的「用量」页按天、周、月列出每一次研究的 token、搜索次数和费用。

## 开始用

第一次打开是空的，有两个入口：

- **导入议题文件**：别人分享给你的 `.md` 议题文件。粘贴或选文件，面板会先检查格式，告诉你有几个议题、全部研究一遍大约多少钱，再选巡检频率。
- **新建标的**：从空白开始写议题。

已有的标的可以从页头的标的菜单「导出这个标的」，复制或下载成 `.md` 文件发给别人。导出只包括议题的定义，不包括研究记录、证据、评论和费用。

议题文件格式：

```markdown
# Acme Robotics (ACME)

说明（可省略）。

## 大客户续约
- 重要性：高
- 命题：前十大客户会继续续约。
- 证伪条件：任一前十大客户终止合同，或续约率低于 90%。
- 多头预期：……
- 空头担忧：……
- 观察指标：续约率、新增大客户数
```

每个议题必须有命题和证伪条件。重要性只能是高、中、低，不写就是中。完整说明（巡检规则、重要性、协作规则、费用怎么算）见 [docs/DETAIL.md](docs/DETAIL.md)，插件页里也能看到。

## 在对话里用

dsh 对话里的 AI 能读写同一份库：`trail_brief`（当前状态和待回复事项）、`trail_timeline`（某个议题的证据和改动历史）、`trail_record`（写证据、判断、回复、改议题）。比如：「看一下循迹里 ACME 那几条议题最近的判断，有没有该改证伪条件的」。

## 数据

默认在 `~/.dsh/thesis-trail/trail.db`。要换路径，在 profile 的 `cordis.patch.yml` 里按 id 覆盖：

```yaml
- id: thesis-trail
  name: 'dsh-thesis-trail'
  config:
    database: /absolute/path/trail.db
```

长期运行不会让库一直变大：每个议题只保留最近 6 次研究的完整过程，更早的只留费用和一句结论。

## 已知限制

- dsh 要开着才会巡检。关着时错过的巡检，下次打开时只补一次。
- 还不能删除标的。不想跟的标的先暂停。
- 证据只收这次请求真的搜到或打开过的链接，模型编的链接会被丢掉；但网页内容本身的真假要你自己判断。

## 开发

```sh
npm test    # 宿主逻辑测试：假的 dsh 宿主、假的 DeepSeek，不联网、不读真实 key
```

结构：

```
index.js        宿主：SQLite 存储、定时器、面板 API、trail_* 工具
research.js     一次研究请求：提示词、流式解析、证据链接检查、时间计算
board-file.js   议题文件（Markdown）的导入解析和导出
client.js       面板（React，挂在 dsh 的布局插槽上），不需要构建
test/           测试和测试用的议题文件（虚构公司）
```

## 许可

MIT
