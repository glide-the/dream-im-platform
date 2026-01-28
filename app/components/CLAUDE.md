# 共享组件模块

> **导航**: [← 返回根目录](../../CLAUDE.md) / 共享组件模块
> **路径**: `app/components/`
> **最后更新**: 2026-01-27 17:25:20

---

## 📋 模块概览

共享组件模块包含可复用的 UI 组件,为整个应用提供一致的用户界面元素。

### 核心职责

- 提供可复用的 UI 组件
- 统一交互模式
- 封装通用逻辑

### 技术特点

- **客户端组件**: 所有组件使用 `"use client"` 指令
- **类型安全**: 完整的 TypeScript Props 类型
- **样式一致**: 使用统一的设计系统

---

## 📁 组件列表

```
app/components/
├── BottomNav.tsx          # 底部导航栏
├── FloatingAIButton.tsx   # 悬浮 AI 按钮
├── Icons.tsx              # 图标组件集合
├── Modal.tsx              # 模态框
└── Toast.tsx              # 提示消息
```

---

## 🧭 底部导航栏 (`BottomNav.tsx`)

### 功能说明

固定在页面底部的导航栏,提供主要页面的快速切换。

### 导航项

| 图标 | 标签 | 路由 | 说明 |
|------|------|------|------|
| IconCheckSquare | 待办 | /todo | 待办列表 |
| IconUsers | 客户 | /customers | 客户列表 |
| IconUser | 我的 | /me | 个人中心 |

### 组件结构

```typescript
export default function BottomNav() {
  const pathname = usePathname();

  const navItems = [
    { href: "/todo", icon: IconCheckSquare, label: "待办" },
    { href: "/customers", icon: IconUsers, label: "客户" },
    { href: "/me", icon: IconUser, label: "我的" }
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-bg-primary/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-around px-4 py-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={/* 样式 */}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-xs">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
```

### 样式特点

- **固定定位**: `fixed bottom-0`
- **毛玻璃效果**: `backdrop-blur-sm`
- **半透明背景**: `bg-bg-primary/95`
- **激活状态**: 蓝色高亮 + 粗体

### 激活状态判断

```typescript
const isActive = pathname === item.href;
```

使用 `usePathname()` Hook 获取当前路由,与导航项路由比较。

---

## 🎈 悬浮 AI 按钮 (`FloatingAIButton.tsx`)

### 功能说明

固定在右下角的圆形按钮,点击跳转到 AI 助手页面。

### 组件结构

```typescript
export default function FloatingAIButton() {
  return (
    <Link
      href="/ai-assistant"
      className="fixed bottom-20 right-6 z-50 grid h-14 w-14 place-items-center rounded-full bg-accent text-white shadow-accent"
    >
      <IconSparkles className="h-6 w-6" />
    </Link>
  );
}
```

### 样式特点

- **固定定位**: `fixed bottom-20 right-6`
- **圆形按钮**: `rounded-full h-14 w-14`
- **强调色背景**: `bg-accent`
- **阴影效果**: `shadow-accent`
- **居中图标**: `grid place-items-center`

### 位置计算

- `bottom-20`: 距离底部 5rem (80px),避开底部导航栏
- `right-6`: 距离右侧 1.5rem (24px)

---

## 🎨 图标组件 (`Icons.tsx`)

### 功能说明

封装常用的 SVG 图标,提供统一的图标接口。

### 图标列表

| 组件名 | 用途 | 路径 |
|--------|------|------|
| IconCheckSquare | 待办 | 底部导航 |
| IconUsers | 客户 | 底部导航 |
| IconUser | 我的 | 底部导航 |
| IconSparkles | AI | 悬浮按钮 |
| IconSend | 发送 | AI 助手输入框 |
| IconPaperclip | 附件 | AI 助手上下文 |
| IconImage | 图片 | AI 助手上下文 |
| IconCamera | 拍照 | AI 助手上下文 |

### 组件模板

```typescript
export function IconName(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M..."
      />
    </svg>
  );
}
```

### 使用方式

```typescript
import { IconSparkles } from "@/app/components/Icons";

<IconSparkles className="h-6 w-6 text-accent" />
```

### 特性

- **继承颜色**: `stroke="currentColor"`
- **可定制大小**: 通过 `className` 设置
- **类型安全**: 继承 `React.SVGProps<SVGSVGElement>`

---

## 🪟 模态框 (`Modal.tsx`)

### 功能说明

通用模态框组件,用于展示弹出内容。

### Props

