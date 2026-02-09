## 对话历史列表设计

将技术交互日志转化为对话列表形式，保留原逻辑链（思考→任务→执行→结果），以更轻量的方式呈现。

---

### 1. 消息类型

| 消息类型     | 对齐 | 内容规则 |
|-------------|------|----------|
| 🧠 思考消息 | 左   | 前缀 `"我在想："` + 思考内容，关键名词蓝色高亮 |
| 📌 任务消息 | 左   | 前缀 `"接下来要做："` + 任务描述，步骤编号 `【1/3】` |
| ▶️ 执行消息 | 左   | 前缀 `"正在执行："` + 命令/步骤，执行中显示加载动画 |
| 💻 终端结果 | 右   | 代码块等宽字体，成功绿色 / 失败红色 |

### 2. 交互规则

- **时间戳**：气泡右下角 `12px` 浅灰，hover 变橙色
- **复制**：终端结果气泡 hover 显示复制按钮
- **展开**：思考/任务消息可展开详情
- **加载态**：执行中显示加载动画，完成后变为 ✅

### 3. 布局结构

```
ChatPanel (flex flex-col min-h-0)
├── ChatMessageList (flex-1 overflow-y-auto)
│   ├── 思考气泡 (左对齐)
│   ├── 任务气泡 (左对齐)
│   ├── 执行气泡 (左对齐)
│   └── 终端气泡 (右对齐)
└── AIInputDock (sticky bottom-0)
```

 ## 🎯 对话列表布局设计（暗调技术美学适配方案）  
基于之前生成的**奢华暗调技术风**视觉体系，结合对话列表的核心需求（信息分层、交互流畅、场景适配），以下是针对性的布局设计方案：


### 一、📐 总体布局逻辑  
对话列表采用「**垂直流式模块化结构**」，每一条对话项对应一个独立模块，遵循「**身份标识→内容主体→交互操作**」的阅读流，同时保留原设计的「暗调奢华+精密技术感」。  


### 二、✨ 对话列表核心设计（适配原视觉体系）  


#### 1. 🌐 基础视觉规范（继承+延伸）  
复用原设计的色彩、字体、动效系统，确保风格统一：  
| 维度          | 规范                                                                 |
|---------------|----------------------------------------------------------------------|
| **色彩系统**  | 主背景 `--bg-primary: #0F0F12`（深炭黑）；对话文本 `--text-primary: #E0E0E5`（金属灰）；强调色 `--accent: #FF6B00`（荧光橙） |
| **字体系统**  | 对话内容用 `Noto Serif SC 400`（细腻阅读）；身份标识用 `Noto Sans SC 700`（锐利识别）；操作按钮用 `JetBrains Mono`（技术感） |
| **动效系统**  | 对话项载入时「淡入+轻微上滑」（`opacity 0→1 + translateY 10px→0`）；交互元素悬停时「缩放+阴影」（`scale:1.05 + shadow-lg`） |


#### 2. 🧩 对话项模块设计（核心组件）  
每一条对话项分为「**身份区**」「**内容区**」「**操作区**」三大模块，以下是详细设计：  


##### （1）身份区（快速识别对话角色）  
**目标**：用极简元素区分「用户/系统/工具」身份，避免视觉干扰。  
| 元素          | 设计细节                                                                 |
|---------------|--------------------------------------------------------------------------|
| 身份标识      | 用「图标+缩写」组合：用户=👤+`User`；系统=🤖+`System`；工具=🔧+`Plugin`（字体 `Noto Sans SC 700 text-xs text-accent`） |
| 时间戳        | 右侧显示，`text-gray-400 text-xs italic`（如 `10:23`），悬停时展开完整时间（`2026-02-09 10:23:26`） |


##### （2）内容区（核心信息承载）  
**目标**：兼顾信息密度与阅读体验，支持「简短对话」和「长内容展开」。  
| 类型          | 设计规范                                                                 |
|---------------|--------------------------------------------------------------------------|
| 短对话（≤2行）| 直接显示，`text-primary text-base leading-relaxed`，背景无额外装饰       |
| 长对话（>2行）| 默认折叠为2行，末尾加「…」和展开箭头（`fa-chevron-down text-gray-400`）；点击展开后显示完整内容，背景变为 `bg-secondary/50`（`--bg-secondary: #1A1A1A`） |
| 代码/终端内容 | 沿用原设计的「终端面板样式」：`bg-terminal-bg rounded-lg p-3 font-jetbrains-mono text-sm`（`--terminal-bg: #0A0A0A`），支持复制操作 |


