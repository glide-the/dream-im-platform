# Chat Send — 输入与发送 PRD

> 对话页面「消息输入区」与「已发送消息」的布局、交互与视觉规范。
> 核心原则：**发送前（输入态）与发送后（已发消息）使用统一布局容器**，保证视觉一致性。

---

## 1. 页面结构总览

```
+---------------------------------------------------+
|  VerticalNav | Sidebar |       Main Area         New Chat |
|              |         | +---------------------+   |
|              |         | |  ChatMessageList    |   |
|              |         | |  (flex-1 scroll)    |   |
|              |         | |  +---------------+  |   |
|              |         | |  | Message Card  |  |   |
|              |         | |  | (unified style)|  |   |
|              |         | |  +---------------+  |   |
|              |         | |        ...          |   |
|              |         | +---------------------+   |
|              |         | +---------------------+   |
|              |         | |  AIInputDock        |   |
|              |         | |  (sticky bottom)    |   |
|              |         | +---------------------+   |
|              |         |                           |
+---------------------------------------------------+
```

- **ChatPanel**（`app/components/chat/ChatPanel.tsx`）：容器组件，`flex min-h-0 flex-col`
- **ChatMessageList**：`flex-1 overflow-y-auto`，消息滚动区
- **AIInputDock**：`sticky bottom-0`，输入区固定在底部

---

## 2. 输入区（发送前）— AIInputDock

### 2.1 外层容器

| 属性    | 规范                                                 |
|---------|------------------------------------------------------|
| 定位    | `sticky bottom-0`，居中 `mx-auto`                     |
| 最大宽度 | `max-w-3xl`（768px）                                  |
| 圆角    | `rounded-2xl`（16px）                                 |
| 边框    | `1px solid var(--neutral-border)`                     |
| 背景    | `bg-white/80 backdrop-blur-md`                        |
| 内边距  | `p-5`（外层）-> 内部 `p-3`（AIInputDock 自身）          |
| 阴影    | `shadow-sm`，hover 时 `shadow-md`（0.3s transition）   |

### 2.2 快捷键提示行

| 元素           | 规范                                                              |
|----------------|-------------------------------------------------------------------|
| 快捷键提示     | `ml-auto text-xs text-text-tertiary`，显示 "Cmd + Enter 发送"       |

### 2.3 文件预览区

- 条件显示：当 `uploadedFiles.length > 0` 时出现
- 图片文件：`h-20 w-20 object-cover rounded-lg`
- 非图片文件：`h-20 w-28`，显示图标 + 文件名 + 扩展名 + 大小
- 上传中覆盖层：半透明背景 + 旋转加载图标 + 进度条
- hover 显示删除按钮

### 2.4 输入行

| 元素        | 规范                                                              |
|-------------|-------------------------------------------------------------------|
| 文本框      | `min-h-[44px] rounded-md border bg-bg-surface px-4 py-3 text-sm`  |
| 浮动标签    | `"Press i chat"`，`text-xs text-[#999]`，聚焦/有内容时上移至 `-top-2` |
| 字符计数    | `absolute bottom-1.5 right-2 text-[11px]`，显示 `{n}/2000`        |
| + Add 按钮  | `h-10 rounded-md border px-3 text-sm`，点击展开附件菜单            |
| 发送按钮    | `h-10 w-10 rounded-full bg-accent-orange text-white shadow-md`     |

### 2.5 输入框聚焦态

- 边框：`border-accent-orange`
- 光环：`ring-2 ring-accent-orange`
- 浮动标签上移至 `-top-2`

---

## 3. 已发送消息（发送后）— ChatMessageList

### 3.1 核心规范：与输入区布局对齐

> **发送后的用户消息卡片应继承输入区的容器风格**，保持视觉一致。

### 3.2 消息卡片规范

#### 用户消息（右对齐）

| 属性    | 当前实现                                  | 目标规范（与输入区对齐）                      |
|---------|------------------------------------------|----------------------------------------------|
| 最大宽度 | `max-w-[90%]`                           | `max-w-3xl`（与输入区一致）                   |
| 圆角    | `rounded-2xl rounded-tr-none`            | `rounded-2xl`（与输入区容器对齐）              |
| 背景    | `bg-accent-orange text-white`            | `bg-accent-orange text-white`（保持）         |
| 内边距  | `px-3 py-2`                              | `px-4 py-3`（与输入区文本框内边距对齐）        |
| 字号    | `text-[14px] leading-[1.6]`              | `text-sm leading-[1.6]`（与输入区一致）      |
| 对齐    | `justify-end`                            | `justify-end`（保持右对齐）                   |

#### AI 回复消息（左对齐）

