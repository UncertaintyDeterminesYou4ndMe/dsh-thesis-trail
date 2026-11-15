window.__ModuleLoader__.load({
  id: 'dsh-thesis-trail',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } = React
    const h = React.createElement

    const PANEL_ID = 'thesis-trail'
    const API = '/api/thesis-trail'
    const SEEN_EVENT = 'thesis-trail:seen'

    const ZH = {
      panel: '循迹',
      title: '循迹',
      refresh: '刷新',
      runNow: '巡检一次',
      topics: '议题',
      due: '到期',
      week: '本周证据',
      unread: '未读',
      thesis: '命题',
      falsifier: '证伪条件',
      bull: '多头预期',
      bear: '空头担忧',
      metric: '观察指标',
      timeline: '时间线',
      assessments: '判断变化',
      noEvidence: '还没有证据入库。跑一次巡检，或在对话里让 AI 用 trail_record evidence 记录。',
      noAssessment: '还没有评估快照。',
      empty: '还没有议题',
      emptyHint: '写下第一个可证伪的命题：什么结果出现就说明它错了。也可以在对话里让 AI 用 trail_record topic_add 添加。',
      fTitle: '标题',
      fStatus: '状态',
      fImportance: '重要性',
      fMerged: '合并到',
      newTopic: '新议题',
      loadFailed: '数据加载失败',
      retry: '重试',
      loading: '加载中…',
      lastRun: '上次巡检',
      never: '还没跑过',
      nextDue: '下次到期',
      now: '现在',
      openRun: '有一轮巡检没关闭',
      flipped: '判断翻转',
      direction: '方向',
    }
    const EN = {
      panel: 'Thesis Trail',
      title: 'Thesis Trail',
      refresh: 'Refresh',
      runNow: 'Run a pass',
      topics: 'topics',
      due: 'due',
      week: 'new evidence',
      unread: 'unread',
      thesis: 'Thesis',
      falsifier: 'Falsifier',
      bull: 'Bull case',
      bear: 'Bear case',
      metric: 'Signal to watch',
      timeline: 'Timeline',
      assessments: 'Stance changes',
      noEvidence: 'No evidence yet. Run a pass, or ask the Agent to record one with trail_record evidence.',
      noAssessment: 'No stance snapshot yet.',
      empty: 'No topics yet',
      emptyHint: 'Write a falsifiable claim: what outcome would prove it wrong. Or ask the Agent to add one with trail_record topic_add.',
      fTitle: 'Title',
      fStatus: 'Status',
      fImportance: 'Importance',
      fMerged: 'Merged into',
      newTopic: 'New topic',
      loadFailed: 'Could not load the board',
      retry: 'Retry',
      loading: 'Loading…',
      lastRun: 'Last pass',
      never: 'never',
      nextDue: 'Next due',
      now: 'now',
      openRun: 'A pass is still open',
      flipped: 'Stance flipped',
      direction: 'Direction',
    }
    const isZh = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '')
    const t = key => (isZh ? ZH : EN)[key] ?? key

    const STYLE = `
.rb-root{
  --rb-line:color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent);
  --rb-line-strong:color-mix(in srgb,var(--dsw-alias-label-primary) 16%,transparent);
  --rb-fill:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);
  --rb-fill-strong:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);
  --rb-muted:var(--dsw-alias-label-secondary);
  --rb-ink:var(--dsw-alias-label-primary);
  --rb-brand:var(--dsw-alias-brand-primary);
  --rb-ok:var(--dsw-alias-state-success-primary);
  --rb-warn:var(--dsw-alias-state-warn-primary);
  --rb-err:var(--dsw-alias-state-error-primary);
  --rb-idle:var(--dsw-alias-state-idle-primary);
  display:flex;flex-direction:column;height:100%;min-height:0;container-type:inline-size;
  background:var(--dsw-alias-bg-base);color:var(--rb-ink);
  font-size:12.5px;line-height:1.45;-webkit-font-smoothing:antialiased;
}
.rb-root *{box-sizing:border-box}
.rb-num{font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:-.01em}

/* header — one hairline under a single baseline */
.rb-head{display:flex;align-items:center;gap:14px;padding:11px 20px;border-bottom:1px solid var(--rb-line);flex:0 0 auto}
.rb-brand{display:flex;flex-direction:column;min-width:0}
.rb-title{font-size:13.5px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;line-height:1.3}
.rb-sub{font-size:11.5px;color:var(--rb-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.rb-actions{margin-left:auto;display:flex;gap:8px;flex:0 0 auto;align-items:center}
.rb-btn{appearance:none;border:1px solid var(--rb-line-strong);background:transparent;color:var(--rb-ink);font-size:11.5px;font-weight:500;padding:0 11px;height:27px;border-radius:4px;cursor:pointer;font-family:inherit;white-space:nowrap;transition:background-color .12s ease,border-color .12s ease}
.rb-btn:hover{background:var(--rb-fill)}
.rb-btn:disabled{opacity:.45;cursor:default}
.rb-btn.primary{background:var(--rb-brand);border-color:var(--rb-brand);color:var(--dsw-alias-bg-base)}
.rb-btn.primary:hover{background:color-mix(in srgb,var(--rb-brand) 88%,var(--dsw-alias-bg-base))}

/* board picker — the board name is the title; the menu is a hairline box */
.rb-title-row{display:flex;align-items:baseline;gap:3px;min-width:0}
.rb-title-row>.rb-crumb{margin:0 1px 0 3px}
.rb-crumb{color:var(--rb-muted);opacity:.55}
.rb-boardpick{position:relative;min-width:0}
.rb-board-btn{appearance:none;border:0;background:none;margin:0;padding:0 3px;font:inherit;font-size:13.5px;font-weight:600;letter-spacing:-.01em;line-height:1.3;color:var(--rb-ink);cursor:pointer;display:inline-flex;align-items:center;gap:5px;border-radius:3px;max-width:100%}
.rb-board-btn:hover{background:var(--rb-fill)}
.rb-board-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rb-chev{flex:0 0 auto;color:var(--rb-muted)}
.rb-menu{position:absolute;z-index:20;top:calc(100% + 6px);left:-10px;width:330px;max-width:calc(100cqw - 24px);background:var(--dsw-alias-bg-base);border:1px solid var(--rb-line-strong);border-radius:4px;padding:4px 0}
.rb-menu-item{display:flex;flex-direction:column;gap:2px;width:100%;appearance:none;border:0;border-left:2px solid transparent;background:none;text-align:left;font-family:inherit;color:var(--rb-ink);padding:7px 12px 8px 10px;cursor:pointer}
.rb-menu-item:hover{background:var(--rb-fill)}
.rb-menu-item.on{border-left-color:var(--rb-brand);background:var(--rb-fill)}
.rb-menu-title{font-size:12.5px;font-weight:500}
.rb-menu-meta{display:flex;flex-wrap:wrap;gap:5px;font-size:10.5px;color:var(--rb-muted);font-variant-numeric:tabular-nums}
.rb-menu-meta .warn{color:var(--rb-warn)}
.rb-menu-foot{border-top:1px solid var(--rb-line);margin-top:4px;padding:8px 12px 4px;font-size:11.5px}

/* cadence control — one bordered group: mode | days | time */
.rb-sched{display:flex;align-items:stretch;height:27px;border:1px solid var(--rb-line-strong);border-radius:4px;flex:0 0 auto;margin-right:6px}
.rb-form .rb-sched{display:inline-flex;margin-right:0}
.rb-sched-pick{position:relative;display:inline-flex;align-items:stretch}
.rb-sched-pick .rb-chev{position:absolute;right:7px;top:50%;margin-top:-4.5px;pointer-events:none}
.rb-sched-mode{appearance:none;-webkit-appearance:none;border:0;background:transparent;color:var(--rb-ink);font-family:inherit;font-size:11.5px;padding:0 21px 0 9px;cursor:pointer;border-radius:4px}
.rb-sched-mode option{color:initial}
.rb-days{display:flex;align-items:center;gap:1px;padding:0 4px;border-left:1px solid var(--rb-line)}
.rb-days button{appearance:none;border:0;background:none;font-family:inherit;font-size:11px;color:var(--rb-muted);min-width:20px;height:19px;padding:0 2px;border-radius:3px;cursor:pointer}
.rb-days button:hover{color:var(--rb-ink);background:var(--rb-fill)}
.rb-days button.on{color:var(--rb-brand);font-weight:600;background:var(--rb-fill-strong)}
.rb-sched-time{appearance:none;border:0;border-left:1px solid var(--rb-line);background:transparent;color:var(--rb-ink);font-family:inherit;font-size:11.5px;font-variant-numeric:tabular-nums;padding:0 6px 0 8px;width:86px;min-width:0;cursor:pointer;letter-spacing:.01em}
.rb-sched-time::-webkit-datetime-edit{padding:0}
.rb-sched-time::-webkit-datetime-edit-fields-wrapper{padding:0}
.rb-sched-time::-webkit-calendar-picker-indicator{opacity:.4;cursor:pointer;width:12px;padding:0;margin:0 0 0 2px}
.rb-btn.on{background:var(--rb-fill-strong);border-color:var(--rb-muted)}

/* usage — tiles on hairlines, one-hue bars, plain tables */
.rb-body.rb-body-one{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr)}
.rb-usage{flex:1 1 auto;min-height:0;overflow:auto;padding:20px 28px 40px}
.rb-usage-in{max-width:980px;margin:0 auto}
.rb-usage-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rb-usage-head .grow{flex:1 1 auto}
.rb-usage-filter{height:27px;border:1px solid var(--rb-line-strong);border-radius:4px}
.rb-usage-warn{margin:10px 0 0;font-size:11.5px;color:var(--rb-warn)}
.rb-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin-top:16px;border-top:1px solid var(--rb-line);border-bottom:1px solid var(--rb-line)}
.rb-tile{padding:12px 14px 13px;border-left:1px solid var(--rb-line);min-width:0}
.rb-tile:first-child{border-left:0;padding-left:0}
.rb-tile-k{font-size:11px;color:var(--rb-muted)}
.rb-tile-v{font-size:22px;font-weight:600;letter-spacing:-.02em;line-height:1.25;margin-top:3px;white-space:nowrap}
.rb-tile-n{font-size:10.5px;color:var(--rb-muted);margin-top:3px}
.rb-sec h3::after{order:1}
.rb-seg{order:2;display:inline-flex;border:1px solid var(--rb-line-strong);border-radius:4px;overflow:hidden;font-weight:400}
.rb-seg button{appearance:none;border:0;background:none;font-family:inherit;font-size:10.5px;color:var(--rb-muted);padding:2px 10px;cursor:pointer}
.rb-seg button+button{border-left:1px solid var(--rb-line)}
.rb-seg button.on{color:var(--rb-ink);font-weight:600;background:var(--rb-fill-strong)}
.rb-chart-wrap{margin-top:12px;padding-left:50px}
.rb-chart{position:relative;height:150px}
.rb-chart-grid{position:absolute;left:0;right:0;height:0;border-top:1px dashed var(--rb-line)}
.rb-chart-grid:nth-child(3){border-top:1px solid var(--rb-line-strong)}
.rb-chart-y{position:absolute;right:calc(100% + 8px);top:-7px;font-size:10px;line-height:1.3;color:var(--rb-muted);white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.rb-chart-bars{position:absolute;inset:0;display:flex;align-items:stretch;gap:2px}
.rb-chart-col{flex:1 1 0;min-width:0;display:flex;align-items:flex-end;justify-content:center;border-radius:2px;outline:none}
.rb-chart-col.on{background:var(--rb-fill)}
.rb-chart-col:focus-visible{outline:2px solid var(--rb-brand);outline-offset:-2px}
.rb-chart-bar{width:min(64%,16px);background:var(--rb-brand);border-radius:2px 2px 0 0}
.rb-chart-x{display:flex;gap:2px;margin-top:5px}
.rb-chart-x span{flex:1 1 0;min-width:0;text-align:center;font-size:10px;color:var(--rb-muted);white-space:nowrap;overflow:visible;font-variant-numeric:tabular-nums}
.rb-tip{position:absolute;top:2px;z-index:3;pointer-events:none;background:var(--dsw-alias-bg-base);border:1px solid var(--rb-line-strong);border-radius:4px;padding:6px 9px;font-size:11px;line-height:1.5;white-space:nowrap;font-variant-numeric:tabular-nums}
.rb-tip-head{font-size:10.5px;color:var(--rb-muted)}
.rb-tip b{font-weight:600}
.rb-table-wrap{overflow-x:auto;margin-top:2px}
.rb-table{width:100%;border-collapse:collapse;font-size:11.5px;font-variant-numeric:tabular-nums}
.rb-table th{font-weight:500;font-size:10.5px;color:var(--rb-muted);text-align:left;padding:8px 12px 6px 0;border-bottom:1px solid var(--rb-line-strong);white-space:nowrap}
.rb-table td{padding:7px 12px 7px 0;border-bottom:1px solid var(--rb-line);vertical-align:baseline}
.rb-table th:last-child,.rb-table td:last-child{padding-right:0}
.rb-table .n{text-align:right;white-space:nowrap}
.rb-table .muted,.rb-table .muted *{color:var(--rb-muted)}
.rb-table .warn{color:var(--rb-warn)}
.rb-table .nowrap{white-space:nowrap}
.rb-table tr.on td:first-child{font-weight:600}
.rb-usage-what{max-width:360px;min-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--rb-muted)}
.rb-usage-note{margin:22px 0 0;max-width:760px;font-size:10.5px;line-height:1.65;color:var(--rb-muted)}
.rb-usage-note a{color:inherit;text-decoration:underline;text-underline-offset:2px}

/* body */
.rb-body{display:grid;grid-template-columns:300px minmax(0,1fr);flex:1 1 auto;min-height:0}
.rb-list{overflow:auto;border-right:1px solid var(--rb-line);padding:2px 0 16px}
.rb-list-head{display:flex;align-items:baseline;justify-content:space-between;padding:10px 16px 5px;font-size:10.5px;font-weight:500;color:var(--rb-muted)}
.rb-row{position:relative;display:block;padding:8px 16px 9px 14px;border-left:2px solid transparent;cursor:pointer;transition:background-color .1s ease,border-color .1s ease}
.rb-row:hover{background:var(--rb-fill)}
.rb-row.on{background:var(--rb-fill);border-left-color:var(--rb-brand)}
.rb-row.dim{opacity:.55}
.rb-row-top{display:flex;align-items:baseline;gap:8px}
.rb-row-title{flex:1 1 auto;min-width:0;font-size:12.5px;font-weight:500;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.rb-row-unread{flex:0 0 auto;font-size:10.5px;font-weight:600;color:var(--rb-brand)}
.rb-row-meta{display:flex;align-items:baseline;gap:6px;margin-top:5px;font-size:10.5px;color:var(--rb-muted)}
.rb-row-stance{font-weight:600}
.rb-row-imp{font-weight:600;color:var(--rb-ink)}
.rb-row-imp.low{font-weight:400;color:var(--rb-muted)}
.rb-sep{opacity:.45}

/* detail — reads like a memo: hairlines and type scale, no boxes */
.rb-detail{display:flex;min-width:0;min-height:0;overflow:hidden}
.rb-doc{flex:1 1 auto;min-width:0;min-height:0;overflow:auto;padding:20px 28px 40px}
.rb-doc-in{position:relative;max-width:760px;margin:0 auto}
.rb-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;height:100%;color:var(--rb-muted);text-align:center;padding:36px}
.rb-empty h3{margin:0;font-size:13px;font-weight:600;color:var(--rb-ink)}
.rb-empty p{margin:0;font-size:12px;max-width:340px;line-height:1.6}
.rb-empty .rb-btn{margin-top:10px}

.rb-dhead{display:flex;align-items:flex-start;gap:16px}
.rb-dtitle{font-size:17px;font-weight:600;letter-spacing:-.01em;line-height:1.35;margin:0}
.rb-dmeta{display:flex;align-items:baseline;gap:6px;margin-top:6px;font-size:11px;color:var(--rb-muted);flex-wrap:wrap;font-variant-numeric:tabular-nums}
.rb-dmeta .warn{color:var(--rb-warn)}
.rb-stance-box{margin-left:auto;text-align:right;flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-end;gap:5px}
.rb-stance-val{font-size:26px;font-weight:600;line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.rb-stance-cap{font-size:10.5px;color:var(--rb-muted)}

.rb-fields{margin-top:14px}
.rb-field{padding:12px 0 14px;border-top:1px solid var(--rb-line);min-width:0}
.rb-field h4{display:flex;align-items:baseline;gap:8px;margin:0 0 4px;font-size:11px;font-weight:500;color:var(--rb-muted)}
.rb-field.falsifier h4>span{color:var(--rb-err)}
.rb-more{appearance:none;border:0;background:none;color:var(--rb-brand);font-family:inherit;font-size:11px;padding:2px 0 0;cursor:pointer}
.rb-more:hover{text-decoration:underline;text-underline-offset:2px}

.rb-sec{margin-top:24px}
.rb-sec h3{margin:0 0 4px;font-size:11px;font-weight:500;color:var(--rb-muted);display:flex;align-items:center;gap:10px}
.rb-sec h3::after{content:'';flex:1 1 auto;height:1px;background:var(--rb-line)}
.rb-sec h3 span{font-weight:400;opacity:.85;font-variant-numeric:tabular-nums}

/* sparkline — ticks on the right rail, zero line dashed, ±1 dotted */
.rb-spark-wrap{display:flex;gap:10px;margin-top:6px;align-items:flex-start}
.rb-spark-main{flex:1 1 auto;min-width:0}
.rb-spark{display:block;width:100%;height:56px}
.rb-spark-axis{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-top:4px;font-size:10px;color:var(--rb-muted);font-variant-numeric:tabular-nums}
.rb-spark-span{opacity:.8}
.rb-spark-y{position:relative;flex:0 0 18px;height:56px;font-size:9px;color:var(--rb-muted);font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.rb-spark-y span{position:absolute;right:0;transform:translateY(-50%)}

/* timeline — date gutter, 1px rail, hairline between rows */
.rb-tl{margin-top:2px}
.rb-ev{display:grid;grid-template-columns:56px minmax(0,1fr);gap:12px;padding:11px 0;border-bottom:1px solid var(--rb-line);position:relative}
.rb-ev::before{content:'';position:absolute;left:61px;top:0;bottom:0;width:1px;background:var(--rb-line)}
.rb-ev::after{content:'';position:absolute;left:59px;top:15px;width:5px;height:5px;border-radius:50%;background:var(--rb-line-strong)}
.rb-ev:last-child{border-bottom:0}
.rb-ev>div:last-child{padding-left:11px;min-width:0}
.rb-ev-when{font-size:10.5px;color:var(--rb-muted);padding-top:1px;font-variant-numeric:tabular-nums;line-height:1.4}
.rb-ev-date{font-weight:600;color:var(--rb-ink)}
.rb-ev-clock{opacity:.75;margin-top:1px}
.rb-ev-title{font-size:12.5px;font-weight:500;line-height:1.45;color:var(--rb-ink);text-decoration:none}
a.rb-ev-title:hover{text-decoration:underline;text-underline-offset:2px}
.rb-ev-meta{display:flex;align-items:baseline;gap:6px;margin-top:4px;font-size:10.5px;color:var(--rb-muted);flex-wrap:wrap}
.rb-ev-dir{font-weight:500}
.rb-ev-dir.up{color:var(--rb-ok)}
.rb-ev-dir.down{color:var(--rb-err)}
.rb-ev-spacer{margin-left:auto}
.rb-ev-sum{margin-top:4px;font-size:11.5px;line-height:1.55;color:var(--rb-muted)}

.rb-copy{appearance:none;border:0;background:none;color:var(--rb-muted);font-family:inherit;font-size:10.5px;padding:0;cursor:pointer;opacity:0;white-space:nowrap;transition:opacity .12s ease,color .12s ease}
.rb-ev:hover .rb-copy,.rb-copy:focus-visible,.rb-copy.copied{opacity:1}
.rb-copy:hover{color:var(--rb-ink);text-decoration:underline;text-underline-offset:2px}
.rb-copy.copied{color:var(--rb-ok)}

.rb-loadmore{appearance:none;border:0;background:none;width:100%;padding:9px 0;text-align:center;color:var(--rb-muted);font-family:inherit;font-size:11.5px;cursor:pointer;transition:color .12s ease}
.rb-loadmore:hover{color:var(--rb-ink);text-decoration:underline;text-underline-offset:2px}

.rb-filter{display:flex;align-items:center;gap:7px;margin:2px 8px 6px;padding:0 9px;height:26px;border:1px solid var(--rb-line);border-radius:4px;transition:border-color .12s ease}
.rb-filter:focus-within{border-color:var(--rb-line-strong)}
.rb-filter input{appearance:none;border:0;background:transparent;color:var(--rb-ink);font-family:inherit;font-size:11.5px;width:100%;min-width:0;padding:0;outline:none}
.rb-filter input::placeholder{color:var(--rb-muted);opacity:.8}
.rb-filter svg{flex:0 0 auto;opacity:.45}

.rb-gap{display:flex;align-items:center;gap:9px;padding:7px 0;font-size:10px;color:var(--rb-muted);font-variant-numeric:tabular-nums}
.rb-gap::before,.rb-gap::after{content:'';height:1px;flex:1 1 auto;background:var(--rb-line)}
.rb-gap::before{flex:0 0 56px;max-width:56px}

.rb-asm{display:grid;grid-template-columns:56px minmax(0,1fr);gap:12px;padding:10px 0;border-bottom:1px solid var(--rb-line)}
.rb-asm:last-child{border-bottom:0}
.rb-asm-line{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.rb-asm-stance{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
.rb-asm-flip{font-size:10.5px;font-weight:500;color:var(--rb-warn)}
.rb-asm-why{font-size:11.5px;line-height:1.55;color:var(--rb-muted);margin-top:3px}
.rb-rs{display:grid;grid-template-columns:56px minmax(0,1fr);gap:12px;padding:10px 0;border-bottom:1px solid var(--rb-line)}
.rb-rs:last-child{border-bottom:0}
.rb-rs-meta{font-size:10.5px;color:var(--rb-muted);font-variant-numeric:tabular-nums}
.rb-rs-sum{font-size:12px;line-height:1.6;margin-top:3px}
.rb-rs-err{font-size:11.5px;color:var(--rb-warn);margin-top:3px}
.rb-rs details{margin-top:4px;font-size:11px;color:var(--rb-muted)}
.rb-rs summary{cursor:pointer;list-style:none;display:inline}
.rb-rs summary::-webkit-details-marker{display:none}
.rb-rs summary:hover{color:var(--rb-ink)}
.rb-rs ul{margin:4px 0 0;padding:0 0 0 14px;line-height:1.6}
.rb-rs li{word-break:break-all}
.rb-rs a{color:inherit;text-decoration:underline;text-underline-offset:2px}
.rb-rs-answer{margin:6px 0 0;white-space:pre-wrap;line-height:1.65;color:var(--rb-ink);font-size:11.5px;max-height:320px;overflow:auto;border-left:1px solid var(--rb-line);padding-left:10px}

.rb-foot{display:flex;align-items:center;gap:8px;padding:7px 20px;border-top:1px solid var(--rb-line);font-size:10.5px;color:var(--rb-muted);flex:0 0 auto;font-variant-numeric:tabular-nums}
.rb-foot .sep{opacity:.4}
.rb-foot .grow{flex:1 1 auto}
/* Counters keep their line; the long notice and pass summary give way first. */
.rb-foot>span{white-space:nowrap;flex:0 0 auto}
.rb-foot>span.rb-foot-fit{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
.rb-foot>span.rb-foot-sum{max-width:420px}
.rb-foot .warn{color:var(--rb-warn)}
.rb-foot .err{color:var(--rb-err)}
.rb-table td.err{color:var(--rb-err)}

.rb-badge-wrap{position:relative;display:inline-flex;align-items:center;justify-content:center}
.rb-badge-num{position:absolute;top:-5px;right:-8px;min-width:14px;height:13px;padding:0 3px;border-radius:3px;background:var(--rb-brand);color:var(--dsw-alias-bg-base);font-size:9px;line-height:13px;text-align:center;font-variant-numeric:tabular-nums;font-weight:600}
.rb-badge-dot{position:absolute;top:-1px;right:-3px;width:6px;height:6px;border-radius:50%;background:var(--rb-err)}
.rb-error{display:flex;align-items:center;gap:10px;font-size:11.5px;color:var(--rb-err);padding:9px 12px;border:1px solid color-mix(in srgb,var(--rb-err) 30%,transparent);border-radius:4px;background:color-mix(in srgb,var(--rb-err) 5%,transparent);margin:14px 20px}

.rb-row:focus-visible,.rb-btn:focus-visible,.rb-loadmore:focus-visible,.rb-copy:focus-visible,.rb-more:focus-visible,.rb-sched-mode:focus-visible,.rb-days button:focus-visible,.rb-board-btn:focus-visible,.rb-menu-item:focus-visible,.rb-seg button:focus-visible,.rb-link:focus-visible,.rb-tab:focus-visible,.rb-quote:focus-visible,.rb-owner:focus-visible,.rb-subtabs button:focus-visible,.rb-bubble:focus-visible{outline:2px solid var(--rb-brand);outline-offset:1px}
.rb-text:focus-visible,.rb-status:focus-visible{outline:2px solid var(--rb-brand);outline-offset:2px}
.rb-sched-time:focus-visible{outline:2px solid var(--rb-brand);outline-offset:-1px;border-radius:2px}
a.rb-ev-title:focus-visible{outline:2px solid var(--rb-brand);outline-offset:2px;border-radius:2px}

.rb-list::-webkit-scrollbar,.rb-detail::-webkit-scrollbar,.rb-doc::-webkit-scrollbar,.rb-rail-body::-webkit-scrollbar{width:10px;height:10px}
.rb-list::-webkit-scrollbar-thumb,.rb-detail::-webkit-scrollbar-thumb,.rb-doc::-webkit-scrollbar-thumb,.rb-rail-body::-webkit-scrollbar-thumb{background:var(--rb-line-strong);border-radius:4px;border:3px solid transparent;background-clip:content-box}
.rb-list::-webkit-scrollbar-thumb:hover,.rb-detail::-webkit-scrollbar-thumb:hover,.rb-doc::-webkit-scrollbar-thumb:hover,.rb-rail-body::-webkit-scrollbar-thumb:hover{background:var(--rb-muted);border:3px solid transparent;background-clip:content-box}
.rb-list::-webkit-scrollbar-track,.rb-detail::-webkit-scrollbar-track,.rb-doc::-webkit-scrollbar-track,.rb-rail-body::-webkit-scrollbar-track{background:transparent}

.rb-skel{border-radius:3px;background:var(--rb-fill)}

/* shared — a text button that reads as a link, and a smaller button */
.rb-link{appearance:none;border:0;background:none;padding:0;font:inherit;color:var(--rb-ink);cursor:pointer;text-decoration:underline;text-decoration-color:var(--rb-line-strong);text-underline-offset:2px}
.rb-link:hover{text-decoration-color:currentColor}
.rb-btn.sm{height:24px;padding:0 9px;font-size:11px}
.rb-list-tools{display:flex;align-items:baseline;gap:10px}
.rb-row-flag{font-weight:600;color:var(--rb-ink)}
.rb-row-flag.quiet{font-weight:400;color:var(--rb-muted)}
.rb-row-flag.err{color:var(--rb-err)}
.rb-owner{appearance:none;border:0;background:none;padding:0;font:inherit;font-weight:400;color:var(--rb-muted);cursor:pointer}
.rb-owner:hover{color:var(--rb-ink);text-decoration:underline;text-underline-offset:2px}

/* topic form — labelled rows on hairlines, like the memo it edits */
.rb-form{margin-top:16px}
.rb-form-lead{margin:6px 0 0;font-size:12px;line-height:1.6;color:var(--rb-muted)}
.rb-form-row{padding:10px 0 11px;border-top:1px solid var(--rb-line)}
.rb-form-row>label,.rb-form-row>.rb-form-label{display:block;margin:0 0 6px;font-size:11px;font-weight:500;color:var(--rb-muted)}
.rb-opt{font-weight:400;opacity:.75}
.rb-input{display:block;width:100%;appearance:none;border:1px solid var(--rb-line-strong);border-radius:4px;background:transparent;color:var(--rb-ink);font-family:inherit;font-size:12.5px;line-height:1.6;padding:6px 9px;resize:vertical;field-sizing:content;min-height:32px;max-height:260px;transition:border-color .12s ease}
.rb-input:focus{outline:none;border-color:var(--rb-muted)}
.rb-input::placeholder{color:var(--rb-muted);opacity:.75}
.rb-form-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding-top:12px;border-top:1px solid var(--rb-line)}
.rb-form-msg{font-size:11.5px;line-height:1.5;color:var(--rb-err)}
.rb-form-hint{font-size:10.5px;color:var(--rb-muted)}
.rb-imp-seg button{font-size:11.5px;padding:3px 14px}
.rb-form-note{margin:6px 0 0;font-size:11px;line-height:1.6;color:var(--rb-muted)}
.rb-ink{color:var(--rb-ink);font-weight:500}
.rb-mono-input{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:1.6;max-height:420px}
.rb-problems{margin:8px 0 0;padding-left:16px;font-size:11.5px;line-height:1.6;color:var(--rb-err)}

/* first run — what this is, the key, two ways in */
.rb-welcome{max-width:620px;margin:0 auto;padding:12vh 0 40px}
.rb-keyline{margin:14px 0 0;padding:8px 0;border-top:1px solid var(--rb-line);border-bottom:1px solid var(--rb-line);font-size:12px;line-height:1.6;color:var(--rb-muted)}
.rb-keyline.warn{color:var(--rb-warn)}
.rb-choices{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:18px}
.rb-choice{display:flex;flex-direction:column;gap:4px;appearance:none;text-align:left;font-family:inherit;color:var(--rb-ink);background:transparent;border:1px solid var(--rb-line-strong);border-radius:4px;padding:12px 14px;cursor:pointer;transition:border-color .12s ease,background-color .12s ease}
.rb-choice:hover{border-color:var(--rb-muted);background:var(--rb-fill)}
.rb-choice-title{font-size:13px;font-weight:600}
.rb-choice-text{font-size:11.5px;line-height:1.5;color:var(--rb-muted)}
.rb-keybar{padding:7px 20px;border-bottom:1px solid var(--rb-line);font-size:11.5px;line-height:1.55;color:var(--rb-warn);flex:0 0 auto}
.rb-menu-foot{display:flex;gap:14px}
.rb-srcs{display:grid;gap:7px;margin-top:2px}
.rb-src{display:grid;grid-template-columns:auto 1fr;column-gap:8px;align-items:baseline;font-size:12px;color:var(--rb-ink);cursor:pointer}
.rb-src input{margin:0;accent-color:var(--rb-brand)}
.rb-src-desc{grid-column:2;font-size:11px;line-height:1.5;color:var(--rb-muted)}
.rb-srcline{font-size:11.5px;color:var(--rb-muted);margin-top:1px;padding:0;border:0;background:none;cursor:pointer;text-align:left}
.rb-srcline:hover{color:var(--rb-ink);text-decoration:underline}

/* passages — the text is the editor: hover tints it, a click edits in place */
.rb-text{margin:0 -6px;padding:2px 6px;border-radius:3px;font-size:13px;line-height:1.72;white-space:pre-wrap;overflow-wrap:anywhere;cursor:text;transition:background-color .12s ease}
.rb-text:hover{background:var(--rb-fill)}
.rb-text.rb-dtitle{font-size:17px;line-height:1.4}
.rb-placeholder{color:var(--rb-muted)}
.rb-edit{display:block;width:calc(100% + 12px);margin:0 -6px;padding:2px 6px;appearance:none;border:0;border-radius:3px;background:var(--rb-fill-strong);color:var(--rb-ink);font-family:inherit;font-size:13px;line-height:1.72;resize:none;field-sizing:content;min-height:1.72em;outline:none}
.rb-edit.heading{font-size:17px;font-weight:600;letter-spacing:-.01em;line-height:1.4}
.rb-edit-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px;font-size:10.5px;color:var(--rb-muted)}
.rb-conflict{margin-top:8px;padding:2px 0 2px 10px;border-left:2px solid var(--rb-warn);font-size:11.5px;line-height:1.55;color:var(--rb-muted)}
.rb-conflict-text{margin-top:3px;color:var(--rb-ink);white-space:pre-wrap}

/* comment highlights and tracked changes */
.rb-hl{background:color-mix(in srgb,var(--rb-warn) 20%,transparent);color:inherit;border-radius:2px;cursor:pointer}
.rb-hl.on{background:color-mix(in srgb,var(--rb-warn) 40%,transparent)}
.rb-del{color:var(--rb-err);text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--rb-err) 65%,transparent);background:color-mix(in srgb,var(--rb-err) 7%,transparent)}
.rb-ins{color:var(--rb-ok);text-decoration:underline;text-underline-offset:3px;background:color-mix(in srgb,var(--rb-ok) 9%,transparent)}
.rb-sugg{margin-top:8px;padding:2px 0 2px 10px;border-left:2px solid var(--rb-warn);font-size:11.5px;line-height:1.55}
.rb-sugg-head{color:var(--rb-muted)}
.rb-sugg-head b{color:var(--rb-ink);font-weight:600}
.rb-sugg-why{margin-top:3px;color:var(--rb-muted);white-space:pre-wrap}
.rb-sugg-acts{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}
.rb-sugg-acts.col{flex-direction:column;align-items:stretch}
.rb-sugg.falsified{border-left-color:var(--rb-err)}
.rb-dhead+.rb-sugg{margin-top:12px}

.rb-status{appearance:none;border:0;background:none;padding:0;font:inherit;color:inherit;cursor:pointer;text-decoration:underline;text-decoration-color:var(--rb-line-strong);text-underline-offset:2px}
.rb-status:hover{color:var(--rb-ink)}
.rb-tocomments{display:none}
.rb-live{color:var(--rb-brand);font-weight:500}

/* selection — a small button, then a comment box; 1px borders, no shadow */
.rb-bubble{position:absolute;z-index:5;appearance:none;border:1px solid var(--rb-line-strong);border-radius:4px;background:var(--dsw-alias-bg-base);color:var(--rb-ink);font-family:inherit;font-size:11.5px;font-weight:500;height:26px;padding:0 10px;cursor:pointer}
.rb-bubble:hover{background:var(--rb-fill-strong)}
.rb-pop{position:absolute;z-index:6;width:300px;max-width:100%;display:flex;flex-direction:column;gap:8px;padding:10px;background:var(--dsw-alias-bg-base);border:1px solid var(--rb-line-strong);border-radius:4px}
.rb-pop-quote{padding-left:8px;border-left:2px solid color-mix(in srgb,var(--rb-warn) 60%,transparent);font-size:11.5px;line-height:1.5;color:var(--rb-muted);overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}
.rb-pop-quote span{display:block;font-size:10.5px}
.rb-pop-acts{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.rb-check{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--rb-muted);cursor:pointer;user-select:none}
.rb-check input{margin:0;accent-color:var(--rb-brand)}

/* rail — comments and history beside the text */
.rb-rail{flex:0 0 300px;min-width:0;min-height:0;display:flex;flex-direction:column;border-left:1px solid var(--rb-line)}
.rb-tabs{display:flex;gap:18px;padding:0 16px;border-bottom:1px solid var(--rb-line);flex:0 0 auto}
.rb-tab{appearance:none;border:0;border-bottom:2px solid transparent;background:none;font-family:inherit;font-size:11.5px;color:var(--rb-muted);padding:11px 0 8px;margin-bottom:-1px;cursor:pointer}
.rb-tab:hover{color:var(--rb-ink)}
.rb-tab.on{color:var(--rb-ink);font-weight:600;border-bottom-color:var(--rb-brand)}
.rb-rail-body{flex:1 1 auto;min-height:0;overflow:auto;padding:10px 16px 28px}
.rb-rail-lead{margin:2px 0 6px;font-size:11px;line-height:1.55;color:var(--rb-muted)}
.rb-rail-empty{margin:10px 0;font-size:11.5px;line-height:1.6;color:var(--rb-muted)}
.rb-compose{display:flex;flex-direction:column;gap:7px;margin:4px 0 8px}
.rb-compose-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rb-subtabs{display:flex;gap:14px;padding:6px 0 2px;border-bottom:1px solid var(--rb-line)}
.rb-subtabs button{appearance:none;border:0;background:none;padding:2px 0 6px;font-family:inherit;font-size:11px;color:var(--rb-muted);cursor:pointer}
.rb-subtabs button.on{color:var(--rb-ink);font-weight:600}
.rb-thread{margin-left:-10px;padding:11px 0 12px 8px;border-left:2px solid transparent;border-bottom:1px solid var(--rb-line);cursor:default}
.rb-thread.on{border-left-color:var(--rb-brand)}
.rb-thread.done{opacity:.75}
.rb-quote{display:block;width:100%;appearance:none;border:0;border-left:2px solid color-mix(in srgb,var(--rb-warn) 60%,transparent);background:none;text-align:left;font-family:inherit;padding:0 0 0 8px;margin-bottom:7px;color:var(--rb-muted);cursor:pointer}
.rb-quote:hover .rb-quote-t{color:var(--rb-ink)}
.rb-quote-k{display:block;font-size:10.5px}
.rb-quote-t{font-size:11.5px;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.rb-msg{margin-top:6px}
.rb-msg:first-of-type{margin-top:0}
.rb-msg.reply{margin-top:8px;margin-left:2px;padding-left:9px;border-left:1px solid var(--rb-line)}
.rb-msg-head{font-size:10.5px;color:var(--rb-muted)}
.rb-msg-head b{color:var(--rb-ink);font-weight:600}
.rb-msg-body{margin-top:2px;font-size:12px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
.rb-thread-foot{display:flex;align-items:baseline;gap:10px;margin-top:8px;font-size:10.5px;color:var(--rb-muted)}
.rb-thread-foot .warn{color:var(--rb-warn)}
.rb-thread-foot .grow{flex:1 1 auto}
.rb-thread-foot .rb-link{color:var(--rb-muted)}
.rb-thread-foot .rb-link:hover{color:var(--rb-ink)}
.rb-thread .rb-compose{margin:8px 0 0}
.rb-ver{padding:10px 0 11px;border-bottom:1px solid var(--rb-line)}
.rb-ver-head{font-size:12px;line-height:1.5;font-weight:500}
.rb-ver-tag{font-weight:400;color:var(--rb-muted)}
.rb-ver-tag.warn{color:var(--rb-warn)}
.rb-ver-when{font-size:10.5px;color:var(--rb-muted);font-variant-numeric:tabular-nums}
.rb-ver-why{margin-top:3px;font-size:11.5px;line-height:1.55;color:var(--rb-muted);white-space:pre-wrap}
.rb-ver-diff{margin-top:7px}
.rb-ver-k{font-size:10.5px;color:var(--rb-muted)}
.rb-ver-text{font-size:12px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}
.rb-ver-acts{display:flex;gap:12px;flex-wrap:wrap;margin-top:6px;font-size:10.5px}
.rb-ver-acts .rb-link{color:var(--rb-muted)}
.rb-ver-acts .rb-link:hover{color:var(--rb-ink)}

@container (max-width: 1080px){
  .rb-detail{flex-direction:column;overflow:auto}
  .rb-doc{flex:0 0 auto;overflow:visible}
  .rb-rail{flex:0 0 auto;border-left:0;border-top:1px solid var(--rb-line)}
  .rb-rail-body{overflow:visible}
  .rb-tocomments{display:inline}
}
@container (max-width: 860px){
  .rb-body{grid-template-columns:252px minmax(0,1fr)}
  .rb-head{padding:10px 14px;gap:10px}
  .rb-doc{padding:15px 16px 24px}
  .rb-usage{padding:15px 16px 24px}
  .rb-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}
  .rb-tile:nth-child(3){border-left:0;padding-left:0}
  .rb-tile:nth-child(n+3){border-top:1px solid var(--rb-line)}
}
@container (max-width: 640px){
  .rb-body{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(112px,32%) minmax(0,1fr)}
  .rb-list{border-right:0;border-bottom:1px solid var(--rb-line);padding:0 0 8px}
  .rb-head{flex-wrap:wrap;row-gap:8px}
  .rb-actions{width:100%;justify-content:flex-end;margin-left:0}
  .rb-title{white-space:normal}
  .rb-foot{padding:6px 14px;gap:6px;flex-wrap:wrap}
  .rb-foot>span.rb-foot-sum{display:none}
  .rb-doc{padding:13px 14px 20px}
  .rb-dhead{flex-wrap:wrap;row-gap:8px}
  .rb-stance-box{margin-left:0;align-items:flex-start;text-align:left}
  .rb-tl .rb-ev,.rb-asm{grid-template-columns:46px minmax(0,1fr);gap:8px}
  .rb-dtitle,.rb-text.rb-dtitle,.rb-edit.heading{font-size:15.5px}
}
@container (max-width: 520px){
  .rb-head{padding:9px 12px;gap:8px}
  .rb-title{font-size:12.5px}
  .rb-doc{padding:12px 12px 18px}
  .rb-tl .rb-ev,.rb-asm{grid-template-columns:44px minmax(0,1fr);gap:7px}
  .rb-ev::before,.rb-ev::after{display:none}
  .rb-ev>div:last-child{padding-left:0}
  .rb-sched-time{width:76px}
  .rb-usage{padding:12px 12px 18px}
  .rb-tile-v{font-size:19px}
  .rb-chart-wrap{padding-left:44px}
  .rb-stance-val{font-size:21px}
}
@media (prefers-reduced-motion: reduce){
  .rb-root *{transition:none !important}
}
`

    // ---------------------------------------------------------------- data

    async function request(path, init) {
      const response = await fetch(`${API}${path}`, {
        headers: { accept: 'application/json', ...init?.headers },
        ...init,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    }

    /** POST that keeps the body on a non-2xx answer instead of throwing it away. */
    async function postJson(path, body) {
      const response = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          ...body === undefined ? {} : { 'content-type': 'application/json' },
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      return { ok: response.ok, status: response.status, data }
    }

    const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    const pad2 = value => String(value).padStart(2, '0')

    function dayKey(iso) {
      const date = new Date(iso)
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    }

    function clockOf(iso) {
      const date = new Date(iso)
      return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
    }

    function monthDay(date, now) {
      const sameYear = date.getFullYear() === now.getFullYear()
      const month = date.getMonth() + 1
      return sameYear
        ? (isZh ? `${month}月${date.getDate()}日` : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))
        : (isZh ? `${date.getFullYear()}年${month}月${date.getDate()}日` : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }))
    }

    /**
     * Dates lead, durations fill in.
     *
     * A staleness log has to line up with calendar events — a filing date, a call,
     * a Sunday — and "3 天前" cannot do that: it shifts every time the panel opens
     * and depends on the reader remembering today's date. Relative phrasing only
     * survives inside the hour, where it carries information a clock does not.
     */
    function when(iso, style = 'short') {
      if (!iso) return '—'
      const at = Date.parse(iso)
      if (Number.isNaN(at)) return '—'
      const date = new Date(at)
      const now = new Date()
      const minutes = Math.round((now.getTime() - at) / 60000)
      if (minutes >= 0 && minutes < 60) {
        return minutes < 1 ? (isZh ? '刚刚' : 'now') : (isZh ? `${minutes} 分钟前` : `${minutes}m ago`)
      }
      const key = dayKey(iso)
      const today = dayKey(now.toISOString())
      const yesterday = dayKey(new Date(now.getTime() - 86400000).toISOString())
      if (key === today) return style === 'long' ? (isZh ? `今天 ${clockOf(iso)}` : `today ${clockOf(iso)}`) : (isZh ? '今天' : 'today')
      if (key === yesterday) return style === 'long' ? (isZh ? `昨天 ${clockOf(iso)}` : `yesterday ${clockOf(iso)}`) : (isZh ? '昨天' : 'yesterday')
      const label = monthDay(date, now)
      return style === 'long'
        ? `${label}${isZh ? ` ${WEEKDAYS[date.getDay()]}` : ''} ${clockOf(iso)}`
        : label
    }

    /** A fixed date and time for text that is saved and read later: "11月14日 15:32". */
    function stampOf(iso) {
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return ''
      return `${monthDay(date, new Date())} ${clockOf(iso)}`
    }

    /** Day heading used by the evidence log: "11月11日 周三". */
    function dayLabel(iso) {
      const date = new Date(iso)
      const label = monthDay(date, new Date())
      return isZh ? `${label} ${WEEKDAYS[date.getDay()]}` : label
    }

    /** Overdue is a number of days, not a yes/no: the gap is the actionable part. */
    function dueText(iso) {
      if (!iso) return isZh ? '未设定' : 'unset'
      const at = Date.parse(iso)
      if (Number.isNaN(at)) return '—'
      const now = Date.now()
      if (at <= now) {
        const over = Math.floor((now - at) / 86400000)
        if (over <= 0) return isZh ? '今天到期' : 'due today'
        return isZh ? `已超 ${over} 天` : `${over}d overdue`
      }
      const ahead = Math.ceil((at - now) / 86400000)
      if (ahead <= 1) return isZh ? '明天' : 'tomorrow'
      return isZh ? `${ahead} 天后` : `in ${ahead}d`
    }

    /** Silence is a finding: a topic with no evidence for a week says something. */
    function silenceOf(iso) {
      if (!iso) return null
      const at = Date.parse(iso)
      if (Number.isNaN(at)) return null
      const days = Math.floor((Date.now() - at) / 86400000)
      if (days < 7) return null
      return isZh ? `${days} 天无新证据` : `${days}d quiet`
    }

    function stanceColor(stance) {
      if (stance === null || stance === undefined) return 'var(--dsw-alias-state-idle-primary)'
      if (stance > 0.12) return 'var(--dsw-alias-state-success-primary)'
      if (stance < -0.12) return 'var(--dsw-alias-state-error-primary)'
      return 'var(--dsw-alias-state-warn-primary)'
    }

    // ---------------------------------------------------------------- words

    const FIELD_KEYS = {
      title: 'fTitle', thesis: 'thesis', falsifier: 'falsifier', bull_case: 'bull',
      bear_case: 'bear', metric: 'metric', status: 'fStatus', merged_into: 'fMerged',
      importance: 'fImportance',
    }
    const fieldName = field => t(FIELD_KEYS[field] ?? field)
    const listFields = fields => fields.map(fieldName).join(isZh ? '、' : ', ')
    const STATUS_NAMES = isZh
      ? { active: '跟踪中', paused: '暂停', closed: '已结束', merged: '已合并' }
      : { active: 'tracking', paused: 'paused', closed: 'closed', merged: 'merged' }
    const statusName = status => STATUS_NAMES[status] ?? status
    // Importance decides how often a topic is checked and how deep the check goes.
    const IMPORTANCE = ['high', 'medium', 'low']
    const IMPORTANCE_NAMES = isZh ? { high: '高', medium: '中', low: '低' } : { high: 'high', medium: 'medium', low: 'low' }
    const importanceName = value => IMPORTANCE_NAMES[value] ?? value
    const IMPORTANCE_HINT = isZh
      ? '高：每天查，深度搜索并读一手资料；中：每周查一次，普通搜索；低：每月查一次，只看有没有重大事件。'
      : 'High: daily, deep search with primary sources. Medium: weekly, plain search. Low: monthly, major events only.'
    // How one research request searched: high importance gets deep thinking search.
    const MODE_NAMES = isZh
      ? { deep: '深查', search: '搜索', glance: '速查', session: '对话' }
      : { deep: 'deep', search: 'search', glance: 'glance', session: 'chat' }
    const ERROR_NAMES = isZh
      ? {
        no_api_key: '没有找到 DeepSeek key（~/.dsh/.env 里的 DEEPSEEK_API_KEY）',
        request_failed: '连不上 DeepSeek',
        http_401: 'DeepSeek key 无效',
        http_402: 'DeepSeek 余额不足',
        http_429: 'DeepSeek 限流，稍后再试',
        generation_failed: '模型生成中途出错',
        stream_failed: '连接中途断开',
        refused: '模型拒绝回答',
        no_json_in_answer: '回答里没有结果，没写入任何东西',
        no_search: '模型没有联网搜索就作答，没写入任何东西',
      }
      : {
        no_api_key: 'no DeepSeek key (DEEPSEEK_API_KEY in ~/.dsh/.env)',
        request_failed: 'could not reach DeepSeek',
        http_401: 'DeepSeek key rejected',
        http_402: 'DeepSeek balance too low',
        http_429: 'DeepSeek rate limit',
        generation_failed: 'generation failed',
        stream_failed: 'connection dropped',
        refused: 'the model refused',
        no_json_in_answer: 'the answer had no result block; nothing was written',
        no_search: 'the model answered without searching the web; nothing was written',
      }
    // How a pass started and how it ended, for the footer.
    const RUN_MODE_NAMES = isZh
      ? { daily: '定时', weekly: '定时', manual: '手动', event: '评论触发', retry: '失败重试', adhoc: '对话里' }
      : { daily: 'scheduled', weekly: 'scheduled', manual: 'by hand', event: 'from a comment', retry: 'retry', adhoc: 'in a chat' }
    const RUN_STATUS_NAMES = isZh
      ? { ok: '完成', partial: '部分完成', failed: '失败', open: '进行中' }
      : { ok: 'done', partial: 'partly done', failed: 'failed', open: 'running' }
    /** An error code from the Host ("http_429: …") as a short sentence. */
    const researchErrorText = code => {
      if (!code) return ''
      const key = String(code).split(':')[0].trim()
      return ERROR_NAMES[key] ?? (/^http_5/.test(key) ? (isZh ? 'DeepSeek 服务出错' : 'DeepSeek server error') : key)
    }
    const valueText = (field, value) => {
      if (value === null || value === undefined || value === '') return isZh ? '（空）' : '(empty)'
      if (field === 'status') return statusName(value)
      if (field === 'importance') return importanceName(value)
      return String(value)
    }
    const REQUIRED = new Set(['title', 'thesis', 'falsifier'])
    const SUBMIT_KEY = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '') ? '⌘ Enter' : 'Ctrl Enter'

    /** One readable sentence for a failed write; the codes come from the Host. */
    function errorText(result) {
      const code = result?.data?.error
      const zh = {
        changed_since_opened: '这期间 AI 改过这些字段',
        changed_since: '这些字段之后又被改过，没法撤回',
        already_reverted: '已经撤回过了',
        proposal_already_decided: '这条建议已经处理过了',
        topic_needs_falsifier: '要写证伪条件',
        topic_needs_title_and_thesis: '要写标题和命题',
        title_cannot_be_empty: '标题不能为空',
        thesis_cannot_be_empty: '命题不能为空',
        falsifier_cannot_be_empty: '证伪条件不能为空',
        note_is_empty: '留言是空的',
        nothing_to_update: '没有改动',
        board_needs_title: '名称不能为空',
        board_title_too_long: '名称太长了',
        weekdays_required: '至少选一天',
        invalid_time: '时间格式不对',
        invalid_importance: '重要性只能是高、中、低',
      }
      if (!code) return isZh ? '保存失败，检查一下网络或稍后再试' : 'Could not save; try again'
      return isZh ? (zh[code] ?? `保存失败（${code}）`) : code.replaceAll('_', ' ')
    }

    // ---------------------------------------------------------------- icon

    function BoardIcon({ size = 20, active = false }) {
      const [badge, setBadge] = useState(null)
      useEffect(() => {
        let alive = true
        const load = () => request('/badge').then(b => { if (alive) setBadge(b) }).catch(() => {})
        load()
        const timer = setInterval(load, 60000)
        const onSeen = () => load()
        window.addEventListener(SEEN_EVENT, onSeen)
        return () => { alive = false; clearInterval(timer); window.removeEventListener(SEEN_EVENT, onSeen) }
      }, [])
      const tint = active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)'
      // New evidence and anything the Agent wrote for the reader both count.
      // A flip on a high-importance topic, or a falsifier the AI saw met, shows as a
      // red dot; other flips are counted.
      const unread = (badge?.unread ?? 0) + (badge?.agent ?? 0) + (badge?.flipped_other ?? 0)
      const flipped = (badge?.flipped ?? 0) + (badge?.falsified ?? 0)
      return h('span', { className: 'rb-badge-wrap', style: { width: size, height: size } },
        h('svg', {
          width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
          'aria-hidden': true, style: { display: 'block', color: tint },
        },
          h('path', { d: 'M4 16.5h13', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', opacity: .45 }),
          h('circle', { cx: 6.4, cy: 16.5, r: 1.35, fill: 'currentColor', opacity: .4 }),
          h('circle', { cx: 11.2, cy: 16.5, r: 1.35, fill: 'currentColor', opacity: .62 }),
          h('circle', { cx: 16.8, cy: 16.5, r: 1.9, fill: 'currentColor' }),
          h('path', { d: 'M16.8 16.5V9.2', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
          h('circle', { cx: 16.8, cy: 7.6, r: 2.1, stroke: 'currentColor', strokeWidth: 1.7 }),
        ),
        flipped > 0
          ? h('span', { className: 'rb-badge-dot' })
          : unread > 0
            ? h('span', { className: 'rb-badge-num' }, unread > 99 ? '99+' : String(unread))
            : null,
      )
    }

    // ---------------------------------------------------------------- pieces

    /** Fold long prose to a few lines; the toggle appears only when it really overflows. */
    function Clamp({ text, lines = 3, className }) {
      const [expanded, setExpanded] = useState(false)
      const [overflows, setOverflows] = useState(false)
      const ref = useRef(null)
      useLayoutEffect(() => {
        const node = ref.current
        if (!node || expanded) return
        const measure = () => setOverflows(node.scrollHeight > node.clientHeight + 1)
        measure()
        if (typeof ResizeObserver !== 'function') return
        const observer = new ResizeObserver(measure)
        observer.observe(node)
        return () => observer.disconnect()
      }, [text, expanded, lines])
      if (!text) return null
      return h('div', null,
        h('p', {
          ref,
          className,
          style: expanded ? undefined : {
            display: '-webkit-box',
            WebkitLineClamp: String(lines),
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          },
        }, text),
        overflows || expanded
          ? h('button', {
            className: 'rb-more',
            type: 'button',
            onClick: () => setExpanded(value => !value),
          }, expanded ? (isZh ? '收起' : 'less') : (isZh ? '展开' : 'more'))
          : null,
      )
    }

    function Sparkline({ history }) {
      const points = Array.isArray(history) ? history : []
      if (points.length < 2) {
        return h('div', { style: { padding: '10px 0', fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
          isZh ? '还不够画出走势（至少两次评估）' : 'Not enough assessments for a trend yet')
      }
      const width = 100
      const height = 56
      const padY = 6
      // y maps the full stance domain onto the padded plot: +1 top, 0 middle, -1 bottom.
      const yOf = stance => padY + (1 - (Math.max(-1, Math.min(1, stance)) + 1) / 2) * (height - padY * 2)
      const step = width / (points.length - 1)
      const coords = points.map((point, index) => ({
        x: index * step,
        y: yOf(point.stance),
        // The history rows carry no flipped flag; the same rule the Host uses
        // (sign crossing or a jump of at least 0.5) marks a reversal here.
        flip: index > 0 && (
          (points[index - 1].stance > 0 && point.stance <= 0) ||
          (points[index - 1].stance < 0 && point.stance >= 0) ||
          Math.abs(point.stance - points[index - 1].stance) >= 0.5
        ),
      }))
      const last = points[points.length - 1]
      const first = points[0]
      const color = stanceColor(last.stance)
      const spanDays = Math.max(0, Math.round((Date.parse(last.at) - Date.parse(first.at)) / 86400000))
      const line = coords.map(c => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' ')
      return h('div', { className: 'rb-spark-wrap' },
        h('div', { className: 'rb-spark-main' },
          h('svg', { className: 'rb-spark', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none' },
            // Domain edges dotted, zero dashed: the eye anchors on the middle.
            h('line', { x1: 0, y1: yOf(1), x2: width, y2: yOf(1), stroke: 'var(--rb-line)', strokeWidth: .5, strokeDasharray: '1 3', vectorEffect: 'non-scaling-stroke' }),
            h('line', { x1: 0, y1: yOf(-1), x2: width, y2: yOf(-1), stroke: 'var(--rb-line)', strokeWidth: .5, strokeDasharray: '1 3', vectorEffect: 'non-scaling-stroke' }),
            h('line', { x1: 0, y1: yOf(0), x2: width, y2: yOf(0), stroke: 'var(--rb-line-strong)', strokeWidth: .6, strokeDasharray: '3 3', vectorEffect: 'non-scaling-stroke' }),
            h('polygon', {
              points: `0,${yOf(0)} ${line} ${width},${yOf(0)}`,
              fill: color, opacity: 0.08,
            }),
            h('polyline', {
              points: line, fill: 'none', stroke: color,
              strokeWidth: 1.5, strokeLinejoin: 'round', strokeLinecap: 'round',
              vectorEffect: 'non-scaling-stroke',
            }),
            // Each assessment gets a dot; a reversal is drawn hollow so a regime
            // change reads differently from an ordinary sample without a legend.
            coords.map((c, index) => c.flip
              ? h('circle', {
                key: index, cx: c.x, cy: c.y, r: 2.4,
                fill: 'var(--dsw-alias-bg-base)', stroke: 'var(--rb-warn)', strokeWidth: 1.2,
                vectorEffect: 'non-scaling-stroke',
              })
              : null),
            h('circle', {
              cx: width, cy: coords[coords.length - 1].y, r: 2,
              fill: color, vectorEffect: 'non-scaling-stroke',
            }),
          ),
          h('div', { className: 'rb-spark-axis' },
            h('span', null, when(first.at)),
            h('span', { className: 'rb-spark-span' }, isZh ? `${spanDays} 天 · ${points.length} 次评估` : `${spanDays}d · ${points.length} checks`),
            h('span', null, when(last.at)),
          ),
        ),
        // The right rail names the scale the line moves on; without it a flat
        // stretch near -1 and one near 0 look the same.
        h('div', { className: 'rb-spark-y' },
          h('span', { style: { top: yOf(1) } }, '+1'),
          h('span', { style: { top: yOf(0) } }, '0'),
          h('span', { style: { top: yOf(-1) } }, '−1'),
        ),
      )
    }

    /**
     * What the reader should know about a topic from the list alone, most
     * urgent first: a decision waiting on them, then fresh Agent activity, then
     * their own items still waiting for a pass.
     */
    function rowFlag(topic, fresh) {
      if (topic.falsified_at && topic.status === 'active') {
        return h('span', { className: 'rb-row-flag err' }, isZh ? '可能已证伪' : 'falsifier met?')
      }
      if (topic.pending_proposals > 0) {
        return h('span', { className: 'rb-row-flag' }, isZh ? `AI 建议 ${topic.pending_proposals}` : `${topic.pending_proposals} to decide`)
      }
      if (fresh) return h('span', { className: 'rb-row-flag' }, isZh ? 'AI 有新动作' : 'AI updated')
      if (topic.waiting_agent > 0) return h('span', { className: 'rb-row-flag quiet' }, isZh ? '等 AI 查看' : 'waiting for AI')
      return null
    }

    function TopicRow({ topic, selected, onSelect, fresh }) {
      const dim = topic.status !== 'active'
      const flag = rowFlag(topic, fresh)
      return h('div', {
        className: `rb-row${selected ? ' on' : ''}${dim ? ' dim' : ''}`,
        role: 'button', tabIndex: 0,
        onClick: () => onSelect(topic.id),
        onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(topic.id) } },
      },
        h('div', { className: 'rb-row-top' },
          h('div', { className: 'rb-row-title' }, topic.title),
          topic.unread > 0
            ? h('span', { className: 'rb-row-unread rb-num' }, topic.unread > 99 ? '99+' : String(topic.unread))
            : null,
        ),
        h('div', { className: 'rb-row-meta' },
          topic.importance === 'high' || topic.importance === 'low'
            ? h('span', { className: `rb-row-imp ${topic.importance}`, title: `${fieldName('importance')} ${importanceName(topic.importance)}` },
              importanceName(topic.importance))
            : null,
          topic.importance === 'high' || topic.importance === 'low' ? h('span', { className: 'rb-sep' }, '·') : null,
          // The number carries both sign and magnitude, colored by direction;
          // the timestamp says how stale the judgement is.
          h('span', {
            className: 'rb-row-stance rb-num',
            style: dim || topic.stance === null ? undefined : { color: stanceColor(topic.stance) },
          }, topic.stance === null ? '—' : topic.stance.toFixed(2)),
          h('span', { className: 'rb-sep' }, '·'),
          h('span', null, topic.status !== 'active'
            ? statusName(topic.status)
            : topic.last_evidence_at ? when(topic.last_evidence_at) : (isZh ? '无证据' : 'no evidence')),
          flag ? h('span', { className: 'rb-sep' }, '·') : null,
          flag,
        ),
      )
    }

    // ---------------------------------------------------------------- text

    /**
     * Diff tokens: ASCII words and runs of whitespace stay whole, every other
     * character is its own token, so Chinese prose diffs by character.
     */
    function tokensOf(value) {
      return String(value ?? '').match(/[A-Za-z0-9_]+|\s+|[^]/gu) ?? []
    }

    /** Diff two texts into same / del / ins runs; inside a change, deletions come first. */
    function diffText(before, after) {
      const a = tokensOf(before)
      const b = tokensOf(after)
      const n = a.length
      const m = b.length
      if (n * m > 4000000) {
        return [
          ...before ? [{ type: 'del', text: String(before) }] : [],
          ...after ? [{ type: 'ins', text: String(after) }] : [],
        ]
      }
      const width = m + 1
      const table = new Uint32Array((n + 1) * width)
      for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
          table[i * width + j] = a[i] === b[j]
            ? table[(i + 1) * width + j + 1] + 1
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
        }
      }
      const raw = []
      const push = (type, value) => {
        const last = raw[raw.length - 1]
        if (last && last.type === type) last.text += value
        else raw.push({ type, text: value })
      }
      let i = 0
      let j = 0
      while (i < n && j < m) {
        if (a[i] === b[j]) { push('same', a[i]); i += 1; j += 1 }
        else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) { push('del', a[i]); i += 1 }
        else { push('ins', b[j]); j += 1 }
      }
      while (i < n) { push('del', a[i]); i += 1 }
      while (j < m) { push('ins', b[j]); j += 1 }
      // A one- or two-character match between two changes reads as noise, so it
      // folds into the change and the reader sees one deletion and one insertion.
      const parts = []
      let del = ''
      let ins = ''
      const flush = () => {
        if (del) parts.push({ type: 'del', text: del })
        if (ins) parts.push({ type: 'ins', text: ins })
        del = ''
        ins = ''
      }
      raw.forEach((part, index) => {
        if (part.type === 'del') del += part.text
        else if (part.type === 'ins') ins += part.text
        else if ((del || ins) && part.text.length <= 2 && index < raw.length - 1) { del += part.text; ins += part.text }
        else { flush(); parts.push(part) }
      })
      flush()
      return parts
    }

    /** Tracked changes: struck-through deletions, underlined insertions. */
    function DiffText({ before, after }) {
      return h(React.Fragment, null, diffText(before ?? '', after ?? '').map((part, index) => part.type === 'same'
        ? h(React.Fragment, { key: index }, part.text)
        : h('span', {
          key: index,
          className: part.type === 'del' ? 'rb-del' : 'rb-ins',
          // Insertions are not part of the current text: offsets skip them.
          ...part.type === 'ins' ? { 'data-ins': '' } : {},
        }, part.text)))
    }

    /** Offset of a DOM point in a passage's current text; insertions and placeholders do not count. */
    function textOffset(root, node, offset) {
      try {
        const range = document.createRange()
        range.setStart(root, 0)
        range.setEnd(node, offset)
        const fragment = range.cloneContents()
        fragment.querySelectorAll('[data-ins]').forEach(element => element.remove())
        return fragment.textContent.length
      } catch {
        return null
      }
    }

    function caretFromPoint(x, y) {
      if (typeof document.caretPositionFromPoint === 'function') {
        const position = document.caretPositionFromPoint(x, y)
        return position ? { node: position.offsetNode, offset: position.offset } : null
      }
      if (typeof document.caretRangeFromPoint === 'function') {
        const range = document.caretRangeFromPoint(x, y)
        return range ? { node: range.startContainer, offset: range.startOffset } : null
      }
      return null
    }

    const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

    // ---------------------------------------------------------------- comments model

    /** Comment threads in a topic log: a note plus every reply under it, latest activity first. */
    function threadsOf(log) {
      const rows = [...log].sort((a, b) => a.id - b.id)
      const byRow = new Map()
      const threads = []
      for (const row of rows) {
        if (row.kind === 'note' && row.ref_id === null) {
          const thread = { id: row.id, root: row, messages: [row] }
          threads.push(thread)
          byRow.set(row.id, thread)
        } else if (row.kind === 'reply' && byRow.has(row.ref_id)) {
          const thread = byRow.get(row.ref_id)
          thread.messages.push(row)
          byRow.set(row.id, thread)
        }
      }
      for (const thread of threads) {
        thread.resolved = Boolean(thread.root.resolved_at)
        thread.last = thread.messages[thread.messages.length - 1]
      }
      return threads.sort((x, y) => y.last.id - x.last.id)
    }

    /** Where a comment's quote sits in the current text, or -1 once the text moved on. */
    function locate(value, anchor) {
      if (!anchor?.quote) return -1
      const { quote, start } = anchor
      if (Number.isInteger(start) && value.slice(start, start + quote.length) === quote) return start
      return value.indexOf(quote)
    }

    /** Non-overlapping highlight ranges for the open comments on one field. */
    function highlightRanges(value, threads, field) {
      const ranges = []
      for (const thread of threads) {
        const anchor = thread.root.anchor
        if (thread.resolved || anchor?.field !== field) continue
        const start = locate(value, anchor)
        if (start >= 0) ranges.push({ start, end: start + anchor.quote.length, id: thread.id })
      }
      ranges.sort((x, y) => x.start - y.start)
      const kept = []
      let reach = -1
      for (const range of ranges) {
        if (range.start >= reach) { kept.push(range); reach = range.end }
      }
      return kept
    }

    /** What a thread is waiting on, from the reader's side. */
    // `soon`: a comment that asked the AI is waiting, so a pass is about to start
    // and will read every open comment, not only that one.
    function threadStatus(thread, running, soon) {
      if (thread.resolved) return { text: isZh ? `已解决 · ${when(thread.root.resolved_at)}` : 'resolved' }
      const last = thread.last
      if (last.author === 'agent') {
        return { text: thread.messages.length === 1 ? (isZh ? 'AI 在问你' : 'a question from the AI') : (isZh ? 'AI 已回复' : 'the AI replied') }
      }
      if (last.state === 'open') {
        if (running) return { text: isZh ? 'AI 正在巡检…' : 'AI pass running…', warn: true }
        return {
          text: last.ask_ai || soon ? (isZh ? '等 AI 处理，巡检马上开始' : 'waiting for the AI pass') : (isZh ? '下次巡检时处理' : 'the next pass handles it'),
          warn: true,
        }
      }
      if (last.state === 'seen') return { text: isZh ? 'AI 看过，没有回复' : 'seen by the AI, no reply' }
      return null
    }

    // ---------------------------------------------------------------- new topic

    const FORM_FIELDS = [
      { key: 'title', single: true },
      { key: 'thesis', rows: 2 },
      { key: 'falsifier', rows: 2 },
      { key: 'bull_case', rows: 2 },
      { key: 'bear_case', rows: 2 },
      { key: 'metric', rows: 1 },
    ]

    /** Write a new topic. Existing topics are edited in place, not here. */
    function TopicForm({ onSubmit, onCancel }) {
      const [values, setValues] = useState(() => Object.fromEntries(FORM_FIELDS.map(field => [field.key, ''])))
      const [importance, setImportance] = useState('medium')
      const [note, setNote] = useState('')
      const [saving, setSaving] = useState(false)
      const [message, setMessage] = useState(null)
      const set = (key, value) => setValues(previous => ({ ...previous, [key]: value }))

      const submit = async () => {
        if (saving) return
        const missing = [...REQUIRED].find(key => String(values[key] ?? '').trim() === '')
        if (missing) { setMessage(isZh ? `${fieldName(missing)}不能为空` : `${fieldName(missing)} is required`); return }
        setSaving(true)
        setMessage(null)
        const result = await onSubmit({ ...values, importance, note })
        setSaving(false)
        if (!result.ok) setMessage(errorText(result))
      }

      const onKeyDown = event => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submit() }
        if (event.key === 'Escape') { event.preventDefault(); onCancel() }
      }

      return h('div', { className: 'rb-form', onKeyDown },
        h('h2', { className: 'rb-dtitle' }, t('newTopic')),
        h('p', { className: 'rb-form-lead' }, isZh
          ? '写成一个能被证伪的命题，并说清楚出现什么结果就说明它错了。保存后，下次巡检 AI 会开始跟踪它。'
          : 'Write a claim that can be proven wrong, and say what outcome would do that. The next pass starts tracking it.'),
        FORM_FIELDS.map(({ key, single, rows }) => h('div', { className: 'rb-form-row', key },
          h('label', { htmlFor: `rb-f-${key}` },
            fieldName(key),
            REQUIRED.has(key) ? null : h('span', { className: 'rb-opt' }, isZh ? ' · 可选' : ' · optional')),
          h(single ? 'input' : 'textarea', {
            id: `rb-f-${key}`,
            className: 'rb-input',
            value: values[key] ?? '',
            ...single ? {} : { rows },
            autoFocus: key === 'title',
            onChange: event => set(key, event.target.value),
          }),
        )),
        h('div', { className: 'rb-form-row' },
          h('span', { className: 'rb-form-label' }, fieldName('importance')),
          h('span', { className: 'rb-seg rb-imp-seg', role: 'group', 'aria-label': fieldName('importance') },
            IMPORTANCE.map(value => h('button', {
              key: value, type: 'button', className: importance === value ? 'on' : '', 'aria-pressed': importance === value,
              onClick: () => setImportance(value),
            }, importanceName(value)))),
          h('p', { className: 'rb-form-note' }, IMPORTANCE_HINT),
        ),
        h('div', { className: 'rb-form-row' },
          h('label', { htmlFor: 'rb-f-note' },
            isZh ? '给 AI 的说明' : 'Note for the AI',
            h('span', { className: 'rb-opt' }, isZh ? ' · 可选' : ' · optional')),
          h('textarea', {
            id: 'rb-f-note',
            className: 'rb-input',
            rows: 2,
            value: note,
            placeholder: isZh
              ? '希望它重点查什么。下次巡检时它会读到并回复。'
              : 'What to look at first. The next pass reads this and replies.',
            onChange: event => setNote(event.target.value),
          }),
        ),
        h('div', { className: 'rb-form-actions' },
          h('button', { className: 'rb-btn primary', type: 'button', onClick: submit, disabled: saving },
            saving ? (isZh ? '保存中…' : 'Saving…') : (isZh ? '添加' : 'Add')),
          h('button', { className: 'rb-btn', type: 'button', onClick: onCancel, disabled: saving }, isZh ? '取消' : 'Cancel'),
          message
            ? h('span', { className: 'rb-form-msg' }, message)
            : h('span', { className: 'rb-form-hint' }, isZh ? `${SUBMIT_KEY} 保存 · Esc 取消` : `${SUBMIT_KEY} to save · Esc to cancel`),
        ),
      )
    }

    // ---------------------------------------------------------------- passages

    /**
     * One passage of the topic, read and edited in place. A click puts the caret
     * where it landed; a drag selects text, and the document offers a comment;
     * a pending AI proposal shows as tracked changes over the current text.
     * Leaving the field saves it. If the AI changed the passage meanwhile, the
     * save stops and the reader picks a version.
     */
    function Passage({ field, value, heading, proposal, ranges, activeThread, onActivate, onSave }) {
      const [draft, setDraft] = useState(null)
      const [base, setBase] = useState('')
      const [conflict, setConflict] = useState(null)
      const [message, setMessage] = useState(null)
      const [saving, setSaving] = useState(false)
      const inputRef = useRef(null)
      const caretRef = useRef(null)
      const editing = draft !== null

      useLayoutEffect(() => {
        if (!editing || !inputRef.current || caretRef.current === null) return
        const node = inputRef.current
        node.focus()
        const at = Math.min(caretRef.current, node.value.length)
        node.setSelectionRange(at, at)
        caretRef.current = null
      }, [editing])

      const begin = offset => {
        if (editing) return
        caretRef.current = offset ?? value.length
        setBase(value)
        setDraft(value)
        setMessage(null)
        setConflict(null)
      }
      const close = () => { setDraft(null); setMessage(null); setConflict(null) }
      const save = async force => {
        if (!editing || saving) return
        if (conflict !== null && !force) return
        if (conflict === null && draft.trim() === base.trim()) { close(); return }
        if (REQUIRED.has(field) && draft.trim() === '') {
          setMessage(isZh ? `${fieldName(field)}不能为空` : `${fieldName(field)} is required`)
          return
        }
        setSaving(true)
        const result = await onSave(field, draft, base)
        setSaving(false)
        if (result.ok || result.data?.error === 'nothing_to_update') { close(); return }
        if (result.status === 409 && result.data?.current && field in result.data.current) {
          const latest = result.data.current[field] ?? ''
          setBase(latest)
          setConflict(latest)
          return
        }
        setMessage(errorText(result))
      }

      if (editing) {
        const single = field === 'title'
        // Buttons keep the focus in the field, so pressing one is not also a blur-save.
        const keep = event => event.preventDefault()
        return h('div', { className: 'rb-editing' },
          h(single ? 'input' : 'textarea', {
            ref: inputRef,
            className: `rb-edit${heading ? ' heading' : ''}`,
            value: draft,
            ...single ? {} : { rows: 1 },
            'aria-label': fieldName(field),
            onChange: event => setDraft(event.target.value),
            onBlur: () => { save(false) },
            onKeyDown: event => {
              if (event.key === 'Escape') { event.preventDefault(); close() }
              else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); save(true) }
              else if (single && event.key === 'Enter') { event.preventDefault(); save(true) }
            },
          }),
          conflict !== null
            ? h('div', { className: 'rb-conflict' },
              h('div', null, isZh ? 'AI 在你编辑时改过这一段，它现在的版本是：' : 'The AI changed this passage while you were editing. Its version:'),
              h('div', { className: 'rb-conflict-text' }, conflict || (isZh ? '（空）' : '(empty)')),
              h('div', { className: 'rb-edit-bar' },
                h('button', { className: 'rb-btn sm primary', type: 'button', onMouseDown: keep, onClick: () => save(true), disabled: saving },
                  isZh ? '用我的版本' : 'Keep mine'),
                h('button', { className: 'rb-btn sm', type: 'button', onMouseDown: keep, onClick: close, disabled: saving },
                  isZh ? '用 AI 的版本' : 'Take the AI version')))
            : h('div', { className: 'rb-edit-bar' },
              saving
                ? (isZh ? '保存中…' : 'Saving…')
                : message
                  ? h('span', { className: 'rb-form-msg' }, message)
                  : (isZh ? `点别处或 ${SUBMIT_KEY} 保存 · Esc 取消` : `Click away or ${SUBMIT_KEY} to save · Esc to cancel`)),
        )
      }

      const onClick = event => {
        const selection = window.getSelection()
        if (selection && !selection.isCollapsed) return
        const mark = event.target.closest?.('[data-thread]')
        if (mark) {
          if (mark.dataset.thread !== 'draft') onActivate(Number(mark.dataset.thread))
          return
        }
        const point = caretFromPoint(event.clientX, event.clientY)
        const offset = point && event.currentTarget.contains(point.node)
          ? textOffset(event.currentTarget, point.node, point.offset)
          : null
        begin(offset)
      }

      let content
      const proposed = proposal?.changes?.[field]
      if (proposed) {
        content = h(DiffText, { before: value, after: proposed.to ?? '' })
      } else if (!value) {
        content = h('span', { className: 'rb-placeholder', 'data-ins': '' }, isZh ? '点击填写' : 'Click to write')
      } else {
        content = []
        let at = 0
        for (const range of ranges ?? []) {
          if (range.start > at) content.push(value.slice(at, range.start))
          content.push(h('mark', {
            key: range.id,
            className: `rb-hl${range.id === activeThread || range.id === 'draft' ? ' on' : ''}`,
            'data-thread': range.id,
          }, value.slice(range.start, range.end)))
          at = range.end
        }
        if (at < value.length) content.push(value.slice(at))
      }
      return h(heading ? 'h2' : 'div', {
        className: `rb-text${heading ? ' rb-dtitle' : ''}`,
        'data-field': field,
        tabIndex: 0,
        onClick,
        onKeyDown: event => {
          if (event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); begin() }
        },
      }, content)
    }

    /** A pending AI proposal: why, and the reader's two answers. The change itself is drawn in the text. */
    function Suggestion({ item, topic, onDecide }) {
      const [rejecting, setRejecting] = useState(false)
      const [note, setNote] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const fields = Object.keys(item.changes ?? {})
      // Status and merge target have no prose to mark up, so they are spelled out.
      const plain = fields.filter(field => field === 'status' || field === 'merged_into')
      const decide = async accept => {
        setBusy(true)
        setError(null)
        const result = await onDecide(item.id, accept, accept ? '' : note)
        setBusy(false)
        if (!result.ok) setError(errorText(result))
      }
      return h('div', { className: 'rb-sugg' },
        h('div', { className: 'rb-sugg-head' },
          h('b', null, isZh ? 'AI 建议这样改' : 'The AI suggests this change'),
          fields.length > 1 ? h('span', null, ` · ${isZh ? '涉及' : 'covers'} ${listFields(fields)}`) : null,
          h('span', null, ` · ${when(item.created_at, 'long')}`)),
        plain.map(field => h('div', { className: 'rb-sugg-why', key: field },
          `${fieldName(field)}：${valueText(field, topic[field])} → ${valueText(field, item.changes[field]?.to)}`)),
        item.body ? h('div', { className: 'rb-sugg-why' }, `${isZh ? '理由' : 'Why'}：${item.body}`) : null,
        rejecting
          ? h('div', { className: 'rb-sugg-acts col' },
            h('textarea', {
              className: 'rb-input',
              rows: 2,
              autoFocus: true,
              value: note,
              placeholder: isZh ? '告诉 AI 为什么不采纳（可选）。它下次巡检会读到，不会再提同样的改法。' : 'Tell the AI why (optional).',
              onChange: event => setNote(event.target.value),
            }),
            h('div', { className: 'rb-sugg-acts' },
              h('button', { className: 'rb-btn sm', type: 'button', disabled: busy, onClick: () => decide(false) }, isZh ? '确认不采纳' : 'Reject'),
              h('button', { className: 'rb-btn sm', type: 'button', disabled: busy, onClick: () => { setRejecting(false); setNote('') } }, isZh ? '取消' : 'Cancel')))
          : h('div', { className: 'rb-sugg-acts' },
            h('button', { className: 'rb-btn primary sm', type: 'button', disabled: busy, onClick: () => decide(true) }, isZh ? '采纳' : 'Accept'),
            h('button', { className: 'rb-btn sm', type: 'button', disabled: busy, onClick: () => setRejecting(true) }, isZh ? '不采纳' : 'Reject')),
        error ? h('div', { className: 'rb-form-msg', style: { marginTop: 6 } }, error) : null,
      )
    }

    /** "Ask the AI now" for any comment box. */
    function AskToggle({ checked, onChange }) {
      return h('label', { className: 'rb-check' },
        h('input', { type: 'checkbox', checked, onChange: event => onChange(event.target.checked) }),
        isZh ? '让 AI 处理（立即开始一次巡检）' : 'Ask the AI now (starts a pass)')
    }

    /** The comment box that opens over a text selection. */
    function CommentPop({ sel, onCancel, onSubmit }) {
      const [body, setBody] = useState('')
      const [ask, setAsk] = useState(true)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const submit = async () => {
        if (body.trim() === '' || busy) return
        setBusy(true)
        setError(null)
        const result = await onSubmit(body.trim(), ask)
        setBusy(false)
        if (!result.ok) setError(errorText(result))
      }
      return h('div', {
        className: 'rb-pop',
        style: { top: sel.top, left: sel.left },
        onKeyDown: event => { if (event.key === 'Escape') { event.preventDefault(); onCancel() } },
      },
        h('div', { className: 'rb-pop-quote' }, h('span', null, fieldName(sel.field)), sel.quote),
        h('textarea', {
          className: 'rb-input',
          rows: 3,
          autoFocus: true,
          value: body,
          placeholder: isZh ? '想让 AI 怎么改，或者你对这句话的疑问' : 'How should the AI change this, or what is your question?',
          onChange: event => setBody(event.target.value),
          onKeyDown: event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submit() } },
        }),
        h(AskToggle, { checked: ask, onChange: setAsk }),
        h('div', { className: 'rb-pop-acts' },
          h('button', { className: 'rb-btn primary sm', type: 'button', disabled: busy || body.trim() === '', onClick: submit },
            busy ? (isZh ? '发送中…' : 'Sending…') : (isZh ? '评论' : 'Comment')),
          h('button', { className: 'rb-btn sm', type: 'button', disabled: busy, onClick: onCancel }, isZh ? '取消' : 'Cancel'),
          error ? h('span', { className: 'rb-form-msg' }, error) : null),
      )
    }

    // ---------------------------------------------------------------- rail

    function Thread({ thread, topic, active, running, soon, onActivate, onJump, actions }) {
      const [replying, setReplying] = useState(false)
      const [draft, setDraft] = useState('')
      const [ask, setAsk] = useState(true)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const anchor = thread.root.anchor
      const located = anchor ? locate(String(topic[anchor.field] ?? ''), anchor) >= 0 : false
      const status = threadStatus(thread, running, soon)
      const act = async run => {
        setBusy(true)
        setError(null)
        const result = await run()
        setBusy(false)
        if (!result.ok) setError(errorText(result))
        return result
      }
      const send = async () => {
        if (draft.trim() === '' || busy) return
        const result = await act(() => actions.comment(topic.id, { body: draft.trim(), reply_to: thread.last.id, ask_ai: ask }))
        if (result.ok) { setDraft(''); setReplying(false) }
      }
      return h('div', {
        id: `rb-thread-${thread.id}`,
        className: `rb-thread${active ? ' on' : ''}${thread.resolved ? ' done' : ''}`,
        onClick: () => onActivate(thread.id),
      },
        anchor ? h('button', {
          className: 'rb-quote',
          type: 'button',
          title: isZh ? '在文中定位' : 'Show in the text',
          onClick: event => { event.stopPropagation(); onJump(thread) },
        },
          h('span', { className: 'rb-quote-k' }, `${fieldName(anchor.field)}${located ? '' : (isZh ? ' · 原文已改动' : ' · text has changed')}`),
          h('span', { className: 'rb-quote-t' }, anchor.quote)) : null,
        thread.messages.map((message, index) => h('div', { key: message.id, className: `rb-msg${index > 0 ? ' reply' : ''}` },
          h('div', { className: 'rb-msg-head' },
            h('b', null, message.author === 'human' ? (isZh ? '你' : 'You') : 'AI'),
            ` · ${when(message.created_at, 'long')}`),
          h('div', { className: 'rb-msg-body' }, message.body))),
        h('div', { className: 'rb-thread-foot' },
          status ? h('span', { className: status.warn ? 'warn' : '' }, status.text) : null,
          h('span', { className: 'grow' }),
          thread.resolved
            ? h('button', { className: 'rb-link', type: 'button', disabled: busy, onClick: event => { event.stopPropagation(); act(() => actions.resolve(thread.id, false)) } }, isZh ? '重新打开' : 'Reopen')
            : h(React.Fragment, null,
              replying ? null : h('button', { className: 'rb-link', type: 'button', onClick: event => { event.stopPropagation(); setReplying(true) } }, isZh ? '回复' : 'Reply'),
              h('button', { className: 'rb-link', type: 'button', disabled: busy, onClick: event => { event.stopPropagation(); act(() => actions.resolve(thread.id, true)) } }, isZh ? '解决' : 'Resolve'))),
        replying ? h('div', { className: 'rb-compose', onClick: event => event.stopPropagation() },
          h('textarea', {
            className: 'rb-input',
            rows: 2,
            autoFocus: true,
            value: draft,
            placeholder: isZh ? '继续追问，或者告诉 AI 哪里还不对' : 'Follow up',
            onChange: event => setDraft(event.target.value),
            onKeyDown: event => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); send() }
              if (event.key === 'Escape') { event.preventDefault(); setReplying(false) }
            },
          }),
          h(AskToggle, { checked: ask, onChange: setAsk }),
          h('div', { className: 'rb-compose-bar' },
            h('button', { className: 'rb-btn sm primary', type: 'button', disabled: busy || draft.trim() === '', onClick: send }, isZh ? '发送' : 'Send'),
            h('button', { className: 'rb-btn sm', type: 'button', disabled: busy, onClick: () => setReplying(false) }, isZh ? '取消' : 'Cancel'))) : null,
        error ? h('div', { className: 'rb-form-msg', style: { marginTop: 6 } }, error) : null,
      )
    }

    function Comments({ topic, threads, active, running, soon, onActivate, onJump, actions }) {
      const [view, setView] = useState('open')
      const [draft, setDraft] = useState('')
      const [ask, setAsk] = useState(true)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const open = threads.filter(thread => !thread.resolved)
      const done = threads.filter(thread => thread.resolved)
      const list = view === 'open' ? open : done
      const send = async () => {
        if (draft.trim() === '' || busy) return
        setBusy(true)
        setError(null)
        const result = await actions.comment(topic.id, { body: draft.trim(), ask_ai: ask })
        setBusy(false)
        if (result.ok) {
          setDraft('')
          setView('open')
          onActivate(result.data?.thread_id ?? null)
        } else {
          setError(errorText(result))
        }
      }
      return h('div', null,
        h('div', { className: 'rb-compose' },
          h('textarea', {
            className: 'rb-input',
            rows: 2,
            value: draft,
            placeholder: isZh ? '对整个议题留言。要评论某句话，在文中选中它。' : 'Comment on the whole topic. To comment on a passage, select it in the text.',
            onChange: event => setDraft(event.target.value),
            onKeyDown: event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); send() } },
          }),
          draft.trim() === '' ? null : h(AskToggle, { checked: ask, onChange: setAsk }),
          draft.trim() === '' ? null : h('div', { className: 'rb-compose-bar' },
            h('button', { className: 'rb-btn sm primary', type: 'button', disabled: busy, onClick: send }, busy ? (isZh ? '发送中…' : 'Sending…') : (isZh ? '发送' : 'Send')),
            error ? h('span', { className: 'rb-form-msg' }, error) : h('span', { className: 'rb-form-hint' }, isZh ? `${SUBMIT_KEY} 发送` : `${SUBMIT_KEY} to send`))),
        h('div', { className: 'rb-subtabs' },
          h('button', { type: 'button', className: view === 'open' ? 'on' : '', onClick: () => setView('open') }, `${isZh ? '待处理' : 'Open'} ${open.length}`),
          h('button', { type: 'button', className: view === 'done' ? 'on' : '', onClick: () => setView('done') }, `${isZh ? '已解决' : 'Resolved'} ${done.length}`)),
        list.length === 0
          ? h('p', { className: 'rb-rail-empty' }, view === 'open'
            ? (isZh ? '没有待处理的评论。在文中选中一句话就能评论，AI 会读到、按需修改并在这里回复。' : 'No open comments. Select a passage to comment; the AI reads it, edits if needed and replies here.')
            : (isZh ? '还没有已解决的评论。' : 'Nothing resolved yet.'))
          : list.map(thread => h(Thread, {
            key: thread.id, thread, topic, running, soon, actions, onJump,
            active: thread.id === active,
            onActivate,
          })),
      )
    }

    const VERSION_KINDS = new Set(['create', 'edit', 'accept'])
    const isVersion = row => VERSION_KINDS.has(row.kind) && row.changes && Object.keys(row.changes).length > 0

    function Version({ row, proposal, decision, replies, open, onToggle, newest, topicId, actions }) {
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const fields = Object.keys(row.changes ?? {})
      const human = row.author === 'human'
      const who = human ? (isZh ? '你' : 'You') : (isZh ? 'AI ' : 'AI')
      let head
      switch (row.kind) {
        case 'create': head = isZh ? `${who}新建了议题` : `${who} added the topic`; break
        case 'accept': head = isZh ? `你采纳了 AI 的建议：${listFields(fields)}` : `You accepted the AI's change to ${listFields(fields)}`; break
        case 'proposal': head = isZh ? `AI 建议修改${listFields(fields)}` : `The AI proposed changing ${listFields(fields)}`; break
        default:
          head = human && row.ref_id !== null
            ? (isZh ? `你撤销了 AI 对${listFields(fields)}的修改` : `You undid the AI's change to ${listFields(fields)}`)
            : (isZh ? `${who}修改了${listFields(fields)}` : `${who} changed ${listFields(fields)}`)
      }
      const tags = isZh
        ? { pending: ['待你决定', 'warn'], rejected: ['未采纳'], superseded: ['已被之后的修改取代'], reverted: ['已撤销'] }
        : { pending: ['to decide', 'warn'], rejected: ['rejected'], superseded: ['superseded'], reverted: ['undone'] }
      const [tag, tagClass] = (row.kind === 'proposal' || (row.author === 'agent' && row.kind === 'edit')) ? (tags[row.state] ?? []) : []
      const why = row.kind === 'accept' ? proposal?.body : row.body
      const run = async call => {
        setBusy(true)
        setError(null)
        const result = await call()
        setBusy(false)
        if (!result.ok) setError(errorText(result))
      }
      return h('div', { className: 'rb-ver', id: `rb-ver-${row.id}` },
        h('div', { className: 'rb-ver-head' },
          h('span', null, head),
          tag ? h('span', { className: `rb-ver-tag${tagClass ? ` ${tagClass}` : ''}` }, ` · ${tag}`) : null),
        h('div', { className: 'rb-ver-when' }, when(row.created_at, 'long')),
        why ? h('div', { className: 'rb-ver-why' }, row.author === 'agent' || row.kind === 'accept' ? `${isZh ? '理由' : 'Why'}：${why}` : why) : null,
        row.kind === 'proposal' && row.state === 'rejected' && decision?.body
          ? h('div', { className: 'rb-ver-why' }, `${isZh ? '你的理由' : 'Your reason'}：${decision.body}`) : null,
        open ? fields.map(field => h('div', { className: 'rb-ver-diff', key: field },
          h('div', { className: 'rb-ver-k' }, fieldName(field)),
          field === 'status' || field === 'merged_into'
            ? h('div', null, `${valueText(field, row.changes[field]?.from)} → ${valueText(field, row.changes[field]?.to)}`)
            : h('div', { className: 'rb-ver-text' }, h(DiffText, { before: row.changes[field]?.from ?? '', after: row.changes[field]?.to ?? '' })))) : null,
        replies.map(reply => h('div', { className: 'rb-msg reply', key: reply.id },
          h('div', { className: 'rb-msg-head' }, h('b', null, reply.author === 'human' ? (isZh ? '你' : 'You') : 'AI'), ` · ${when(reply.created_at, 'long')}`),
          h('div', { className: 'rb-msg-body' }, reply.body))),
        h('div', { className: 'rb-ver-acts' },
          h('button', { className: 'rb-link', type: 'button', onClick: onToggle }, open ? (isZh ? '收起' : 'Hide') : (isZh ? '查看改动' : 'Show changes')),
          row.author === 'agent' && row.kind === 'edit' && row.state === 'applied'
            ? h('button', { className: 'rb-link', type: 'button', disabled: busy, onClick: () => run(() => actions.revert(row.id)) }, isZh ? '撤销这次修改' : 'Undo')
            : null,
          isVersion(row) && !newest
            ? h('button', {
              className: 'rb-link', type: 'button', disabled: busy,
              onClick: () => run(() => actions.restore(topicId, row.id, isZh ? `恢复到 ${stampOf(row.created_at)} 的版本` : `Restored the version of ${stampOf(row.created_at)}`)),
            }, isZh ? '恢复到这个版本' : 'Restore this version')
            : null),
        error ? h('div', { className: 'rb-form-msg', style: { marginTop: 4 } }, error) : null,
      )
    }

    function History({ topic, log, focus, actions }) {
      const [opened, setOpened] = useState(() => new Set(focus ? [focus] : []))
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      useEffect(() => {
        if (!focus) return
        setOpened(previous => new Set(previous).add(focus))
        requestAnimationFrame(() => document.getElementById(`rb-ver-${focus}`)?.scrollIntoView({ block: 'nearest' }))
      }, [focus])
      const byId = new Map(log.map(row => [row.id, row]))
      const decisions = new Map()
      const replies = new Map()
      for (const row of log) {
        if ((row.kind === 'accept' || row.kind === 'reject') && row.ref_id !== null) decisions.set(row.ref_id, row)
        if (row.kind === 'reply' && row.ref_id !== null && byId.has(row.ref_id) && byId.get(row.ref_id).kind !== 'note' && byId.get(row.ref_id).kind !== 'reply') {
          replies.set(row.ref_id, [...replies.get(row.ref_id) ?? [], row])
        }
      }
      // An accepted proposal is shown through its acceptance, which is the version.
      const entries = log.filter(row => isVersion(row) || (row.kind === 'proposal' && row.state !== 'accepted'))
      const newest = entries.find(isVersion)?.id
      const hasCreate = log.some(row => row.kind === 'create')
      const toggle = id => setOpened(previous => {
        const next = new Set(previous)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      const restoreOrigin = async () => {
        setBusy(true)
        setError(null)
        const result = await actions.restore(topic.id, 0, isZh ? '恢复到最初版本' : 'Restored the original version')
        setBusy(false)
        if (!result.ok) setError(errorText(result))
      }
      return h('div', null,
        h('p', { className: 'rb-rail-lead' }, isZh
          ? '每次修改都记在这里：谁改的、为什么、改了什么。可以撤销 AI 的修改，或把议题恢复到某个版本；恢复本身也会记成一次修改。'
          : 'Every change is kept here: who, why and what. Undo an AI edit or restore an earlier version; a restore is itself a change.'),
        entries.length === 0
          ? h('p', { className: 'rb-rail-empty' }, isZh ? '还没有修改记录。' : 'No changes yet.')
          : entries.map(row => h(Version, {
            key: row.id,
            row,
            proposal: row.kind === 'accept' ? byId.get(row.ref_id) : null,
            decision: row.kind === 'proposal' ? decisions.get(row.id) : null,
            replies: (replies.get(row.id) ?? []).slice().reverse(),
            open: opened.has(row.id),
            onToggle: () => toggle(row.id),
            newest: row.id === newest,
            topicId: topic.id,
            actions,
          })),
        // Topics seeded before the log existed have no creation entry: offer the
        // text they started with as the oldest version.
        !hasCreate && newest !== undefined ? h('div', { className: 'rb-ver' },
          h('div', { className: 'rb-ver-head' }, isZh ? '最初版本' : 'Original version'),
          h('div', { className: 'rb-ver-when' }, isZh ? '循迹开始记录修改之前的内容' : 'Before changes were recorded'),
          h('div', { className: 'rb-ver-acts' },
            h('button', { className: 'rb-link', type: 'button', disabled: busy, onClick: restoreOrigin }, isZh ? '恢复到这个版本' : 'Restore this version')),
          error ? h('div', { className: 'rb-form-msg', style: { marginTop: 4 } }, error) : null) : null,
      )
    }

    function Rail({ topic, log, threads, tab, setTab, active, focus, running, soon, onActivate, onJump, actions }) {
      const openCount = threads.filter(thread => !thread.resolved).length
      const tabButton = (key, label) => h('button', {
        key,
        type: 'button',
        role: 'tab',
        'aria-selected': tab === key,
        className: `rb-tab${tab === key ? ' on' : ''}`,
        onClick: () => setTab(key),
      }, label)
      return h('aside', { className: 'rb-rail' },
        h('div', { className: 'rb-tabs', role: 'tablist' },
          tabButton('comments', `${isZh ? '评论' : 'Comments'}${openCount > 0 ? ` ${openCount}` : ''}`),
          tabButton('history', isZh ? '历史' : 'History')),
        h('div', { className: 'rb-rail-body' },
          tab === 'comments'
            ? h(Comments, { key: topic.id, topic, threads, active, running, soon, onActivate, onJump, actions })
            : h(History, { key: `${topic.id}-${focus ?? ''}`, topic, log, focus, actions })),
      )
    }

    // ---------------------------------------------------------------- detail

    function EvidenceRow({ item, index, showDate }) {
      const [copied, setCopied] = useState(false)
      const direction = Number(item.direction)
      const directionLabel = direction > 0
        ? h('span', { className: 'rb-ev-dir up' }, isZh ? '支持' : 'supports')
        : direction < 0
          ? h('span', { className: 'rb-ev-dir down' }, isZh ? '反向' : 'against')
          : h('span', null, isZh ? '中性' : 'neutral')
      const stamp = item.published_at ?? item.captured_at
      const copy = useCallback(async () => {
        try {
          await navigator.clipboard.writeText(item.url)
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        } catch { /* clipboard permission denied: the link stays selectable */ }
      }, [item.url])
      return h('div', { className: 'rb-ev', style: { '--i': index ?? 0 } },
        h('div', { className: 'rb-ev-when' },
          showDate ? h('div', { className: 'rb-ev-date' }, stamp ? monthDay(new Date(stamp), new Date()) : '—') : null,
          h('div', { className: 'rb-ev-clock' }, stamp ? clockOf(stamp) : '—'),
        ),
        h('div', null,
          h('a', { className: 'rb-ev-title', href: item.url, target: '_blank', rel: 'noreferrer' }, item.title),
          h('div', { className: 'rb-ev-meta' },
            directionLabel,
            h('span', { className: 'rb-sep' }, '·'),
            h('span', null, item.kind),
            item.source ? h('span', { className: 'rb-sep' }, '·') : null,
            item.source ? h('span', null, item.source) : null,
            h('span', { className: 'rb-ev-spacer' }),
            h('button', {
              className: `rb-copy${copied ? ' copied' : ''}`,
              type: 'button',
              onClick: copy,
              title: item.url,
            }, copied ? (isZh ? '已复制' : 'copied') : (isZh ? '复制链接' : 'copy link')),
          ),
          item.summary ? h('div', { className: 'rb-ev-sum' }, item.summary) : null,
        ),
      )
    }

    const DOC_FIELDS = [
      { key: 'thesis', label: 'thesis' },
      { key: 'falsifier', label: 'falsifier', cls: 'falsifier' },
      { key: 'bull_case', label: 'bull' },
      { key: 'bear_case', label: 'bear' },
      { key: 'metric', label: 'metric' },
    ]

    /** One research request: how it searched, what it cost, what it concluded, and what it looked at. */
    function ResearchRow({ item }) {
      const seconds = item.ended_at ? Math.round((Date.parse(item.ended_at) - Date.parse(item.started_at)) / 1000) : null
      const applied = item.applied ?? {}
      const wrote = [
        item.falsifier_triggered ? (isZh ? '认为证伪条件已触发' : 'found the falsifier met') : null,
        applied.evidence ? (isZh ? `新证据 ${applied.evidence}` : `${applied.evidence} new evidence`) : null,
        applied.assessed ? (isZh ? '更新了立场' : 'stance updated') : null,
        applied.replies ? (isZh ? `回复 ${applied.replies} 条评论` : `${applied.replies} replies`) : null,
        applied.applied?.length ? (isZh ? `改了 ${applied.applied.length} 段` : `${applied.applied.length} edits`) : null,
        applied.proposed?.length ? (isZh ? `提了 ${applied.proposed.length} 处修改建议` : `${applied.proposed.length} proposals`) : null,
        applied.dropped?.length ? (isZh ? `丢弃 ${applied.dropped.length} 条没打开过的链接` : `${applied.dropped.length} unseen links dropped`) : null,
      ].filter(Boolean)
      const opened = (item.pages ?? []).filter(page => page.url)
      return h('div', { className: 'rb-rs' },
        h('div', { className: 'rb-ev-when' }, when(item.started_at)),
        h('div', null,
          h('div', { className: 'rb-rs-meta' }, [
            MODE_NAMES[item.mode] ?? item.mode,
            isZh ? `搜索 ${item.searches} 次` : `${item.searches} searches`,
            item.fetches ? (isZh ? `读网页 ${item.fetches} 次` : `${item.fetches} pages read`) : null,
            seconds === null ? null : durationText(seconds * 1000),
            money(item.cost),
          ].filter(Boolean).join(' · ')),
          item.error
            ? h('div', { className: 'rb-rs-err' }, `${isZh ? '没有完成：' : 'Not finished: '}${researchErrorText(item.error)}`)
            : h('div', { className: 'rb-rs-sum' }, item.summary || (isZh ? '（没有摘要）' : '(no summary)')),
          wrote.length ? h('div', { className: 'rb-rs-meta', style: { marginTop: 3 } }, wrote.join(' · ')) : null,
          item.material ? h('div', { className: 'rb-rs-meta', style: { marginTop: 3 } }, materialText(item.material)) : null,
          item.queries?.length || opened.length || item.answer ? h('details', null,
            h('summary', null, isZh ? '看它查了什么' : 'What it looked at'),
            item.queries?.length ? h('ul', null, item.queries.map((query, index) => h('li', { key: `q${index}` }, String(query)))) : null,
            opened.length ? h('ul', null, opened.map((page, index) => h('li', { key: `p${index}` },
              `${page.action === 'find_in_page' ? (isZh ? '页内查找' : 'find') : (isZh ? '读' : 'read')} `,
              h('a', { href: page.url, target: '_blank', rel: 'noreferrer' }, page.url),
              page.pattern ? ` 「${page.pattern}」` : null))) : null,
            item.answer ? h('div', { className: 'rb-rs-answer' }, item.answer) : null) : null,
        ))
    }

    function Detail({ topic, timeline, loading, running, soon, actions }) {
      const [researching, setResearching] = useState(false)
      const [shown, setShown] = useState(20)
      const [tab, setTab] = useState('comments')
      const [active, setActive] = useState(null)
      const [focus, setFocus] = useState(null)
      const [sel, setSel] = useState(null)
      const innerRef = useRef(null)
      const topicRef = useRef(topic)
      topicRef.current = topic
      // Switching topics starts shallow again instead of inheriting the last state.
      useEffect(() => { setShown(20); setActive(null); setSel(null); setFocus(null) }, [topic?.id])

      const record = topic && timeline?.topic?.id === topic.id ? timeline : null
      const log = record?.log ?? []
      const threads = useMemo(() => threadsOf(log), [record])

      // A drag inside one passage offers a comment on exactly that text.
      const onMouseUp = useCallback(event => {
        if (event.target.closest?.('.rb-pop, .rb-bubble, textarea, input, select, button')) return
        const selection = window.getSelection()
        if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !innerRef.current) return
        const range = selection.getRangeAt(0)
        const passageOf = node => (node.nodeType === 1 ? node : node.parentElement)?.closest?.('[data-field]')
        const passage = passageOf(range.startContainer)
        if (!passage || passage !== passageOf(range.endContainer)) { setSel(null); return }
        const field = passage.dataset.field
        const value = String(topicRef.current?.[field] ?? '')
        const start = textOffset(passage, range.startContainer, range.startOffset)
        const end = textOffset(passage, range.endContainer, range.endOffset)
        if (start === null || end === null || end <= start) return
        const raw = value.slice(start, end)
        const quote = raw.trim()
        if (quote === '') return
        const rect = range.getBoundingClientRect()
        const box = innerRef.current.getBoundingClientRect()
        setSel({
          field,
          quote,
          start: start + raw.indexOf(quote),
          top: rect.bottom - box.top + 6,
          left: Math.max(0, Math.min(rect.left - box.left, box.width - 300)),
          composing: false,
        })
      }, [])

      // The selection button goes away with the selection; an open comment box stays until cancelled.
      useEffect(() => {
        if (!sel || sel.composing) return
        const onDown = event => { if (!event.target.closest?.('.rb-bubble')) setSel(null) }
        document.addEventListener('mousedown', onDown)
        return () => document.removeEventListener('mousedown', onDown)
      }, [sel])

      const activate = useCallback(id => {
        setActive(id)
        setTab('comments')
        if (id !== null) requestAnimationFrame(() => document.getElementById(`rb-thread-${id}`)?.scrollIntoView({ block: 'nearest' }))
      }, [])

      const jump = useCallback(thread => {
        setActive(thread.id)
        const root = innerRef.current
        const node = root?.querySelector(`[data-thread="${thread.id}"]`) ?? root?.querySelector(`[data-field="${thread.root.anchor?.field}"]`)
        node?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
      }, [])

      const openVersion = useCallback(id => { setFocus(id); setTab('history') }, [])
      const toComments = useCallback(() => {
        setTab('comments')
        const rail = innerRef.current?.closest('.rb-detail')?.querySelector('.rb-rail')
        rail?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })
      }, [])
      const openThreads = threads.filter(thread => !thread.resolved).length

      if (!topic) {
        return h('div', { className: 'rb-doc' },
          h('div', { className: 'rb-empty' },
            h('h3', null, isZh ? '选一个议题' : 'Pick a topic'),
            h('p', null, isZh ? '左侧每一条都是一个可被证伪的命题，点开看它的证据和判断变化。' : 'Each row on the left is a falsifiable claim. Open one to see its evidence and stance history.'),
          ))
      }

      const evidence = record?.evidence ?? []
      const assessments = record?.assessments ?? []
      const owners = record?.owners ?? {}
      // The newest pending proposal per field; the log arrives newest first.
      const pendingByField = {}
      for (const item of log) {
        if (item.kind !== 'proposal' || item.state !== 'pending') continue
        for (const field of Object.keys(item.changes ?? {})) if (!pendingByField[field]) pendingByField[field] = item
      }
      const pending = [...new Set(Object.values(pendingByField))]
      const firstPassage = item => DOC_FIELDS.find(field => item.changes?.[field.key])?.key ?? null
      const headSuggestions = pending.filter(item => firstPassage(item) === null)
      const saveField = (field, value, base) => actions.edit(topic.id, { changes: { [field]: value }, base: { [field]: base } })
      // While the comment box is open the browser selection is gone (the box has
      // the focus), so the passage keeps the chosen text marked itself.
      const rangesFor = (field, value) => {
        const ranges = highlightRanges(value, threads, field)
        if (!sel?.composing || sel.field !== field) return ranges
        const end = sel.start + sel.quote.length
        return [...ranges.filter(range => range.end <= sel.start || range.start >= end), { start: sel.start, end, id: 'draft' }]
          .sort((x, y) => x.start - y.start)
      }
      const ownerLabel = field => {
        const owner = owners[field]
        if (!owner) return null
        const text = `${owner.author === 'human' ? (isZh ? '你改于' : 'you,') : (isZh ? 'AI 改于' : 'AI,')} ${when(owner.at)}`
        return h('button', {
          className: `rb-owner${owner.author === 'agent' ? ' ai' : ''}`,
          type: 'button',
          title: isZh ? '在历史里查看这次修改' : 'Show this change in the history',
          onClick: () => openVersion(owner.log_id),
        }, text)
      }

      const evidenceRows = (() => {
        let cursor = null
        let newerAt = null
        const rows = []
        evidence.forEach((item, index) => {
          const stamp = item.published_at ?? item.captured_at
          const key = stamp ? dayKey(stamp) : null
          if (stamp && newerAt !== null) {
            const gap = Math.round((Date.parse(newerAt) - Date.parse(stamp)) / 86400000)
            if (gap >= 2) rows.push({ gap })
          }
          rows.push({ item, index, showDate: key !== null && key !== cursor })
          if (key !== null) cursor = key
          if (stamp) newerAt = stamp
        })
        return rows
      })()
      const silence = silenceOf(topic.last_evidence_at)
      const visibleRows = evidenceRows.slice(0, shown)
      // Count evidence only: the "N days without evidence" separators are rows too.
      const hiddenRows = evidenceRows.slice(shown).filter(row => row.item).length
      const stanceValue = topic.stance

      return h(React.Fragment, null,
        h('div', { className: 'rb-doc' },
          h('div', { className: 'rb-doc-in', ref: innerRef, onMouseUp },
            h('div', { className: 'rb-dhead' },
              h('div', { style: { minWidth: 0, flex: '1 1 auto' } },
                h(Passage, {
                  key: `${topic.id}-title`,
                  field: 'title',
                  heading: true,
                  value: topic.title ?? '',
                  proposal: pendingByField.title,
                  ranges: rangesFor('title', topic.title ?? ''),
                  activeThread: active,
                  onActivate: activate,
                  onSave: saveField,
                }),
                h('div', { className: 'rb-dmeta' },
                  h('select', {
                    className: 'rb-status',
                    value: topic.status,
                    'aria-label': fieldName('status'),
                    onChange: event => actions.edit(topic.id, { changes: { status: event.target.value }, base: { status: topic.status } }),
                  },
                    ['active', 'paused', 'closed'].map(status => h('option', { key: status, value: status }, statusName(status))),
                    topic.status === 'merged' ? h('option', { value: 'merged', disabled: true }, statusName('merged')) : null),
                  h('span', { className: 'rb-sep' }, ' · '),
                  h('select', {
                    className: 'rb-status',
                    value: topic.importance ?? 'medium',
                    'aria-label': fieldName('importance'),
                    title: IMPORTANCE_HINT,
                    onChange: event => actions.edit(topic.id, { changes: { importance: event.target.value }, base: { importance: topic.importance } }),
                  },
                    IMPORTANCE.map(value => h('option', { key: value, value }, isZh ? `重要性 ${importanceName(value)}` : `${importanceName(value)} importance`))),
                  topic.status === 'active' ? h('span', null, h('span', { className: 'rb-sep' }, ' · '),
                    h('button', {
                      className: 'rb-status', type: 'button', disabled: researching || running,
                      title: isZh ? `按重要性${importanceName(topic.importance ?? 'medium')}的方式现在研究这个议题，不等定时巡检` : 'Research this topic now instead of waiting for the scheduled pass',
                      onClick: async () => {
                        setResearching(true)
                        try { await actions.research(topic.id) } finally { setResearching(false) }
                      },
                    }, researching ? (isZh ? '正在开始…' : 'starting…') : (isZh ? '立即研究' : 'Research now'))) : null,
                  [
                    topic.next_due_at ? `${t('nextDue')} ${dueText(topic.next_due_at)}` : null,
                    `${topic.evidence_count ?? 0} ${isZh ? '条证据' : 'evidence'}`,
                    topic.stance_at ? `${isZh ? '上次评估' : 'assessed'} ${when(topic.stance_at, 'long')}` : null,
                  ].filter(Boolean).map((text, index) => h('span', { key: index }, h('span', { className: 'rb-sep' }, '· '), text)),
                  silence ? h('span', null, h('span', { className: 'rb-sep' }, '· '), h('span', { className: 'warn' }, silence)) : null,
                  running ? h('span', null, h('span', { className: 'rb-sep' }, '· '), h('span', { className: 'rb-live' }, isZh ? 'AI 正在研究…' : 'AI researching…')) : null,
                  // Only shown when the rail sits below the text, where it is out of sight.
                  h('span', { className: 'rb-tocomments' }, h('span', { className: 'rb-sep' }, '· '),
                    h('button', { className: 'rb-status', type: 'button', onClick: toComments },
                      openThreads > 0 ? `${isZh ? '评论' : 'Comments'} ${openThreads}` : (isZh ? '评论' : 'Comments'))),
                ),
              ),
              h('div', { className: 'rb-stance-box' },
                h('div', { className: 'rb-stance-val', style: { color: stanceColor(stanceValue) } },
                  stanceValue === null || stanceValue === undefined ? '—' : stanceValue.toFixed(2)),
                h('div', { className: 'rb-stance-cap' }, isZh ? '当前立场' : 'stance'),
              ),
            ),

            // The AI found the falsifier met. It stays until the reader dismisses it,
            // rewrites the falsifier or stops following the topic.
            topic.falsified_at && topic.status === 'active' ? h('div', { className: 'rb-sugg falsified' },
              h('div', { className: 'rb-sugg-head' },
                h('b', null, isZh ? 'AI 认为证伪条件已经触发' : 'The AI thinks the falsifier is met'),
                ` · ${when(topic.falsified_at, 'long')}`),
              topic.falsified_note ? h('div', { className: 'rb-sugg-why' }, topic.falsified_note) : null,
              h('div', { className: 'rb-sugg-acts' },
                h('button', { className: 'rb-btn', type: 'button', onClick: () => actions.dismissFalsified(topic.id) }, isZh ? '知道了' : 'Dismiss'),
                h('span', { className: 'rb-sugg-head' }, isZh
                  ? '核对后可以把议题改成已结束，或改写证伪条件，提醒会一起消失。'
                  : 'Closing the topic or rewriting the falsifier also clears this.'))) : null,

            headSuggestions.map(item => h(Suggestion, { key: item.id, item, topic, onDecide: actions.decide })),

            h('div', { className: 'rb-fields' },
              DOC_FIELDS.map(({ key, label, cls }) => {
                const proposal = pendingByField[key]
                const value = topic[key] ?? ''
                return h('section', { className: `rb-field${cls ? ` ${cls}` : ''}`, key },
                  h('h4', null, h('span', null, t(label)), ownerLabel(key)),
                  h(Passage, {
                    key: `${topic.id}-${key}`,
                    field: key,
                    value,
                    proposal,
                    ranges: proposal ? [] : rangesFor(key, value),
                    activeThread: active,
                    onActivate: activate,
                    onSave: saveField,
                  }),
                  proposal && firstPassage(proposal) === key ? h(Suggestion, { item: proposal, topic, onDecide: actions.decide }) : null,
                )
              }),
            ),

            h('div', { className: 'rb-sec' },
              h('h3', null, isZh ? '立场走势' : 'Stance trend',
                h('span', null, isZh ? '−1 空头确认 · 0 多空胶着 · +1 多头确认' : '−1 bear case confirmed · 0 mixed · +1 bull case confirmed')),
              h(Sparkline, { history: topic.history }),
            ),

            topic.stance_reason ? h('div', { className: 'rb-sec' },
              h('h3', null, isZh ? '上次改判理由' : 'Why it last moved'),
              h('div', { style: { fontSize: 12.5, lineHeight: 1.65, color: 'var(--dsw-alias-label-secondary)' } }, h(Clamp, { text: topic.stance_reason, lines: 4 })),
            ) : null,

            h('div', { className: 'rb-sec' },
              h('h3', null, t('timeline'), h('span', null, `${evidence.length} ${isZh ? '条' : 'items'}`)),
              loading ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('loading'))
                : evidence.length === 0
                  ? h('div', { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', padding: '10px 0' } }, t('noEvidence'))
                  : h('div', { className: 'rb-tl' },
                    visibleRows.map((row, position) => row.gap
                      ? h('div', { className: 'rb-gap', key: `gap-${position}` },
                        isZh ? `${row.gap} 天没有新证据` : `${row.gap}d quiet`)
                      : h(EvidenceRow, { key: row.item.id, item: row.item, index: row.index, showDate: row.showDate })),
                    hiddenRows > 0
                      ? h('button', {
                        className: 'rb-loadmore',
                        type: 'button',
                        onClick: () => setShown(value => value + 20),
                      }, isZh ? `还有 ${hiddenRows} 条，显示更多` : `${hiddenRows} more`)
                      : null),
            ),

            assessments.length > 0 ? h('div', { className: 'rb-sec' },
              h('h3', null, t('assessments'), h('span', null, `${assessments.length} ${isZh ? '次' : 'records'}`)),
              h('div', null, assessments.map(item => h('div', { className: 'rb-asm', key: item.id },
                h('div', { className: 'rb-ev-when' }, when(item.created_at)),
                h('div', null,
                  h('div', { className: 'rb-asm-line' },
                    h('span', { className: 'rb-asm-stance rb-num', style: { color: stanceColor(item.stance) } }, item.stance.toFixed(2)),
                    item.flipped ? h('span', { className: 'rb-asm-flip' }, t('flipped')) : null,
                  ),
                  h('div', { className: 'rb-asm-why' }, item.rationale),
                ),
              ))),
            ) : null,

            record?.research?.length > 0 ? h('div', { className: 'rb-sec' },
              h('h3', null, isZh ? '研究记录' : 'Research log', h('span', null, isZh ? '最近 6 次' : 'last 6')),
              h('div', null, record.research.map(item => h(ResearchRow, { key: item.id, item })))) : null,

            sel && !sel.composing ? h('button', {
              className: 'rb-bubble',
              type: 'button',
              style: { top: sel.top, left: sel.left },
              onMouseDown: event => event.preventDefault(),
              onClick: () => setSel(previous => ({ ...previous, composing: true })),
            }, isZh ? '评论' : 'Comment') : null,
            sel && sel.composing ? h(CommentPop, {
              sel,
              onCancel: () => setSel(null),
              onSubmit: async (body, ask) => {
                const result = await actions.comment(topic.id, {
                  body,
                  anchor: { field: sel.field, quote: sel.quote, start: sel.start },
                  ask_ai: ask,
                })
                if (result.ok) {
                  setSel(null)
                  window.getSelection()?.removeAllRanges()
                  activate(result.data?.thread_id ?? null)
                }
                return result
              },
            }) : null,
          ),
        ),
        h(Rail, {
          topic, log, threads, tab, setTab, active, focus, running, soon, actions,
          onActivate: activate,
          onJump: jump,
        }),
      )
    }

    // ---------------------------------------------------------------- panel

    // ---------------------------------------------------------------- boards and cadence

    const BOARD_KEY = 'thesis-trail:board'
    const readStoredBoard = () => { try { return window.localStorage.getItem(BOARD_KEY) } catch { return null } }
    const storeBoard = id => { try { window.localStorage.setItem(BOARD_KEY, id) } catch { /* storage blocked: the panel opens on the first board */ } }
    /** A panel path scoped to one board. */
    const onBoard = (path, board) => board ? `${path}${path.includes('?') ? '&' : '?'}board=${encodeURIComponent(board)}` : path

    // ISO weekday order: 1 = Monday … 7 = Sunday.
    const ISO_DAYS = isZh ? ['一', '二', '三', '四', '五', '六', '日'] : ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

    function daysText(days) {
      const list = [...(days ?? [])].sort((a, b) => a - b)
      if (list.join() === '1,2,3,4,5') return isZh ? '工作日' : 'weekdays'
      if (list.length === 7) return isZh ? '每天' : 'daily'
      return isZh ? `每周${list.map(day => ISO_DAYS[day - 1]).join('、')}` : list.map(day => ISO_DAYS[day - 1]).join(' ')
    }

    /** "每天 08:30", "每周一、四 07:45", "已暂停". */
    function cadenceText(schedule) {
      if (!schedule) return isZh ? '没有定时' : 'no schedule'
      if (schedule.cadence === 'paused') return isZh ? '已暂停' : 'paused'
      const time = schedule.time ? String(schedule.time).slice(0, 5) : ''
      const rule = schedule.cadence === 'weekly' ? daysText(schedule.weekdays) : (isZh ? '每天' : 'daily')
      return `${rule} ${time}`.trim()
    }

    /** Costs here are cents per pass: keep three digits under one yuan. */
    function money(value, currency = 'CNY') {
      if (value === null || value === undefined) return '—'
      const sign = currency === 'CNY' ? '¥' : `${currency} `
      if (value === 0) return `${sign}0`
      if (value < 0.001) return `<${sign}0.001`
      return `${sign}${value < 1 ? value.toFixed(3) : value.toFixed(2)}`
    }

    function tokenText(value) {
      const n = Number(value ?? 0)
      if (n < 1000) return String(n)
      if (n < 1e6) return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}K`
      return `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)}M`
    }

    function durationText(ms) {
      if (!(ms >= 0)) return '—'
      const seconds = Math.round(ms / 1000)
      if (seconds < 60) return isZh ? `${seconds} 秒` : `${seconds}s`
      const minutes = Math.floor(seconds / 60)
      return isZh ? `${minutes} 分 ${seconds % 60} 秒` : `${minutes}m ${seconds % 60}s`
    }

    function Chevron() {
      return h('svg', { width: 9, height: 9, viewBox: '0 0 10 10', fill: 'none', 'aria-hidden': true, className: 'rb-chev' },
        h('path', { d: 'M2 3.6 5 6.6 8 3.6', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    /**
     * How often a board's pass runs: every day, on chosen weekdays, or paused.
     * Pausing keeps the days and time, so resuming brings the same rule back.
     */
    function CadenceControl({ schedule, onSave, compact }) {
      const cadence = schedule?.cadence === 'missing' || !schedule ? 'paused' : schedule.cadence
      const days = schedule?.weekdays?.length ? schedule.weekdays : [1]
      const toggleDay = day => {
        const next = days.includes(day) ? days.filter(item => item !== day) : [...days, day].sort((a, b) => a - b)
        if (next.length > 0) onSave({ weekdays: next })
      }
      return h('div', { className: `rb-sched${compact ? ' compact' : ''}` },
        h('span', { className: 'rb-sched-pick' },
          h('select', {
            className: 'rb-sched-mode',
            value: cadence,
            'aria-label': isZh ? '巡检频率' : 'Pass cadence',
            onChange: event => onSave({ cadence: event.target.value }),
          },
            h('option', { value: 'daily' }, isZh ? '每天' : 'Daily'),
            h('option', { value: 'weekly' }, isZh ? '每周' : 'Weekly'),
            h('option', { value: 'paused' }, isZh ? '暂停' : 'Paused')),
          h(Chevron)),
        cadence === 'weekly' ? h('span', { className: 'rb-days', role: 'group', 'aria-label': isZh ? '每周哪几天' : 'Days' },
          [1, 2, 3, 4, 5, 6, 7].map(day => h('button', {
            key: day,
            type: 'button',
            className: days.includes(day) ? 'on' : '',
            'aria-pressed': days.includes(day),
            title: days.includes(day) && days.length === 1 ? (isZh ? '至少留一天' : 'Keep at least one day') : undefined,
            onClick: () => toggleDay(day),
          }, ISO_DAYS[day - 1]))) : null,
        cadence !== 'paused' ? h('input', {
          type: 'time',
          className: 'rb-sched-time',
          // The service stores HH:mm:ss.SSS; a time control only accepts HH:mm.
          value: schedule?.time ? String(schedule.time).slice(0, 5) : '08:30',
          step: 60,
          title: schedule?.timeZone ?? undefined,
          'aria-label': isZh ? '巡检时间' : 'Pass time',
          onChange: event => { if (event.target.value) onSave({ time: event.target.value }) },
        }) : null)
    }

    /** The board picker in the header: one board per company or asset tracked. */
    function BoardSwitcher({ boards, current, currency, onPick, onNew, onImport, onExport, onSources, onOpen }) {
      const [open, setOpen] = useState(false)
      const ref = useRef(null)
      useEffect(() => {
        if (!open) return
        const away = event => { if (ref.current && !ref.current.contains(event.target)) setOpen(false) }
        const key = event => { if (event.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', away)
        document.addEventListener('keydown', key)
        return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key) }
      }, [open])
      const board = boards?.find(item => item.id === current)
      return h('div', { className: 'rb-boardpick', ref },
        h('button', {
          type: 'button', className: 'rb-board-btn', 'aria-expanded': open, 'aria-haspopup': 'menu',
          onClick: () => { if (!open) onOpen?.(); setOpen(!open) },
          title: isZh ? '切换标的' : 'Switch board',
        }, h('span', { className: 'rb-board-name' }, board?.title ?? current ?? ''), h(Chevron)),
        open ? h('div', { className: 'rb-menu', role: 'menu' },
          (boards ?? []).map(item => {
            const waiting = (item.stats?.pending_proposals ?? 0)
            const unread = (item.badge?.unread ?? 0) + (item.badge?.agent ?? 0) + (item.badge?.flipped_other ?? 0)
            return h('button', {
              key: item.id, type: 'button', role: 'menuitem',
              className: `rb-menu-item${item.id === current ? ' on' : ''}`,
              onClick: () => { setOpen(false); onPick(item.id) },
            },
              h('span', { className: 'rb-menu-title' }, item.title,
                unread > 0 && item.id !== current ? h('span', { className: 'rb-row-unread' }, ` ${unread}`) : null),
              h('span', { className: 'rb-menu-meta' },
                h('span', { className: item.schedule?.cadence === 'paused' ? 'warn' : '' }, cadenceText(item.schedule)),
                h('span', { className: 'rb-sep' }, '·'),
                `${item.stats?.topics ?? 0} ${isZh ? '个议题' : 'topics'}`,
                waiting > 0 ? h('span', null, h('span', { className: 'rb-sep' }, ' · '), isZh ? `待决定 ${waiting}` : `${waiting} to decide`) : null,
                h('span', { className: 'rb-sep' }, '·'),
                `${isZh ? '本月' : 'month'} ${money(item.month_cost, currency)}`))
          }),
          h('div', { className: 'rb-menu-foot' },
            h('button', { type: 'button', className: 'rb-link', onClick: () => { setOpen(false); onNew() } }, isZh ? '新标的' : 'New board'),
            h('button', { type: 'button', className: 'rb-link', onClick: () => { setOpen(false); onImport() } }, isZh ? '导入' : 'Import'),
            h('button', { type: 'button', className: 'rb-link', onClick: () => { setOpen(false); onExport() } }, isZh ? '导出这个标的' : 'Export this board'),
            h('button', { type: 'button', className: 'rb-link', onClick: () => { setOpen(false); onSources() } }, isZh ? '数据源' : 'Sources')))
          : null)
    }

    /** Add a board: a name, a note, and how often its pass runs. */
    function BoardForm({ onSubmit, onCancel }) {
      const [title, setTitle] = useState('')
      const [note, setNote] = useState('')
      const [rule, setRule] = useState({ cadence: 'daily', time: '08:30', weekdays: [1] })
      const [saving, setSaving] = useState(false)
      const [message, setMessage] = useState(null)
      const submit = async () => {
        if (saving) return
        if (title.trim() === '') { setMessage(isZh ? '名称不能为空' : 'Name is required'); return }
        setSaving(true)
        setMessage(null)
        const result = await onSubmit({ title, note, ...rule })
        setSaving(false)
        if (!result.ok) setMessage(errorText(result))
      }
      const onKeyDown = event => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submit() }
        if (event.key === 'Escape') { event.preventDefault(); onCancel() }
      }
      return h('div', { className: 'rb-form', onKeyDown },
        h('h2', { className: 'rb-dtitle' }, isZh ? '新标的' : 'New board'),
        h('p', { className: 'rb-form-lead' }, isZh
          ? '每个标的有自己的议题和自己的定时巡检。不想每天跟踪时，把频率改成每周几天或暂停，议题和记录都保留。'
          : 'Each board has its own topics and its own scheduled pass. Run it on some weekdays or pause it; topics and records stay.'),
        h('div', { className: 'rb-form-row' },
          h('label', { htmlFor: 'rb-b-title' }, isZh ? '名称' : 'Name'),
          h('input', {
            id: 'rb-b-title', className: 'rb-input', value: title, autoFocus: true,
            placeholder: isZh ? '例如 NVIDIA (NVDA)，括号里的代码会用作标识' : 'e.g. NVIDIA (NVDA); the ticker becomes its id',
            onChange: event => setTitle(event.target.value),
          })),
        h('div', { className: 'rb-form-row' },
          h('label', { htmlFor: 'rb-b-note' }, isZh ? '说明' : 'Note', h('span', { className: 'rb-opt' }, isZh ? ' · 可选' : ' · optional')),
          h('textarea', {
            id: 'rb-b-note', className: 'rb-input', rows: 2, value: note,
            placeholder: isZh ? '跟踪它的原因，显示在标题下面' : 'Why you track it; shown under the name',
            onChange: event => setNote(event.target.value),
          })),
        h('div', { className: 'rb-form-row' },
          h('span', { className: 'rb-form-label' }, isZh ? '巡检频率' : 'Cadence'),
          h(CadenceControl, {
            schedule: rule,
            onSave: patch => setRule(previous => ({ ...previous, ...patch })),
          })),
        h('div', { className: 'rb-form-actions' },
          h('button', { className: 'rb-btn primary', type: 'button', onClick: submit, disabled: saving },
            saving ? (isZh ? '创建中…' : 'Creating…') : (isZh ? '创建' : 'Create')),
          h('button', { className: 'rb-btn', type: 'button', onClick: onCancel, disabled: saving }, isZh ? '取消' : 'Cancel'),
          message
            ? h('span', { className: 'rb-form-msg' }, message)
            : h('span', { className: 'rb-form-hint' }, isZh ? `${SUBMIT_KEY} 创建 · Esc 取消` : `${SUBMIT_KEY} to create · Esc to cancel`)))
    }

    // ---------------------------------------------------------------- board files

    /** Where to put the key, for a reader who has none yet. */
    const KEY_HELP = isZh
      ? '在 dsh 的模型设置里配好 DeepSeek（循迹用同一把 key），或者在 ~/.dsh/.env 里写一行 DEEPSEEK_API_KEY=你的 key，然后点「刷新」。'
      : 'Set up DeepSeek in dsh\'s model settings (循迹 uses the same key), or add DEEPSEEK_API_KEY=your key to ~/.dsh/.env, then refresh.'

    /** One sentence per problem the Host found in a board file. */
    function problemText(problem) {
      const name = problem.title ? `「${problem.title}」` : (isZh ? `第 ${problem.topic} 个议题` : `topic ${problem.topic}`)
      if (!isZh) {
        const subject = problem.title ? `"${problem.title}"` : `topic ${problem.topic}`
        return {
          missing_board_title: 'The first heading must be "# Board name".',
          no_topics: 'No topics found; each starts with "## Title".',
          too_many_topics: `More than ${problem.limit} topics.`,
          file_too_long: 'The file is too long.',
          board_title_too_long: 'The board name is over 80 characters.',
          topic_needs_title: `${subject} has no title.`,
          topic_needs_thesis: `${subject} has no "Thesis:" line.`,
          topic_needs_falsifier: `${subject} has no "Falsifier:" line.`,
          invalid_importance: `${subject}: importance "${problem.value}" must be high, medium or low.`,
          unlabelled_text: `${subject}: a line has no field name: "${problem.text}"`,
          duplicate_topic_title: `${subject} appears twice.`,
        }[problem.code] ?? problem.code
      }
      return {
        missing_board_title: '第一个标题要是「# 标的名称」。',
        no_topics: '没有找到议题。每个议题用「## 标题」开头。',
        too_many_topics: `议题超过 ${problem.limit} 个。`,
        file_too_long: '文件太大了。',
        board_title_too_long: '标的名称超过 80 个字。',
        topic_needs_title: `${name}没有标题。`,
        topic_needs_thesis: `${name}缺少「命题：」。`,
        topic_needs_falsifier: `${name}缺少「证伪条件：」。`,
        invalid_importance: `${name}的重要性写成了「${problem.value}」，只能是高、中、低。`,
        unlabelled_text: `${name}有一行没有字段名：「${problem.text}」`,
        duplicate_topic_title: `${name}出现了两次。`,
      }[problem.code] ?? problem.code
    }

    /** How a previewed file reads: name, topic count by importance, cost of one pass. */
    function previewText(preview, currency) {
      const counts = { high: 0, medium: 0, low: 0 }
      for (const topic of preview.topics) counts[topic.importance] = (counts[topic.importance] ?? 0) + 1
      const parts = Object.entries(counts).filter(([, n]) => n > 0).map(([key, n]) => `${importanceName(key)} ${n}`)
      return isZh
        ? `${preview.topics.length} 个议题（${parts.join(' · ')}），全部研究一遍约 ${money(preview.estimate, currency)}`
        : `${preview.topics.length} topics (${parts.join(' · ')}); one pass over all of them costs about ${money(preview.estimate, currency)}`
    }

    /** Import a board file: paste or pick it, check it, choose a cadence, create. */
    function ImportForm({ onImported, onCancel, currency }) {
      const [markdown, setMarkdown] = useState('')
      const [rule, setRule] = useState({ cadence: 'daily', time: '08:30', weekdays: [1] })
      const [preview, setPreview] = useState(null)
      const [saving, setSaving] = useState(false)
      const [message, setMessage] = useState(null)
      const fileRef = useRef(null)
      // Check the file as the reader pastes, a moment after they stop.
      useEffect(() => {
        if (markdown.trim() === '') { setPreview(null); return }
        let alive = true
        const timer = setTimeout(async () => {
          const { ok, data } = await postJson('/board/import', { markdown, dry_run: true }).catch(() => ({ ok: false, data: {} }))
          if (alive) setPreview({ ok, ...data })
        }, 300)
        return () => { alive = false; clearTimeout(timer) }
      }, [markdown])
      const pick = async event => {
        const chosen = event.target.files?.[0]
        event.target.value = ''
        if (!chosen) return
        try { setMarkdown(await chosen.text()) } catch { setMessage(isZh ? '读不了这个文件' : 'Could not read the file') }
      }
      const ready = Boolean(preview?.ok)
      const submit = async () => {
        if (saving || !ready) return
        setSaving(true)
        setMessage(null)
        const result = await postJson('/board/import', { markdown, ...rule }).catch(() => ({ ok: false, data: {} }))
        setSaving(false)
        if (result.ok && result.data?.board) onImported(result.data)
        else if (result.data?.problems?.length) setPreview({ ok: false, ...result.data })
        else setMessage(errorText(result))
      }
      const onKeyDown = event => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submit() }
        if (event.key === 'Escape') { event.preventDefault(); onCancel() }
      }
      return h('div', { className: 'rb-form', onKeyDown },
        h('h2', { className: 'rb-dtitle' }, isZh ? '导入议题' : 'Import a board'),
        h('p', { className: 'rb-form-lead' }, isZh
          ? '粘贴议题文件的内容，或者选择一个 .md 文件。导入会新建一个标的，议题全部算作到期，下次巡检会每个都研究一遍。'
          : 'Paste a board file or choose a .md file. The import adds a new board; every topic is due, so the next pass researches each one.'),
        h('div', { className: 'rb-form-row' },
          h('span', { className: 'rb-form-label' },
            isZh ? '文件内容' : 'File',
            h('span', { className: 'rb-opt' }, ' · '),
            h('button', { type: 'button', className: 'rb-link', onClick: () => fileRef.current?.click() }, isZh ? '选择文件' : 'Choose a file'),
            h('input', { ref: fileRef, type: 'file', accept: '.md,.markdown,.txt,text/markdown,text/plain', hidden: true, onChange: pick })),
          h('textarea', {
            className: 'rb-input rb-mono-input', rows: 12, value: markdown, autoFocus: true, spellCheck: false,
            placeholder: isZh
              ? '# 标的名称\n\n说明（可选）\n\n## 议题标题\n- 重要性：中\n- 命题：…\n- 证伪条件：…\n- 多头预期：…\n- 空头担忧：…\n- 观察指标：…'
              : '# Board name\n\nNote (optional)\n\n## Topic title\n- Importance: medium\n- Thesis: …\n- Falsifier: …\n- Bull case: …\n- Bear case: …\n- Metric: …',
            onChange: event => setMarkdown(event.target.value),
          }),
          preview ? (preview.ok
            ? h('p', { className: 'rb-form-note' }, h('strong', { className: 'rb-ink' }, preview.title),
              ` · ${previewText(preview, currency)}`)
            : h('ul', { className: 'rb-problems' }, (preview.problems?.length ? preview.problems : [{ code: preview.error ?? 'unknown' }])
              .slice(0, 8).map((problem, index) => h('li', { key: index }, problemText(problem))))) : null),
        h('div', { className: 'rb-form-row' },
          h('span', { className: 'rb-form-label' }, isZh ? '巡检频率' : 'Cadence'),
          h(CadenceControl, { schedule: rule, onSave: patch => setRule(previous => ({ ...previous, ...patch })) })),
        h('div', { className: 'rb-form-actions' },
          h('button', { className: 'rb-btn primary', type: 'button', onClick: submit, disabled: saving || !ready },
            saving ? (isZh ? '导入中…' : 'Importing…') : (isZh ? '导入' : 'Import')),
          h('button', { className: 'rb-btn', type: 'button', onClick: onCancel, disabled: saving }, isZh ? '取消' : 'Cancel'),
          message
            ? h('span', { className: 'rb-form-msg' }, message)
            : h('span', { className: 'rb-form-hint' }, isZh ? `${SUBMIT_KEY} 导入 · Esc 取消` : `${SUBMIT_KEY} to import · Esc to cancel`)))
    }

    const SOURCE_NAMES = isZh
      ? { fda: 'FDA 审批', trials: '临床试验', news: '新闻', papers: '论文' }
      : { fda: 'FDA decisions', trials: 'clinical trials', news: 'news', papers: 'papers' }
    const SOURCE_NOTES = isZh
      ? {
        fda: '510(k) 和 PMA 的器械批准记录',
        trials: 'ClinicalTrials.gov 上公司发起、最近有更新的试验',
        news: 'Google News 按公司名搜索的英文标题，只作线索',
        papers: 'PubMed 上作者单位含公司名的论文',
      }
      : {
        fda: '510(k) clearances and PMA approvals for devices',
        trials: 'ClinicalTrials.gov studies the company sponsors, recently updated',
        news: 'Google News headlines for the company name; leads only',
        papers: 'PubMed papers with the company in an author affiliation',
      }

    /** The header line under the board name: what the board gathers from. */
    function sourceLineText(sources) {
      if (!sources) return isZh ? '数据源' : 'Sources'
      if (!sources.search_names?.length) return isZh ? '数据源：没有可检索的名字，只靠联网搜索' : 'Sources: no name to search; web search only'
      const on = Object.keys(SOURCE_NAMES).filter(key => sources.enabled?.[key]).map(key => SOURCE_NAMES[key])
      return `${isZh ? '数据源：' : 'Sources: '}${sources.search_names.join(' | ')}${on.length ? ` · ${on.join(isZh ? '、' : ', ')}` : (isZh ? ' · 全部关闭' : ' · all off')}`
    }

    /** What a pass gathered, for the research log. */
    function materialText(material) {
      const counts = Object.entries(material.counts ?? {}).map(([key, n]) => `${SOURCE_NAMES[key] ?? key} ${n}`)
      const failed = Object.keys(material.errors ?? {}).map(key => SOURCE_NAMES[key] ?? (isZh ? '全部' : 'all'))
      return [
        `${isZh ? '一手材料' : 'Primary material'}${material.since ? (isZh ? `（${material.since} 起）` : ` (since ${material.since})`) : ''}：${counts.join(' · ') || (isZh ? '无' : 'none')}`,
        failed.length ? (isZh ? `${failed.join('、')}没取到` : `${failed.join(', ')} failed`) : null,
      ].filter(Boolean).join(isZh ? '；' : '; ')
    }

    /** Where a board's primary material comes from: search names and source switches. */
    function SourcesSheet({ board, title, onClose, onSaved }) {
      const [loaded, setLoaded] = useState(null)
      const [searchName, setSearchName] = useState('')
      const [enabled, setEnabled] = useState({})
      // Only switches the reader touched are saved, so untouched healthcare
      // sources still follow the FDA and trial check.
      const [touched, setTouched] = useState({})
      const [saving, setSaving] = useState(false)
      const [message, setMessage] = useState(null)
      const fill = sources => {
        setLoaded(sources)
        setSearchName(sources.search_name ?? '')
        setEnabled(sources.enabled ?? {})
        setTouched({})
      }
      useEffect(() => {
        let alive = true
        request('/boards').then(data => {
          const item = data.boards.find(entry => entry.id === board)
          if (alive && item) fill(item.sources)
        }).catch(() => { if (alive) setMessage(isZh ? '读取失败' : 'Could not load') })
        return () => { alive = false }
      }, [board])
      const save = async () => {
        setSaving(true)
        setMessage(null)
        const switches = Object.fromEntries(Object.keys(touched).map(key => [key, enabled[key] === true]))
        const result = await postJson('/board/sources', { board, search_name: searchName, sources: switches }).catch(() => null)
        setSaving(false)
        if (!result?.ok) {
          setMessage(result?.data?.error === 'search_name_too_long' ? (isZh ? '检索用名太长了。' : 'The search names are too long.') : (isZh ? '保存失败' : 'Save failed'))
          return
        }
        fill(result.data.sources)
        setMessage(isZh ? '已保存，下次巡检开始生效。' : 'Saved; the next pass uses it.')
        onSaved?.()
      }
      const onKeyDown = event => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); save() }
        if (event.key === 'Escape') { event.preventDefault(); onClose() }
      }
      const health = loaded?.health === true
        ? (isZh ? '按这些名字查到了 FDA 或临床试验记录，FDA、临床试验和论文默认开启。' : 'FDA or trial records were found under these names, so FDA, trials and papers are on by default.')
        : loaded?.health === false
          ? (isZh ? '按这些名字没查到 FDA 或临床试验记录，FDA、临床试验和论文默认关闭，需要时可以手动打开。' : 'No FDA or trial records under these names, so FDA, trials and papers are off by default; switch them on if needed.')
          : (isZh ? '第一次取材时会按这些名字查一次 FDA 和临床试验记录，查到就自动打开 FDA、临床试验和论文。' : 'The first gather checks FDA and trial records under these names once and switches on FDA, trials and papers if any exist.')
      return h('div', { className: 'rb-form', onKeyDown },
        h('h2', { className: 'rb-dtitle' }, isZh ? `「${title}」的数据源` : `Sources for "${title}"`),
        h('p', { className: 'rb-form-lead' }, isZh
          ? '每次巡检前，循迹先从下面这些公开数据源按公司名取上次检查以来的新记录，放在每个议题的研究提示词前面，再让模型联网搜索补充。这些来源不用注册，也不用填任何信息。取材本身免费；提示词变长，十个议题一轮大约多花几分钱。'
          : 'Before each pass, 循迹 fetches what is new since the last check from these public sources by company name and puts it ahead of every topic\'s research prompt; the model then searches the web as before. No sign-up or details are needed. Fetching is free; the longer prompt adds a few cents per pass of ten topics.'),
        loaded ? [
          h('div', { className: 'rb-form-row', key: 'name' },
            h('span', { className: 'rb-form-label' }, isZh ? '检索用名' : 'Search names', h('span', { className: 'rb-opt' }, isZh ? ' · 选填' : ' · optional')),
            h('input', { className: 'rb-input', value: searchName, placeholder: loaded.search_names?.join(' | ') || (isZh ? '公司名' : 'Company name'), onChange: event => setSearchName(event.target.value) }),
            h('p', { className: 'rb-form-note' }, isZh
              ? '用英文公司名效果最好。多个名字用 | 隔开，比如公司改过名，可以写「新名 | 旧名」。不填就用标的名，去掉括号里的代码和 Inc. 之类的后缀。'
              : 'English company names work best. Separate several with |, for example "new name | old name" after a rename. Empty means the board name without the ticker in parentheses and suffixes such as Inc.')),
          h('div', { className: 'rb-form-row', key: 'list' },
            h('span', { className: 'rb-form-label' }, isZh ? '来源' : 'Sources'),
            h('div', { className: 'rb-srcs' }, Object.keys(SOURCE_NAMES).map(key => h('label', { key, className: 'rb-src' },
              h('input', { type: 'checkbox', checked: enabled[key] === true, onChange: event => { const on = event.target.checked; setEnabled(previous => ({ ...previous, [key]: on })); setTouched(previous => ({ ...previous, [key]: true })) } }),
              h('span', null, SOURCE_NAMES[key]),
              h('span', { className: 'rb-src-desc' }, SOURCE_NOTES[key])))),
            h('p', { className: 'rb-form-note' }, health)),
        ] : null,
        h('div', { className: 'rb-form-actions' },
          h('button', { className: 'rb-btn primary', type: 'button', onClick: save, disabled: saving || !loaded }, saving ? (isZh ? '保存中…' : 'Saving…') : (isZh ? '保存' : 'Save')),
          h('button', { className: 'rb-btn', type: 'button', onClick: onClose, disabled: saving }, isZh ? '关闭' : 'Close'),
          message ? h('span', { className: 'rb-form-msg' }, message) : h('span', { className: 'rb-form-hint' }, isZh ? `${SUBMIT_KEY} 保存 · Esc 关闭` : `${SUBMIT_KEY} to save · Esc to close`)))
    }

    /** A board's definition as a file to hand to someone else. */
    function ExportSheet({ board, title, onClose }) {
      const [markdown, setMarkdown] = useState(null)
      const [message, setMessage] = useState(null)
      useEffect(() => {
        let alive = true
        request(`/board/export?board=${encodeURIComponent(board)}${isZh ? '' : '&lang=en'}`)
          .then(data => { if (alive) setMarkdown(data.markdown) })
          .catch(() => { if (alive) setMessage(isZh ? '导出失败' : 'Export failed') })
        return () => { alive = false }
      }, [board])
      const copy = async () => {
        try { await navigator.clipboard.writeText(markdown); setMessage(isZh ? '已复制' : 'Copied') } catch { setMessage(isZh ? '复制失败，手动全选复制' : 'Copy failed; select the text instead') }
      }
      const save = () => {
        const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
        const link = document.createElement('a')
        link.href = url
        link.download = `${board}.md`
        document.body.appendChild(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      return h('div', { className: 'rb-form', onKeyDown: event => { if (event.key === 'Escape') { event.preventDefault(); onClose() } } },
        h('h2', { className: 'rb-dtitle' }, isZh ? `导出「${title}」` : `Export "${title}"`),
        h('p', { className: 'rb-form-lead' }, isZh
          ? '只导出标的名称、说明，以及进行中和暂停的议题：命题、证伪条件、多空预期、观察指标和重要性。研究记录、证据、评论和费用都不导出。对方在循迹里选「导入」，粘贴或选这个文件即可。'
          : 'Only the name, the note and the active or paused topics travel: thesis, falsifier, bull and bear case, metric and importance. Research, evidence, comments and costs stay here. The other reader uses Import in 循迹.'),
        h('div', { className: 'rb-form-row' },
          h('textarea', { className: 'rb-input rb-mono-input', rows: 14, readOnly: true, value: markdown ?? '', spellCheck: false, onFocus: event => event.target.select() })),
        h('div', { className: 'rb-form-actions' },
          h('button', { className: 'rb-btn primary', type: 'button', onClick: copy, disabled: !markdown }, isZh ? '复制' : 'Copy'),
          h('button', { className: 'rb-btn', type: 'button', onClick: save, disabled: !markdown }, isZh ? '下载 .md 文件' : 'Download .md'),
          h('button', { className: 'rb-btn', type: 'button', onClick: onClose }, isZh ? '关闭' : 'Close'),
          message ? h('span', { className: 'rb-form-hint' }, message) : null))
    }

    /** The first screen of a fresh install: what this is, the key, and two ways in. */
    function Welcome({ hasKey, onImport, onNew }) {
      return h('div', { className: 'rb-welcome' },
        h('h2', { className: 'rb-dtitle' }, isZh ? '开始跟踪一个标的' : 'Track your first board'),
        h('p', { className: 'rb-form-lead' }, isZh
          ? '每个标的下面是几条议题。一条议题是一个可以被证伪的命题，写明什么情况算证伪。AI 按你定的频率联网找新证据，判断命题是被支持还是被动摇，证伪条件被触发时会提醒你。议题由你和 AI 一起改：你写过的段落，AI 只能提建议。'
          : 'A board holds a few topics. Each topic is a falsifiable thesis with the outcome that would prove it wrong. On your schedule the AI searches the web for new evidence, judges whether each thesis holds, and alerts you when a falsifier is met. You and the AI edit the topics together; text you wrote, the AI can only suggest changes to.'),
        h('p', { className: `rb-keyline${hasKey ? '' : ' warn'}` }, hasKey
          ? (isZh ? '已找到 DeepSeek API key。研究按 DeepSeek 的价格计费，一个中等重要性的议题查一次约 ¥0.05。' : 'DeepSeek API key found. Research is billed at DeepSeek prices; a medium topic costs about ¥0.05 per check.')
          : `${isZh ? '还没有 DeepSeek API key，巡检不会运行。' : 'No DeepSeek API key yet, so no pass will run. '}${KEY_HELP}`),
        h('div', { className: 'rb-choices' },
          h('button', { type: 'button', className: 'rb-choice', onClick: onImport },
            h('span', { className: 'rb-choice-title' }, isZh ? '导入议题文件' : 'Import a board file'),
            h('span', { className: 'rb-choice-text' }, isZh ? '别人分享给你的 .md 议题文件，或你从别处导出的。' : 'A .md board file someone shared, or one you exported.')),
          h('button', { type: 'button', className: 'rb-choice', onClick: onNew },
            h('span', { className: 'rb-choice-title' }, isZh ? '新建标的' : 'New board'),
            h('span', { className: 'rb-choice-text' }, isZh ? '从空白开始，自己写议题。' : 'Start blank and write the topics yourself.'))))
    }

    // ---------------------------------------------------------------- usage

    const RANGES = {
      day: { count: 30, label: isZh ? '日' : 'Day', title: isZh ? '每天费用' : 'Cost per day' },
      week: { count: 12, label: isZh ? '周' : 'Week', title: isZh ? '每周费用' : 'Cost per week' },
      month: { count: 12, label: isZh ? '月' : 'Month', title: isZh ? '每月费用' : 'Cost per month' },
    }

    /** The bucket a pass falls in, in local time: day, Monday-start week, or month. */
    function bucketStart(date, range) {
      if (range === 'month') return new Date(date.getFullYear(), date.getMonth(), 1)
      const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
      if (range === 'week') day.setDate(day.getDate() - ((day.getDay() + 6) % 7))
      return day
    }

    function bucketsOf(passes, range) {
      const now = new Date()
      const { count } = RANGES[range]
      const list = []
      let start = bucketStart(now, range)
      for (let index = 0; index < count; index += 1) {
        list.unshift({ start, cost: 0, passes: 0, tokens: 0 })
        start = new Date(start)
        if (range === 'month') start.setMonth(start.getMonth() - 1)
        else start.setDate(start.getDate() - (range === 'week' ? 7 : 1))
      }
      const byKey = new Map(list.map(bucket => [bucket.start.getTime(), bucket]))
      for (const pass of passes) {
        const bucket = byKey.get(bucketStart(new Date(pass.started_at), range).getTime())
        if (!bucket) continue
        bucket.cost += pass.cost ?? 0
        bucket.passes += 1
        bucket.tokens += pass.input + pass.cache_hit + pass.output
      }
      return list
    }

    function bucketLabel(start, range, long) {
      const month = start.getMonth() + 1
      if (range === 'month') return isZh ? (long ? `${start.getFullYear()}年${month}月` : `${month}月`) : start.toLocaleDateString(undefined, { month: 'short', ...long ? { year: 'numeric' } : {} })
      const day = isZh ? `${month}/${start.getDate()}` : `${month}/${start.getDate()}`
      if (range === 'week') return long ? (isZh ? `${month}月${start.getDate()}日起的一周` : `week of ${day}`) : day
      return long ? dayLabel(start.toISOString()) : day
    }

    /** A rounded-up axis maximum: 1, 2 or 5 times a power of ten. */
    function niceMax(value) {
      if (!(value > 0)) return 0.01
      const power = 10 ** Math.floor(Math.log10(value))
      return [1, 2, 5, 10].map(step => step * power).find(step => step >= value)
    }

    /** Cost per bucket as thin bars; hovering a column shows its numbers. */
    function CostBars({ buckets, range, currency }) {
      const [hover, setHover] = useState(null)
      const top = niceMax(Math.max(...buckets.map(bucket => bucket.cost)))
      const every = range === 'day' ? 5 : range === 'week' ? 2 : 1
      const active = hover === null ? null : buckets[hover]
      return h('div', { className: 'rb-chart-wrap' },
        h('div', { className: 'rb-chart' },
          [1, 0.5, 0].map(share => h('div', { key: share, className: 'rb-chart-grid', style: { bottom: `${share * 100}%` } },
            h('span', { className: 'rb-chart-y' }, money(top * share, currency)))),
          h('div', { className: 'rb-chart-bars', onMouseLeave: () => setHover(null) },
            buckets.map((bucket, index) => h('div', {
              key: bucket.start.getTime(),
              className: `rb-chart-col${hover === index ? ' on' : ''}`,
              onMouseEnter: () => setHover(index),
              tabIndex: 0,
              onFocus: () => setHover(index),
              onBlur: () => setHover(null),
              'aria-label': `${bucketLabel(bucket.start, range, true)} ${money(bucket.cost, currency)}`,
            }, bucket.cost > 0 ? h('div', { className: 'rb-chart-bar', style: { height: `${Math.max(1.5, bucket.cost / top * 100)}%` } }) : null))),
          active ? h('div', {
            className: 'rb-tip',
            style: {
              left: `${(hover + 0.5) / buckets.length * 100}%`,
              transform: `translateX(${hover < buckets.length / 4 ? '-12%' : hover > buckets.length * 3 / 4 ? '-88%' : '-50%'})`,
            },
          },
            h('div', { className: 'rb-tip-head' }, bucketLabel(active.start, range, true)),
            h('div', null, h('b', null, money(active.cost, currency)), ` · ${active.passes} ${isZh ? '轮' : 'passes'} · ${tokenText(active.tokens)} token`))
            : null),
        h('div', { className: 'rb-chart-x' },
          buckets.map((bucket, index) => h('span', { key: bucket.start.getTime() },
            (buckets.length - 1 - index) % every === 0 ? bucketLabel(bucket.start, range) : ''))))
    }

    /** Tokens and cost of the passes, read back from their session logs. */
    function UsageView({ boards, current, onClose }) {
      const [data, setData] = useState(null)
      const [failed, setFailed] = useState(false)
      const [loading, setLoading] = useState(false)
      const [filter, setFilter] = useState('all')
      const [range, setRange] = useState('day')
      const [shown, setShown] = useState(30)
      const load = useCallback(async () => {
        setLoading(true)
        try {
          setData(await request('/usage'))
          setFailed(false)
        } catch {
          setFailed(true)
        } finally {
          setLoading(false)
        }
      }, [])
      useEffect(() => { load() }, [load])

      const head = h('div', { className: 'rb-usage-head' },
        h('h2', { className: 'rb-dtitle' }, isZh ? '用量与费用' : 'Usage and cost'),
        h('span', { className: 'grow' }),
        boards && boards.length > 1 ? h('span', { className: 'rb-sched-pick rb-usage-filter' },
          h('select', { className: 'rb-sched-mode', value: filter, onChange: event => setFilter(event.target.value), 'aria-label': isZh ? '标的' : 'Board' },
            h('option', { value: 'all' }, isZh ? '全部标的' : 'All boards'),
            boards.map(board => h('option', { key: board.id, value: board.id }, board.title))),
          h(Chevron)) : null,
        h('button', { className: 'rb-btn', type: 'button', onClick: load, disabled: loading }, loading ? t('loading') : t('refresh')),
        h('button', { className: 'rb-btn', type: 'button', onClick: onClose }, isZh ? '回到议题' : 'Back to topics'))

      if (!data) {
        return h('div', { className: 'rb-usage' }, h('div', { className: 'rb-usage-in' }, head,
          h('p', { className: 'rb-form-lead' }, failed ? (isZh ? '用量读取失败。' : 'Could not load usage.') : t('loading'))))
      }

      const currency = data.currency
      const titleOf = id => data.boards.find(board => board.id === id)?.title ?? id
      const passes = data.passes.filter(pass => filter === 'all' || pass.board_id === filter)
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
      const month = passes.filter(pass => Date.parse(pass.started_at) >= monthStart)
      const sum = (list, pick) => list.reduce((total, pass) => total + (pick(pass) ?? 0), 0)
      const monthCost = sum(month, pass => pass.cost)
      const monthTools = sum(month, pass => pass.tool_cost)
      const monthInput = sum(month, pass => pass.input + pass.cache_hit)
      const monthTokens = monthInput + sum(month, pass => pass.output)
      const priced = month.filter(pass => pass.cost !== null)
      const hitShare = monthInput > 0 ? sum(month, pass => pass.cache_hit) / monthInput : null
      const buckets = bucketsOf(passes, range)
      const multi = data.boards.length > 1

      const tile = (label, value, note) => h('div', { className: 'rb-tile' },
        h('div', { className: 'rb-tile-k' }, label),
        h('div', { className: 'rb-tile-v rb-num' }, value),
        note ? h('div', { className: 'rb-tile-n' }, note) : null)

      const scheduleOf = id => boards?.find(board => board.id === id)?.schedule
      const boardRows = data.boards.map(board => {
        const all = data.passes.filter(pass => pass.board_id === board.id)
        const inMonth = all.filter(pass => Date.parse(pass.started_at) >= monthStart)
        return {
          board, all, inMonth,
          monthCost: sum(inMonth, pass => pass.cost),
          monthTokens: sum(inMonth, pass => pass.input + pass.cache_hit + pass.output),
          totalCost: sum(all, pass => pass.cost),
        }
      })
      const allMonth = boardRows.reduce((total, row) => total + row.monthCost, 0)

      return h('div', { className: 'rb-usage' },
        h('div', { className: 'rb-usage-in' },
          head,
          h('div', { className: 'rb-tiles' },
            tile(isZh ? '本月费用' : 'Cost this month', money(monthCost, currency),
              priced.length < month.length
                ? (isZh ? `${month.length - priced.length} 次的模型没有价格，未计入` : `${month.length - priced.length} unpriced`)
                : monthTools > 0 ? (isZh ? `其中搜索费 ${money(monthTools, currency)}` : `search fees ${money(monthTools, currency)}`) : null),
            tile(isZh ? '本月 token' : 'Tokens this month', tokenText(monthTokens),
              hitShare === null ? null : (isZh ? `输入里 ${Math.round(hitShare * 100)}% 命中缓存` : `${Math.round(hitShare * 100)}% of input from cache`)),
            tile(isZh ? '每次平均' : 'Per request', money(priced.length ? monthCost / priced.length : null, currency),
              priced.length ? `${tokenText(Math.round(monthTokens / month.length))} token` : null),
            tile(isZh ? '本月研究' : 'Research this month', `${month.length}${isZh ? ' 次' : ''}`,
              month.length ? (isZh
                ? `搜索 ${sum(month, pass => pass.searches)} 次 · 读网页 ${sum(month, pass => pass.fetches)} 次`
                : `${sum(month, pass => pass.searches)} searches · ${sum(month, pass => pass.fetches)} pages`) : null)),

          h('section', { className: 'rb-sec' },
            h('h3', null, RANGES[range].title,
              h('span', { className: 'rb-seg', role: 'group' },
                Object.entries(RANGES).map(([key, value]) => h('button', {
                  key, type: 'button', className: range === key ? 'on' : '', 'aria-pressed': range === key, onClick: () => setRange(key),
                }, value.label)))),
            passes.length === 0
              ? h('p', { className: 'rb-rail-empty' }, isZh ? '还没有研究记录。定时巡检、「巡检一次」「立即研究」和「让 AI 处理」跑完后会出现在这里。' : 'No research recorded yet.')
              : h(CostBars, { buckets, range, currency })),

          multi ? h('section', { className: 'rb-sec' },
            h('h3', null, isZh ? '按标的' : 'By board'),
            h('div', { className: 'rb-table-wrap' },
              h('table', { className: 'rb-table' },
                h('thead', null, h('tr', null,
                  h('th', null, isZh ? '标的' : 'Board'),
                  h('th', null, isZh ? '频率' : 'Cadence'),
                  h('th', { className: 'n' }, isZh ? '本月次数' : 'Requests'),
                  h('th', { className: 'n' }, isZh ? '本月 token' : 'Tokens'),
                  h('th', { className: 'n' }, isZh ? '本月费用' : 'Cost'),
                  h('th', { className: 'n' }, isZh ? '占比' : 'Share'),
                  h('th', { className: 'n' }, isZh ? '累计费用' : 'Total'))),
                h('tbody', null, boardRows.map(row => h('tr', { key: row.board.id, className: row.board.id === current ? 'on' : '' },
                  h('td', null, row.board.title),
                  h('td', { className: scheduleOf(row.board.id)?.cadence === 'paused' ? 'warn' : 'muted' }, cadenceText(scheduleOf(row.board.id))),
                  h('td', { className: 'n' }, String(row.inMonth.length)),
                  h('td', { className: 'n' }, tokenText(row.monthTokens)),
                  h('td', { className: 'n' }, money(row.monthCost, currency)),
                  h('td', { className: 'n muted' }, allMonth > 0 ? `${Math.round(row.monthCost / allMonth * 100)}%` : '—'),
                  h('td', { className: 'n' }, money(row.totalCost, currency)))))))) : null,

          passes.length > 0 ? h('section', { className: 'rb-sec' },
            h('h3', null, isZh ? '每次明细' : 'Each request', h('span', null, `${passes.length}`)),
            h('div', { className: 'rb-table-wrap' },
              h('table', { className: 'rb-table' },
                h('thead', null, h('tr', null,
                  h('th', null, isZh ? '开始' : 'Started'),
                  multi && filter === 'all' ? h('th', null, isZh ? '标的' : 'Board') : null,
                  h('th', null, isZh ? '议题' : 'Topic'),
                  h('th', null, isZh ? '方式' : 'Mode'),
                  h('th', { className: 'n' }, isZh ? '用时' : 'Time'),
                  h('th', { className: 'n', title: isZh ? '没命中缓存的输入，按全价计费' : 'Input not served from cache' }, isZh ? '输入' : 'Input'),
                  h('th', { className: 'n' }, isZh ? '缓存命中' : 'Cached'),
                  h('th', { className: 'n' }, isZh ? '输出' : 'Output'),
                  h('th', { className: 'n' }, isZh ? '搜索' : 'Search'),
                  h('th', { className: 'n' }, isZh ? '读网页' : 'Pages'),
                  h('th', { className: 'n' }, isZh ? '费用' : 'Cost'),
                  h('th', null, isZh ? '结论' : 'Result'))),
                h('tbody', null, passes.slice(0, shown).map(pass => h('tr', { key: pass.id },
                  h('td', { className: 'rb-num nowrap' }, stampOf(pass.started_at)),
                  multi && filter === 'all' ? h('td', { className: 'nowrap' }, titleOf(pass.board_id)) : null,
                  h('td', { className: 'nowrap', title: pass.topic_title ?? undefined },
                    pass.topic_title ?? h('span', { className: 'muted' }, pass.mode === 'session' ? (isZh ? '整轮' : 'whole pass') : '—')),
                  h('td', { className: 'nowrap muted', title: pass.mode === 'session' ? (isZh ? '旧版：在 dsh 对话里跑的整轮巡检' : 'older pass run in a dsh chat') : undefined },
                    MODE_NAMES[pass.mode] ?? pass.mode),
                  h('td', { className: 'n' }, pass.final ? durationText(Date.parse(pass.ended_at) - Date.parse(pass.started_at)) : h('span', { className: 'rb-live' }, isZh ? '进行中' : 'running')),
                  h('td', { className: 'n' }, tokenText(pass.input)),
                  h('td', { className: 'n' }, tokenText(pass.cache_hit)),
                  h('td', { className: 'n' }, tokenText(pass.output)),
                  h('td', { className: 'n' }, String(pass.searches)),
                  h('td', { className: 'n' }, String(pass.fetches)),
                  h('td', {
                    className: 'n',
                    title: pass.tool_cost > 0 && pass.token_cost !== null
                      ? (isZh ? `token ${money(pass.token_cost, currency)} + 搜索 ${money(pass.tool_cost, currency)}` : `tokens ${money(pass.token_cost, currency)} + search ${money(pass.tool_cost, currency)}`)
                      : pass.models.join(', '),
                  }, money(pass.cost, currency)),
                  pass.error
                    ? h('td', { className: 'rb-usage-what err', title: pass.error }, `${isZh ? '没有完成：' : 'failed: '}${researchErrorText(pass.error)}`)
                    : h('td', { className: 'rb-usage-what', title: pass.summary ?? pass.run?.summary ?? undefined },
                      pass.summary
                        ?? (pass.run
                          ? `${isZh ? `查了 ${pass.run.checked.length} 个议题` : `${pass.run.checked.length} topics`}${pass.run.summary ? ` · ${pass.run.summary}` : ''}`
                          : h('span', { className: 'muted' }, isZh ? '没有巡检记录' : 'no run recorded')))))))),
            passes.length > shown
              ? h('button', { className: 'rb-loadmore', type: 'button', onClick: () => setShown(value => value + 30) },
                isZh ? `再显示 ${Math.min(30, passes.length - shown)} 次` : `Show ${Math.min(30, passes.length - shown)} more`)
              : null) : null,

          h('p', { className: 'rb-usage-note' },
            isZh ? '按 ' : 'Priced from the ',
            h('a', { href: data.prices.source, target: '_blank', rel: 'noreferrer' }, isZh ? 'DeepSeek 官方价目' : 'DeepSeek price list'),
            isZh
              ? `（${data.prices.checked_at} 核对）计价：token 在北京时间工作日 9–12 点、14–18 点按高峰价，其余时间按低峰价，节假日按工作日算；每次搜索查询、每次读网页各按 ${money(data.prices.tools.search * 1000, currency)}/千次计入。每个议题的一次研究是一行，数字直接来自 DeepSeek 返回的计费用量。方式为「对话」的行是旧版在 dsh 对话里跑的整轮巡检，当时拿不到搜索次数，没有计搜索费。在普通对话里让 AI 巡检的用量不在这里。`
              : ` (checked ${data.prices.checked_at}): tokens at peak price on weekdays 9–12 and 14–18 Beijing time, off-peak otherwise, holidays as weekdays; each search query and each page read at ${money(data.prices.tools.search * 1000, currency)} per 1,000. One row is one research request on one topic, with the billed usage DeepSeek returned. Rows in chat mode are older passes run in a dsh chat; their search fees were not known.`)))
    }

    function BoardSkeleton() {
      const bar = (width, height, extra) => h('div', {
        className: 'rb-skel',
        key: `${String(width)}-${String(height)}-${JSON.stringify(extra ?? {})}`,
        style: { width, height, ...extra },
      })
      const listRow = index => h('div', {
        key: index, style: { display: 'flex', flexDirection: 'column', gap: 7, padding: '10px 16px' },
      },
        bar(`${58 + (index % 4) * 10}%`, 12),
        bar('34%', 9))
      return h('div', { className: 'rb-root' },
        h('header', { className: 'rb-head' },
          h('div', { className: 'rb-brand', style: { flex: '1 1 auto' } },
            bar(96, 13),
            bar(220, 10, { marginTop: 6 })),
          h('div', { className: 'rb-actions' },
            bar(96, 27),
            bar(72, 27),
            bar(56, 27))),
        h('div', { className: 'rb-body' },
          h('aside', { className: 'rb-list' },
            h('div', { className: 'rb-list-head' }, bar(52, 9)),
            [0, 1, 2, 3, 4, 5, 6].map(listRow)),
          h('main', { className: 'rb-detail rb-doc' },
            bar('42%', 20),
            bar('34%', 10, { marginTop: 8 }),
            h('div', { style: { display: 'grid', gap: 22, gridTemplateColumns: '1fr 1fr', marginTop: 22 } },
              h('div', null, bar(30, 9), bar('92%', 11, { marginTop: 8 }), bar('70%', 11, { marginTop: 5 })),
              h('div', null, bar(30, 9), bar('88%', 11, { marginTop: 8 }), bar('64%', 11, { marginTop: 5 }))),
            bar('100%', 56, { marginTop: 30 }),
            bar('100%', 44, { marginTop: 26 }),
            bar('100%', 44, { marginTop: 14 }))),
        h('style', null, STYLE))
    }

    function BoardPanel() {
      const [board, setBoard] = useState(() => readStoredBoard())
      const [boards, setBoards] = useState(null)
      const [view, setView] = useState('topics')
      // A full-width sheet over the topics: 'new' board, 'import' or 'export'.
      const [sheet, setSheet] = useState(null)
      const [hasKey, setHasKey] = useState(true)
      // A notice to show once the board picked after an import has loaded.
      const nextNotice = useRef(null)
      const [state, setState] = useState(null)
      const [schedule, setSchedule] = useState(null)
      const [selected, setSelected] = useState(null)
      const [timeline, setTimeline] = useState(null)
      const [timelineLoading, setTimelineLoading] = useState(false)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const [running, setRunning] = useState(false)
      const [notice, setNotice] = useState(null)
      const [query, setQuery] = useState('')
      const [creating, setCreating] = useState(false)
      const [timelineTick, setTimelineTick] = useState(0)
      // Topics with Agent activity the reader has not opened yet in this visit.
      // The Host counter resets when the panel opens, so the list keeps its own.
      const [fresh, setFresh] = useState(() => new Set())
      const selectedRef = useRef(null)
      const timelineFor = useRef(null)
      const boardRef = useRef(board)
      selectedRef.current = selected
      boardRef.current = board
      // Every board-scoped call names the board this panel shows.
      const here = useCallback(path => onBoard(path, boardRef.current), [])

      const loadBoards = useCallback(async () => {
        const data = await request('/boards')
        setBoards(data.boards)
        setHasKey(data.has_key !== false)
        return data.boards
      }, [])

      const load = useCallback(async (options = {}) => {
        setBusy(true)
        try {
          // The board list decides which board to show; quick polls reuse it.
          if (!options.quick || !boardRef.current) {
            const list = await loadBoards()
            // A fresh install: the welcome screen, nothing to load.
            if (list.length === 0) {
              boardRef.current = null
              setState(null)
              setError(null)
              return
            }
            if (!list.some(item => item.id === boardRef.current) && list.length > 0) {
              boardRef.current = list[0].id
              setBoard(list[0].id)
            }
          }
          const asked = boardRef.current
          // Quick polls skip the schedule: it only changes when the reader edits it.
          const [next, sched] = await Promise.all([
            request(here('/state')),
            options.quick ? Promise.resolve(null) : request(here('/schedule')).catch(() => null),
          ])
          // The reader switched boards while this was in flight.
          if (asked !== boardRef.current) return
          setState(next)
          if (sched && !sched.error) setSchedule(sched)
          setError(null)
          setTimelineTick(value => value + 1)
          setFresh(previous => {
            const updated = new Set(previous)
            for (const topic of next.topics) if (topic.agent_new > 0 && topic.id !== selectedRef.current) updated.add(topic.id)
            return updated
          })
          // Opening the panel consumes the badge: the numbers are a nudge, not a debt.
          // Background polls leave it alone, so activity that lands while the panel
          // is open still gets flagged on the next poll.
          if (options.markSeen) {
            request(here('/seen'), { method: 'POST' }).then(() => window.dispatchEvent(new CustomEvent(SEEN_EVENT))).catch(() => {})
          }
          const current = selectedRef.current
          if (!current || !next.topics.some(topic => topic.id === current)) {
            const flipped = next.topics.find(topic => topic.status === 'active' && topic.stance !== null)
            setSelected(flipped?.id ?? next.topics[0]?.id ?? null)
          }
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        } finally {
          setBusy(false)
        }
      }, [here, loadBoards])

      // The Host researches the due topics in the background; the panel says so
      // and polls for the result.
      const runNow = useCallback(async () => {
        setRunning(true)
        setNotice(null)
        try {
          const { ok, data } = await postJson(here('/run-now'))
          if (!ok) {
            setNotice(data?.code === 'nothing_due'
              ? (isZh ? '没有到期的议题，也没有等 AI 处理的评论。要查某个议题，打开它点「立即研究」。' : 'nothing is due; open a topic and use Research now')
              : data?.code ? researchErrorText(data.code) : (isZh ? '启动失败' : 'could not start'))
            setRunning(false)
            return
          }
          setNotice(data?.queued
            ? (isZh ? '上一轮还没结束，结束后接着跑' : 'queued behind the running pass')
            : (isZh ? '已开始研究到期的议题，跑完这里会自动更新' : 'researching the due topics; this panel updates when done'))
          setTimeout(() => { setRunning(false); load({ quick: true }) }, 3000)
        } catch {
          setNotice(isZh ? '启动失败' : 'could not start')
          setRunning(false)
        }
      }, [load, here])

      const saveSchedule = useCallback(async patch => {
        const { ok, data } = await postJson(here('/schedule'), patch)
        if (ok && data && !data.error) {
          setSchedule(data)
          setNotice(null)
          loadBoards().catch(() => {})
        } else {
          setNotice(isZh ? '保存失败' : 'save failed')
        }
      }, [here, loadBoards])

      // Opening the panel and switching boards both start from a clean view.
      useEffect(() => {
        setSelected(null)
        setTimeline(null)
        timelineFor.current = null
        setFresh(new Set())
        setCreating(false)
        setQuery('')
        setNotice(nextNotice.current)
        nextNotice.current = null
        load({ markSeen: true })
      }, [board, load])

      const pickBoard = useCallback(id => {
        if (id === boardRef.current) return
        storeBoard(id)
        setSheet(null)
        setView('topics')
        setState(null)
        setSchedule(null)
        setBoard(id)
      }, [])

      const addBoard = useCallback(async payload => {
        const result = await postJson('/board/add', payload)
        if (result.ok && result.data?.board) {
          await loadBoards().catch(() => {})
          pickBoard(result.data.board)
          setSheet(null)
        }
        return result
      }, [loadBoards, pickBoard])

      const imported = useCallback(async data => {
        const next = data.schedule?.next
        nextNotice.current = isZh
          ? `已导入 ${data.topics.length} 个议题。${data.schedule?.cadence === 'paused' ? '巡检已暂停，' : next ? `${dueText(next)} ${clockOf(next)} 巡检时` : ''}会全部研究一遍，约 ${money(data.estimate)}；想现在开始就点「${t('runNow')}」`
          : `Imported ${data.topics.length} topics; the next pass researches all of them for about ${money(data.estimate)}. Use ${t('runNow')} to start now.`
        await loadBoards().catch(() => {})
        if (data.board === boardRef.current) { setNotice(nextNotice.current); nextNotice.current = null; load() }
        pickBoard(data.board)
        setSheet(null)
      }, [loadBoards, pickBoard, load])

      // Refetch on every state load too, so a pass that lands shows up in the
      // open topic; only a topic switch shows the loading line.
      useEffect(() => {
        if (!selected) { setTimeline(null); return }
        let alive = true
        if (timelineFor.current !== selected) setTimelineLoading(true)
        request(here(`/timeline?topic=${encodeURIComponent(selected)}`))
          .then(data => { if (alive) { setTimeline(data); timelineFor.current = selected } })
          .catch(() => { if (alive && timelineFor.current !== selected) setTimeline(null) })
          .finally(() => { if (alive) setTimelineLoading(false) })
        return () => { alive = false }
      }, [selected, timelineTick, here])

      const select = useCallback(id => {
        setCreating(false)
        setSelected(id)
        setFresh(previous => {
          if (!previous.has(id)) return previous
          const updated = new Set(previous)
          updated.delete(id)
          return updated
        })
      }, [])

      /** Every reader write goes through here: post, then reload what it changed. */
      const mutate = useCallback(async (path, body) => {
        let result
        try {
          result = await postJson(here(path), body)
        } catch {
          result = { ok: false, status: 0, data: {} }
        }
        if (result.ok) await load({ quick: true })
        return result
      }, [load, here])

      const actions = useMemo(() => ({
        edit: (topicId, payload) => mutate('/topic/edit', { topic: topicId, ...payload }),
        // A comment that asks the AI also researches its topic now; say what happened to it.
        comment: async (topicId, payload) => {
          const result = await mutate('/topic/note', { topic: topicId, ...payload })
          const run = result.data?.run
          if (result.ok && run) {
            setNotice(!run.ok
              ? `${researchErrorText(run.code)}${isZh ? '。评论已保存，下次定时巡检会处理' : '; the comment is saved for the next pass'}`
              : run.queued
                ? (isZh ? '上一轮还没结束，结束后接着处理这条评论' : 'queued behind the running pass')
                : (isZh ? 'AI 正在研究这个议题，回复会出现在评论里' : 'researching this topic; the reply lands in the comments'))
          }
          return result
        },
        research: async topicId => {
          const result = await mutate('/topic/research', { topic: topicId })
          const run = result.data?.run
          setNotice(!result.ok || !run?.ok
            ? researchErrorText(run?.code ?? result.data?.error) || (isZh ? '启动失败' : 'could not start')
            : run.queued
              ? (isZh ? '上一轮还没结束，结束后接着研究这个议题' : 'queued behind the running pass')
              : (isZh ? '正在研究这个议题，结果会出现在研究记录里' : 'researching; the result lands in the research log'))
          return result
        },
        dismissFalsified: async topicId => {
          const result = await mutate('/topic/falsified/dismiss', { topic: topicId })
          if (result.ok) window.dispatchEvent(new CustomEvent(SEEN_EVENT))
          return result
        },
        resolve: (id, resolved) => mutate('/thread/resolve', { id, resolved }),
        restore: (topicId, logId, note) => mutate('/topic/restore', { topic: topicId, log_id: logId, note }),
        decide: (id, accept, note) => mutate('/proposal/decide', { id, accept, note }),
        revert: id => mutate('/log/revert', { id }),
        add: async payload => {
          const result = await mutate('/topic/add', payload)
          if (result.ok && result.data?.topic_id) select(result.data.topic_id)
          return result
        },
      }), [mutate, select])

      // A pass started elsewhere should show up without a manual refresh. While a
      // pass runs, or a comment is waiting for the AI, the panel checks often so
      // replies and edits appear within seconds of landing.
      const fast = Boolean(state?.open_run) || Boolean(state?.research?.running) || (state?.stats?.asked_ai ?? 0) > 0
      useEffect(() => {
        const timer = setInterval(() => { load({ quick: true }) }, fast ? 8000 : 45000)
        return () => clearInterval(timer)
      }, [load, fast])

      if (error) {
        return h('div', { className: 'rb-root' },
          h('div', { className: 'rb-error' },
            h('span', null, `${t('loadFailed')}: ${error}`),
            h('button', { className: 'rb-btn', onClick: load, style: { marginLeft: 'auto' } }, t('retry')),
          ))
      }
      if (boards && boards.length === 0) {
        return h('div', { className: 'rb-root' },
          h('header', { className: 'rb-head' },
            h('div', { className: 'rb-brand' }, h('div', { className: 'rb-title-row' }, h('span', { className: 'rb-title' }, t('title')))),
            h('div', { className: 'rb-actions' },
              h('button', { className: 'rb-btn', onClick: () => load(), disabled: busy }, busy ? t('loading') : t('refresh')))),
          h('div', { className: 'rb-body rb-body-one' },
            h('main', { className: 'rb-detail' },
              h('div', { className: 'rb-doc' },
                h('div', { className: 'rb-doc-in' },
                  sheet === 'import' ? h(ImportForm, { onImported: imported, onCancel: () => setSheet(null) })
                    : sheet === 'new' ? h(BoardForm, { onSubmit: addBoard, onCancel: () => setSheet(null) })
                      : h(Welcome, { hasKey, onImport: () => setSheet('import'), onNew: () => setSheet('new') }))))),
          h('style', null, STYLE))
      }
      if (!state) {
        return h(BoardSkeleton)
      }

      const topics = state.topics ?? []
      const current = topics.find(topic => topic.id === selected) ?? null
      const needle = query.trim().toLowerCase()
      const filteredTopics = needle === ''
        ? topics
        : topics.filter(topic => `${topic.title} ${topic.metric ?? ''} ${topic.thesis}`.toLowerCase().includes(needle))
      const openRun = state.open_run
      const lastRun = state.last_run
      // A scheduled check that found nothing due leaves no run; it is still the latest pass.
      const idleLast = Boolean(state.research?.idle_at) &&
        (!lastRun || Date.parse(state.research.idle_at) > Date.parse(lastRun.finished_at ?? lastRun.started_at))

      const currency = state.cost?.currency ?? 'CNY'
      const showUsage = view === 'usage'

      return h('div', { className: 'rb-root' },
        h('header', { className: 'rb-head' },
          h('div', { className: 'rb-brand' },
            h('div', { className: 'rb-title-row' },
              h('span', { className: 'rb-title' }, t('title')),
              h('span', { className: 'rb-crumb' }, '/'),
              h(BoardSwitcher, {
                boards, current: board ?? state.board.id, currency,
                onPick: pickBoard,
                onNew: () => { setView('topics'); setSheet('new') },
                onImport: () => { setView('topics'); setSheet('import') },
                onExport: () => { setView('topics'); setSheet('export') },
                onSources: () => { setView('topics'); setSheet('sources') },
                onOpen: () => { loadBoards().catch(() => {}) },
              })),
            state.board.note ? h('div', { className: 'rb-sub', title: state.board.note }, state.board.note) : null,
            h('button', { type: 'button', className: 'rb-srcline', onClick: () => { setView('topics'); setSheet('sources') } },
              sourceLineText(boards?.find(item => item.id === (board ?? state.board.id))?.sources)),
          ),
          h('div', { className: 'rb-actions' },
            // Cadence and "run now" both decide when a pass happens, so they sit together.
            schedule ? h(CadenceControl, { schedule, onSave: saveSchedule }) : null,
            h('button', {
              className: 'rb-btn primary', onClick: runNow, disabled: running,
            }, running ? (isZh ? '已排队' : 'queued') : t('runNow')),
            h('button', {
              className: `rb-btn${showUsage ? ' on' : ''}`, 'aria-pressed': showUsage,
              onClick: () => { setSheet(null); setView(showUsage ? 'topics' : 'usage') },
            }, isZh ? '用量' : 'Usage'),
            h('button', { className: 'rb-btn', onClick: () => load({ markSeen: true }), disabled: busy }, busy ? t('loading') : t('refresh')),
          ),
        ),

        showUsage ? h(UsageView, { boards, current: board, onClose: () => setView('topics') }) : null,
        hasKey ? null : h('div', { className: 'rb-keybar' }, `${isZh ? '没有 DeepSeek API key，巡检不会运行。' : 'No DeepSeek API key; passes will not run. '}${KEY_HELP}`),
        sheet && !showUsage ? h('div', { className: 'rb-body rb-body-one' },
          h('main', { className: 'rb-detail' },
            h('div', { className: 'rb-doc' },
              h('div', { className: 'rb-doc-in' },
                sheet === 'import' ? h(ImportForm, { onImported: imported, onCancel: () => setSheet(null), currency })
                  : sheet === 'export' ? h(ExportSheet, { board: state.board.id, title: state.board.title, onClose: () => setSheet(null) })
                    : sheet === 'sources' ? h(SourcesSheet, { board: state.board.id, title: state.board.title, onClose: () => setSheet(null), onSaved: () => loadBoards().catch(() => {}) })
                      : h(BoardForm, { onSubmit: addBoard, onCancel: () => setSheet(null) }))))) : null,
        showUsage || sheet ? null : h('div', { className: 'rb-body' },
          h('aside', { className: 'rb-list' },
            h('div', { className: 'rb-list-head' },
              h('span', null, t('topics')),
              h('span', { className: 'rb-list-tools' },
                h('button', { className: 'rb-link', type: 'button', onClick: () => setCreating(true) }, t('newTopic')),
                h('span', { className: 'rb-num' }, `${filteredTopics.length}/${topics.length}`)),
            ),
            // A long agenda needs a way in; below a dozen rows the box is just noise.
            topics.length > 10
              ? h('div', { className: 'rb-filter' },
                h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none' },
                  h('circle', { cx: 7, cy: 7, r: 4.6, stroke: 'currentColor', strokeWidth: 1.4 }),
                  h('path', { d: 'M10.6 10.6 14 14', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
                ),
                h('input', {
                  value: query,
                  placeholder: isZh ? '过滤议题' : 'filter topics',
                  onChange: event => setQuery(event.target.value),
                  onKeyDown: event => { if (event.key === 'Escape') setQuery('') },
                }),
              )
              : null,
            topics.length === 0
              ? h('div', { className: 'rb-empty', style: { height: 'auto', padding: '28px 14px' } },
                h('h3', null, t('empty')),
                h('p', null, t('emptyHint')),
                h('button', { className: 'rb-btn primary', type: 'button', onClick: () => setCreating(true) }, t('newTopic')))
              : filteredTopics.length === 0
                ? h('div', { style: { padding: '18px 14px', fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
                  isZh ? '没有匹配的议题' : 'no matching topic')
                : filteredTopics.map(topic => h(TopicRow, {
                  key: topic.id, topic, selected: !creating && topic.id === selected,
                  fresh: fresh.has(topic.id),
                  onSelect: select,
                })),
          ),
          h('main', { className: 'rb-detail' },
            creating
              ? h('div', { className: 'rb-doc' },
                h('div', { className: 'rb-doc-in' },
                  h(TopicForm, { key: 'new', onSubmit: actions.add, onCancel: () => setCreating(false) })))
              : h(Detail, { topic: current, timeline, loading: timelineLoading, running: Boolean(openRun) || Boolean(state.research?.running), soon: (state.stats?.asked_ai ?? 0) > 0, actions }),
          ),
        ),

        h('footer', { className: 'rb-foot' },
          h('span', null, `${t('lastRun')}: `,
            idleLast
              ? h('span', null, `${when(state.research.idle_at, 'long')} · ${isZh ? '没有到期的议题' : 'nothing was due'}`)
              : lastRun
                ? h('span', null, `${when(lastRun.finished_at ?? lastRun.started_at, 'long')} · ${RUN_MODE_NAMES[lastRun.mode] ?? lastRun.mode} · ${RUN_STATUS_NAMES[lastRun.status] ?? lastRun.status}`)
                : h('span', null, t('never'))),
          h('span', { className: 'sep' }, '·'),
          h('span', null, `${isZh ? '下次巡检' : 'next pass'}: `,
            schedule?.cadence === 'paused'
              ? h('span', { className: 'warn' }, isZh ? '已暂停' : 'paused')
              : schedule?.next ? `${dueText(schedule.next)} ${clockOf(schedule.next)}` : h('span', null, isZh ? '未启用' : 'off')),
          h('span', { className: 'sep' }, '·'),
          h('span', null, `${isZh ? '到期' : 'due'} `, h('span', { className: 'rb-num' }, String(state.stats.due))),
          h('span', { className: 'sep' }, '·'),
          h('span', null, `${isZh ? '本周证据' : 'new evidence'} `, h('span', { className: 'rb-num' }, `+${state.stats.evidence_7d}`)),
          state.cost ? h('span', null,
            h('span', { className: 'sep' }, '·'),
            ' ',
            h('button', {
              type: 'button', className: 'rb-status',
              onClick: () => { setSheet(null); setView('usage') },
              title: (boards?.length ?? 1) > 1
                ? (isZh ? `这个标的本月 ${money(state.cost.board_month, currency)}，全部标的本月 ${money(state.cost.month, currency)}` : `this board ${money(state.cost.board_month, currency)}, all boards ${money(state.cost.month, currency)}`)
                : undefined,
            }, `${isZh ? '本月费用' : 'this month'} ${money(state.cost.month, currency)}`)) : null,
          state.stats.pending_proposals > 0 ? h('span', null,
            h('span', { className: 'sep' }, '·'),
            h('span', { className: 'warn' }, ` ${isZh ? '待你决定' : 'to decide'} `, h('span', { className: 'rb-num' }, String(state.stats.pending_proposals)))) : null,
          state.stats.waiting_agent > 0 ? h('span', null,
            h('span', { className: 'sep' }, '·'),
            ` ${isZh ? '等 AI 查看' : 'waiting for AI'} `, h('span', { className: 'rb-num' }, String(state.stats.waiting_agent))) : null,
          // A pass is open while the AI works; only one left open for hours was cut off.
          openRun ? h('span', null,
            h('span', { className: 'sep' }, '·'),
            Date.now() - Date.parse(openRun.started_at) > 2 * 3600000
              ? h('span', { className: 'err' }, ` ${t('openRun')}`)
              : h('span', { className: 'rb-live' }, ` ${isZh ? 'AI 正在研究' : 'AI researching'}`)) : null,
          state.research?.error && !openRun ? h('span', { className: 'rb-foot-fit', title: state.research.error },
            h('span', { className: 'sep' }, '·'),
            h('span', { className: 'err' }, ` ${isZh ? '上次研究出错：' : 'last research failed: '}${researchErrorText(state.research.error)}`),
            state.research.retry_at ? ` ${isZh ? `，${clockOf(state.research.retry_at)} 自动重试` : `; retrying at ${clockOf(state.research.retry_at)}`}` : null) : null,
          notice ? h('span', { className: 'rb-foot-fit', title: notice },
            h('span', { className: 'sep' }, '·'),
            ` ${notice}`) : null,
          h('span', { className: 'grow' }),
          lastRun?.summary ? h('span', { className: 'rb-foot-fit rb-foot-sum', title: lastRun.summary }, lastRun.summary) : null,
        ),

        h('style', null, STYLE),
      )
    }

    // ---------------------------------------------------------------- apply

    return {
      inject: ['slots'],
      apply(ctx) {
        // The panel owns the pass controls itself: a manual pass asks the Host's
        // Schedule service to deliver now, so the Agent works in its own Session
        // instead of dumping a prompt into whatever composer is open.
        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, BoardPanel)))

        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 70,
          label: () => t('panel'),
        }, BoardIcon)))
      },
    }
  },
})