```typescript
type ModalProps = {
  open: boolean;           // 是否打开
  title: string;           // 标题
  onClose: () => void;     // 关闭回调
  children: React.ReactNode; // 内容
};
```

### 组件结构

```typescript
export default function Modal({ open, title, onClose, children }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-100 grid place-items-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-bg-primary p-6 shadow-medium">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full border border-border bg-bg-surface text-text-secondary"
          >
            ×
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
```

### 样式特点

- **全屏遮罩**: `fixed inset-0`
- **半透明背景**: `bg-black/50`
- **居中显示**: `grid place-items-center`
- **最大宽度**: `max-w-md`
- **高层级**: `z-100`

### 使用示例

```typescript
const [modalOpen, setModalOpen] = useState(false);

<Modal
  open={modalOpen}
  title="选择客户"
  onClose={() => setModalOpen(false)}
>
  <div>模态框内容</div>
</Modal>
```

---

## 💬 提示消息 (`Toast.tsx`)

### 功能说明

临时提示消息组件,用于操作反馈。

### Props

```typescript
type ToastProps = {
  message: string;         // 消息内容
  onClose: () => void;     // 关闭回调
  duration?: number;       // 持续时间 (ms)
};
```

### 组件结构

```typescript
export default function Toast({
  message,
  onClose,
  duration = 3000
}: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  return (
    <div className="fixed bottom-24 left-1/2 z-100 -translate-x-1/2 rounded-full border border-border bg-bg-primary px-4 py-2 text-sm font-semibold text-text-primary shadow-medium">
      {message}
    </div>
  );
}
```

### 样式特点

- **固定定位**: `fixed bottom-24`
- **水平居中**: `left-1/2 -translate-x-1/2`
- **圆角胶囊**: `rounded-full`
- **高层级**: `z-100`

### 自动关闭

使用 `useEffect` + `setTimeout` 实现自动关闭:

```typescript
useEffect(() => {
  const timer = setTimeout(onClose, duration);
  return () => clearTimeout(timer);
}, [duration, onClose]);
```

### 使用示例

```typescript
const [toast, setToast] = useState<string | null>(null);

// 显示提示
setToast("操作成功");

// 渲染
{toast && <Toast message={toast} onClose={() => setToast(null)} />}
```

---

## 🎨 设计系统

### 颜色使用

- **背景色**:
  - `bg-bg-primary`: 主背景
  - `bg-bg-secondary`: 次背景
  - `bg-bg-surface`: 表面色
- **文本色**:
  - `text-text-primary`: 主文本
  - `text-text-secondary`: 次文本
  - `text-text-tertiary`: 三级文本
- **强调色**:
  - `bg-accent`: 强调背景
  - `text-accent`: 强调文本
  - `border-accent`: 强调边框

### 圆角规范

- 小组件: `rounded-xl` (12px)
- 卡片: `rounded-2xl` (16px)
- 按钮: `rounded-full`

### 阴影规范

- `shadow-subtle`: 轻微阴影
- `shadow-medium`: 中等阴影
- `shadow-accent`: 强调阴影

### 间距规范

- 内边距: `p-4` / `p-6`
- 外边距: `mt-4` / `mb-6`
- 间隙: `gap-2` / `gap-3`

---

## 🔧 开发建议

### 新增组件

1. 在 `app/components/` 下创建新文件
2. 使用 `"use client"` 指令
3. 定义 Props 类型
4. 导出默认组件
5. 在需要的地方导入使用

### 组件模板

```typescript
"use client";

type ComponentNameProps = {
  // Props 定义
};

export default function ComponentName(props: ComponentNameProps) {
  return (
    <div>
      {/* 组件内容 */}
    </div>
  );
}
```

### 样式建议

- 使用 Tailwind CSS 类名
- 遵循设计系统规范
- 保持响应式设计
- 添加过渡动画 (`transition-*`)

### 可访问性

- 使用语义化 HTML
- 添加 ARIA 属性
- 支持键盘导航
- 提供焦点样式

---

## 🐛 已知问题

1. **Toast 堆叠**: 多个 Toast 同时显示时会重叠
2. **Modal 嵌套**: 不支持多层模态框
3. **图标库**: 图标数量有限,需扩展
4. **动画效果**: 缺少进入/退出动画

---

## 📊 性能优化

1. **懒加载**: 大组件使用 `React.lazy`
2. **Memo**: 纯展示组件使用 `React.memo`
3. **事件委托**: 列表组件使用事件委托
4. **虚拟滚动**: 长列表使用虚拟滚动

---

**生成时间**: 2026-01-27 17:25:20
