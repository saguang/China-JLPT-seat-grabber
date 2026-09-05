# 中国 JLPT 考位捡漏系统

> 专为中国大陆 [JLPT 报名](https://jlpt.neea.cn)（教育部考试中心 NEEA）打造的考场座位捡漏工具 —— 每分钟自动刷新，**指定考点出现"有名额"立即三重报警**（持续响铃 + 系统通知 + 语音朗读）。

![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-brightgreen) ![Edge OK](https://img.shields.io/badge/Edge-OK-blue) ![夸克 OK](https://img.shields.io/badge/夸克-OK-orange) ![License MIT](https://img.shields.io/badge/License-MIT-lightgrey)

---

## 一、它解决什么问题

JLPT 中国大陆考场每年 7 月、12 月开放报名，热门考点（北京外国语大学、大连外国语大学、上海外国语大学、考研考点等）**通常在放票后几分钟内被抢光**。官方页面不会主动推送，你只能反复手动刷新看是否有名额 —— 费时费力还经常错过。

**中国 JLPT 考位捡漏系统**让你：

- 🎯 锁定**指定考点**（比如"大连外国语大学"），避免误抢别的考场
- ⏱ 每 **1 分钟**自动刷新一次 NEEA 报名页
- 🔍 准确识别"有名额"行（**双向校验**：含"有名额"**且**不含"名额暂满"）
- 🔔 发现空位立即三路报警：
  - 持续 30 秒的**大音量提示音**（Web Audio）
  - **Chrome 系统通知**（即使扩展关闭也弹）
  - **TTS 语音朗读**："中国 JLPT 考位捡漏系统已为您检测到考位"
- 📊 实时显示命中次数、上次刷新时间
- 🛡 默认**只监控不自动抢**，可手动开启"自动点击抢报"

---

## 二、核心特性

| 特性 | 说明 |
|------|------|
| **NEEA 表格精准定位** | 针对 NEEA 报名页的 343-td 扁平 DOM 结构做了特殊处理，**不依赖 rowspan 表头**，避免错列误判 |
| **双向状态校验** | 同时要求"含 `有名额`"**且**"不含 `暂满`"，杜绝中国海洋大学这种"暂满"被误报 |
| **幂等脚本注入** | `window.__examSeatMonitor` 命名空间保护，多次刷新不会重复执行 |
| **智能回注** | 已在打开的页面也能立即用：`chrome.scripting.executeScript` 在 popup 里强制注入 |
| **持续报警可手动停** | 一旦命中，按钮变红色 + 脉动动画，一键 `STOP_BEEP` 全局静音 |
| **配置可持久化** | `chrome.storage.local` 保存，关闭浏览器再打开还在 |
| **MV3 Service Worker** | 完全符合 Chrome 最新 Manifest V3 规范 |
| **零追踪、零上报** | 所有数据只存在本地，不上传任何服务器 |

---

## 三、安装（30 秒搞定）

> 适用于 **Chrome / Edge / 夸克 / 360 极速 / 任何 Chromium 内核浏览器**

1. 下载本仓库 zip 或克隆：`git clone https://github.com/<your-name>/china-jlpt-seat-grabber.git`
2. 浏览器地址栏打开：
   - Chrome：`chrome://extensions`
   - Edge：`edge://extensions`
   - 夸克：`quark://extensions`
3. 打开右上角 **开发者模式（Developer mode）** 开关
4. 点击左上角 **加载已解压的扩展程序（Load unpacked）**
5. 选择 `china-jlpt-seat-grabber` 文件夹（**不是** `icons` 子文件夹）
6. 工具栏出现绿色 **🎯 图标** = 安装成功 ✅

---

## 四、使用流程

### 第 1 步：打开 NEEA 报名页

浏览器登录 [https://jlpt.neea.cn/index.do](https://jlpt.neea.cn/index.do) ，进到**考点列表**页面（能看到所有考点的"有名额 / 名额暂满"状态那页）。

### 第 2 步：配置

点击工具栏 🎯 图标，在弹出面板里填：

| 字段 | 推荐值 |
|------|--------|
| **目标页面 URL 模式** | `https://jlpt.neea.cn/*` |
| **刷新间隔（分钟）** | `1`（Chrome `chrome.alarms` 最小周期） |
| **匹配模式** | `JLPT 表格·按考点定位` |
| **目标考点名称** | 你要报的那个考点全称，如 `大连外国语大学` / `北京外国语大学` |
| **视为有考位的状态关键词** | `有名额`（默认） |
| **发现考位时持续响铃** | ✅ 勾选 |

### 第 3 步：先测试再启动

点 **「立即检测一次」**：
- ✅ 弹出"命中！大连外国语大学 = 有名额" → 配置正确
- ❌ 弹出"未检测到考位"+ 诊断日志 → 看日志里"已扫到 X 行包含目标考点"，确认关键词没填错
- ❌ 提示 "Receiving end does not exist" → 点一次后会自动注入，再次点就好

### 第 4 步：启动监控

点 **「启动监控」** → 状态变绿色"运行中" → 工具栏 🎯 出现红点。

可以**锁屏去做别的事** —— 命中时三种报警会同时触发。

---

## 五、报警行为说明

命中目标考点"有名额"时**同时**执行：

1. **Web Audio 持续报警音**
   - 频率 880 Hz 方波 + 660 Hz 正弦双层叠加
   - 音量 0.8（约 80% 系统音量），连续 30 秒不间断
   - 不会因弹窗消失而中断（音频由 content script 持有）
2. **Chrome 系统通知**
   - 标题：`🎯 JLPT 捡漏命中`
   - 内容：`<考点名> 已显示「有名额」！请立即进入报名`
   - `requireInteraction: true` 不会自动消失
3. **TTS 语音朗读**
   - 中文女声：`中国 JLPT 考位捡漏系统已为您检测到考位`
   - `rate: 1.1`，连续朗读 3 轮

**关闭方式**：popup 里点红色 **🔕 立即停止提示音** 按钮，或在 content script 里调用 `stopBeep()`。

---

## 六、配置进阶

### 想同时盯多个考点？

打开 `content.js`，把 `targetKeyword` 改成数组形式：

```js
const KEYWORDS = ['大连外国语大学', '北京外国语大学', '天津外国语大学'];
```

检测循环里对每个考点都做一次判定。

### 想改报警音量/时长？

`content.js` 里的 `startBeep(ms)`：

```js
function startBeep(ms = 30000) {     // ms = 报警时长（默认 30 秒）
  ...
  gain.gain.value = 0.8;              // 0~1，最大 1（可能爆音）
  ...
}
```

### 想自动点击抢报？

popup 勾选 **「自动点击抢报按钮」**，在「抢报按钮选择器」里填 NEEA 的"网上报名"按钮 selector（F12 复制即可）。注意：NEEA 报名按钮通常在"已选中考点"的下一页，content script 会尝试点击当前页所有匹配元素。

> ⚠️ 自动抢报前请确认：
> - NEEA 报名页面可能有**滑块验证码**（无法绕过）
> - 高频点击可能触发 NEEA 风控
> - 报名涉及个人信息和支付环节，**建议最后一步手动完成**

---

## 七、常见问题（FAQ）

### Q1：刷新最快只能 1 分钟？
是。Chrome `chrome.alarms` API 的**硬限制**最小周期 1 分钟，更短的请求会被系统忽略。

### Q2：能识别"名额暂满"吗？
能。`include` 双向校验保证：**只有同时包含「有名额」且不包含「暂满」**才会报警。中国海洋大学、新疆大学这种状态列写"名额暂满"的，永远不会误报。

### Q3：为什么 NEEA 表格是"扁平"的？
NEEA 的考点表格把所有 `<td>` 放在**一个 `<tr>` 里**（约 343 个），不是传统的"每行一个考点"。本扩展用 **flat td-sequence 定位**：`[index]考点名 → [index+1]状态`，不依赖 rowspan 表头对齐，彻底避开错列问题。

### Q4：能在已打开的页面上工作吗？
能。popup 里的"立即检测一次"按钮会通过 `chrome.scripting.executeScript` 强制注入 content.js，无需手动刷新页面或重启扩展。

### Q5：会收集我的信息吗？
**不会**。扩展代码完全本地运行，不向任何服务器上报你的配置、刷新历史、考点偏好。

### Q6：支持 Edge / 夸克 / 360 吗？
支持。Chromium 内核浏览器都能加载未打包扩展；夸克浏览器请在 `quark://extensions` 启用开发者模式后加载。

### Q7：报名高峰期 NEEA 会封 IP 吗？
目前 NEEA 主要是**滑块验证码**风控，未公开 IP 封禁策略。本扩展 1 分钟一次的刷新频率相对温和，但仍建议**不要连续盯超过 24 小时**，必要时切换网络。

---

## 八、文件结构

```
china-jlpt-seat-grabber/
├── manifest.json     # MV3 清单（name: 中国 JLPT 考位捡漏系统）
├── background.js     # Service Worker：定时刷新 + 系统通知 + TTS
├── content.js        # 页面内：NEEA 表格解析 + 报警 + 自动注入保护
├── popup.html        # 配置面板 UI
├── popup.css         # 面板样式（卡片式 + 红色脉动按钮）
├── popup.js          # 面板交互 + chrome.storage 持久化
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── README.md         # 本文件
```

---

## 九、技术细节（给好奇的你）

### NEEA 表格 DOM 结构示例

NEEA 的考点列表页面，HTML 简化后长这样：

```html
<table>
  <tr>  <!-- 一个 tr 装所有考点，约 343 个 td -->
    <td>考点 1</td>           <!-- 0 -->
    <td>有名额</td>           <!-- 1 -->
    <td>考点 2</td>           <!-- 2 -->
    <td>名额暂满</td>         <!-- 3 -->
    <td>考点 3</td>           <!-- 4 -->
    <td>有名额</td>           <!-- 5 -->
    ...
  </tr>
</table>
```

**定位算法**：

```js
const tds = document.querySelectorAll('td');
for (let i = 0; i < tds.length; i++) {
  if (tds[i].innerText.includes(targetKeyword)) {
    const statusCell = tds[i + 1];            // 下一个 td 就是状态
    const status = statusCell.innerText;
    if (status.includes('有名额') && !status.includes('暂满')) {
      // 命中！
      break;
    }
  }
}
```

### Service Worker 生命周期

MV3 下 service worker 会**被浏览器自动休眠**，所以本扩展把：
- **音频播放** → 放在 content script（页面里才能用 AudioContext）
- **系统通知 / TTS** → 放在 service worker（页面休眠也能弹）
- **存储 / 配置** → `chrome.storage.local`（service worker 重启后数据不丢）

### 幂等注入保护

```js
if (window.__examSeatMonitor) {
  console.log('[JLPT 捡漏] content script 已注入，跳过');
  return;
}
window.__examSeatMonitor = { started: true };
// ... 主逻辑
```

---

## 十、免责声明

本工具仅作为**浏览器辅助监控**用途，作者不为以下情况负责：

- 因使用本工具造成的账号封禁、报名资格取消
- 因 NEEA 网站改版导致定位失效（请提 issue 协助适配）
- 因自动化操作违反 NEEA 服务条款引发的法律后果

**请合理使用**，JLPT 报名最终仍需在官方页面手动完成确认。

---

## 十一、贡献

欢迎 PR！尤其是：
- 🎨 改进图标设计
- 🌐 增加繁体中文、英文 README
- 🔧 适配 NEEA 报名页改版
- 🐛 修复更多边缘情况

---

## 十二、License

MIT © 2026 - 你可以自由使用、修改、商用，但请保留原作者署名。

---

<p align="center">
  <strong>愿你抢到心仪的考点 🎯</strong>
</p>