##### （3）操作区（快捷交互入口）  
**目标**：隐藏次要操作，保持界面简洁，悬停时显示。  
| 操作          | 设计细节                                                                 |
|---------------|--------------------------------------------------------------------------|
| 复制          | 悬停时显示「📋」图标（`text-gray-400 hover:text-accent`），点击后弹出「Copied!」气泡（`bg-green-500 text-white text-xs px-2 py-1 rounded`） |
| 展开/收起     | 长对话末尾的箭头图标，点击后内容高度平滑过渡（`height: 2rem→auto`，贝塞尔曲线 `cubic-bezier(0.4,0,0.2,1)`） |
| 回复          | 悬停时显示「💬」图标（`text-gray-400 hover:text-accent`），点击后聚焦输入框并自动填充「回复该内容：」 |


#### 3. 📱 响应式适配（多端兼容）  
- **移动端（≤768px）**：  
  - 身份区简化为「图标+时间戳」，隐藏缩写文字；  
  - 对话项左右内边距调整为 `p-2`，避免内容拥挤；  
  - 终端面板添加横向滚动（`overflow-x: auto`），防止代码换行。  
- **桌面端（>768px）**：  
  - 身份区显示完整「图标+缩写+时间戳」；  
  - 对话项最大宽度限制为 `800px`，居中显示，提升阅读舒适度；  
  - 操作区图标间距增大至 `1rem`，增强点击体验。  


### 三、🎬 交互流程图（关键场景）  
以「长对话展开→复制内容→回复」为例，交互流程如下：  
1. 用户看到折叠的长对话，末尾有「…+箭头」；  
2. 点击箭头→内容平滑展开，背景变为浅黑色；  
3. 悬停内容→显示「复制」和「回复」图标；  
4. 点击「复制」→弹出「Copied!」气泡；  
5. 点击「回复」→输入框聚焦，自动填充「回复该内容：」。  


### 四、💻 代码示例（核心组件）  
以下是对话项的HTML+CSS实现（基于Tailwind CSS语法）：  
```html
<!-- 对话项容器 -->
<div class="mb-4 max-w-2xl mx-auto transition-all duration-300 ease-out">
  <!-- 身份区 -->
  <div class="flex items-center justify-between mb-1">
    <div class="flex items-center gap-2">
      <span class="text-accent text-xl">🤖</span>
      <span class="font-noto-sans text-accent text-xs font-bold">System</span>
    </div>
    <span class="text-gray-400 text-xs italic hover:text-gray-300 cursor-pointer" 
          title="2026-02-09 10:23:26">10:23</span>
  </div>
  <!-- 内容区（长对话折叠状态） -->
  <div class="relative bg-secondary/50 rounded-lg p-3 overflow-hidden">
    <p class="text-primary text-base leading-relaxed line-clamp-2">
      I have Gmail available, but I'm wondering if there's a way to access events through it...
    </p>
    <button class="absolute bottom-2 right-2 text-gray-400 hover:text-accent transition-colors"
            onclick="toggleExpand(this)">
      <i class="fa fa-chevron-down"></i>
    </button>
  </div>
  <!-- 操作区（悬停显示） -->
  <div class="mt-1 flex gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
    <button class="text-gray-400 hover:text-accent" onclick="copyContent()">
      <i class="fa fa-clipboard"></i>
    </button>
    <button class="text-gray-400 hover:text-accent" onclick="replyToMessage()">
      <i class="fa fa-reply"></i>
    </button>
  </div>
</div>

<!-- CSS 自定义类 -->
<style>
@layer utilities {
  .font-noto-sans { font-family: 'Noto Sans SC', sans-serif; }
  .font-noto-serif { font-family: 'Noto Serif SC', serif; }
  .font-jetbrains { font-family: 'JetBrains Mono', monospace; }
  .line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
}
</style>
```

 