| 属性    | 规范                                                              |
|---------|-------------------------------------------------------------------|
| 最大宽度 | `max-w-[90%]`                                                    |
| 圆角    | `rounded-2xl rounded-tl-none`                                     |
| 背景    | `bg-[#F5F5F5] text-text-secondary`                                |
| 内边距  | `px-3 py-2`                                                       |
| 内容    | Markdown 渲染（`react-markdown` + `remark-gfm`）                  |
| 链接色  | `text-accent-orange underline`                                    |
| 强调色  | `text-accent-orange font-semibold`                                |

#### 工具调用消息

| 属性    | 规范                                                              |
|---------|-------------------------------------------------------------------|
| 最大宽度 | `max-w-[90%]`                                                    |
| 圆角    | `rounded-lg`                                                      |
| 背景    | `bg-[#F5F5F5]`                                                    |
| 动效    | hover 时 `translateY(-3px)` + `shadow-medium`                     |

#### 文件消息

| 属性    | 规范                                                              |
|---------|-------------------------------------------------------------------|
| 最大宽度 | `max-w-[80%]`                                                    |
| 渲染    | `FileMessagePart` 组件，支持图片预览与非图片文件卡片                |

### 3.3 操作历史折叠区

- 步骤 / 推理内容折叠在消息顶部
- 容器：`rounded-lg border border-border/60 bg-bg-secondary/40 p-2`
- 左侧指示条：`h-4 w-0.5 bg-accent-orange`
- 折叠/展开按钮：`text-xs text-accent-orange underline`

### 3.4 加载指示器

- 宽度固定 `w-[220px]`
- 橙色渐变进度条动画：`animate-orange-progress`

### 3.5 错误消息

- `rounded-2xl rounded-tl-none bg-red-100 px-3 py-2 text-sm text-red-600`

---

## 4. 发送流程

```
用户输入 -> 点击发送 / Cmd+Enter
  |
  +-- 校验：文本非空 或 有附件
  +-- 校验：无正在上传的文件
  |
  +-- 组装 parts: FileUIPart[] + TextUIPart
  +-- 设置 pendingData（attachments, customerIds, toolChoice）
  +-- 调用 sendMessage({ role: "user", parts })
  |
  +-- 清空输入框
  +-- 释放文件预览 URL
  +-- 清空 uploadedFiles
```

### 4.1 请求体结构（ChatApiSchemaRequestBody）

```typescript
{
  id: string;                    // chat ID
  message: UIMessage;            // 最后一条用户消息
  chatModel: string;             // 默认模型
  toolChoice: "auto" | "manual" | "none";
  allowedAppDefaultToolkit: [];
  allowedMcpServers: {};
  attachments: ChatAttachment[]; // { type, url, mediaType, filename }
  contextCustomerIds: string[];
}
```

### 4.2 键盘快捷键

| 快捷键       | 行为              |
|-------------|-------------------|
| Cmd + Enter   | 发送消息          |
| Shift + Enter | 换行（不发送）   |

---

## 5. 色彩系统

```css
:root {
  --bg-primary: #FFFFFF;
  --bg-surface: #FFFFFF;
  --luxury-ivory: #F8F7F4;       /* 页面背景 */
  --neutral-border: #E5E5E5;     /* 边框 */
  --accent-orange: #FF7A00;      /* 主强调色 */
  --accent-orange-light: #FFEFE0; /* 强调色浅背景 */
  --text-primary: #333333;
  --text-secondary: #666666;
  --text-tertiary: #999999;
}
```

---

## 6. 动效规范

| 动效               | 实现                                        | 场景            |
|--------------------|---------------------------------------------|-----------------|
| 输入区 hover       | `shadow-sm -> shadow-md`，`0.3s transition`   | 输入区容器      |
| 发送按钮点击       | `active:scale-95`，0.1s                      | 发送按钮        |
| 文件预览 hover     | `border-border -> border-accent-orange`       | 文件缩略图      |
| 浮动标签动画       | `transition-all`，top 从 `top-3` 到 `-top-2` | 输入框标签      |
| 工具消息 hover     | `translateY(-3px) + shadow-medium`           | 工具调用卡片    |
| 加载进度           | `animate-orange-progress` 渐变滑动           | 加载指示器      |

---

## 7. 响应式适配

| 断点                | 适配策略                                        |
|---------------------|-------------------------------------------------|
| 桌面端（>=768px）    | 输入区 `max-w-3xl` 居中，侧边栏展开              |
| 移动端（<768px）     | 输入区全宽 `w-full`，侧边栏隐藏，通过汉堡按钮呼出 |

---

## 8. 关联文件

| 文件                                        | 职责                    |
|---------------------------------------------|------------------------|
| `app/components/AIInputDock.tsx`            | 输入区组件              |
| `app/components/chat/ChatPanel.tsx`         | 对话面板容器            |
| `app/components/chat/ChatMessageList.tsx`   | 消息列表渲染            |
| `app/lib/chat-schema.ts`                   | 请求体 Schema 定义      |
| `app/components/chat/interaction-utils.ts`  | 键盘快捷键逻辑          |
