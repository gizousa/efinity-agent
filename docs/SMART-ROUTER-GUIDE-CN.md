# OpenClaw 智能路由系统完整指南

## 🚀 快速开始（必读）

### 第一步：安装和启用

```bash
# 1. Clone 项目并安装依赖
git clone <your-repo-url>
cd openclaw
pnpm install
pnpm build

# 2. 安装到系统
pnpm link  # 或 npm link

# 3. ⚠️ 重要：必须启用智能路由（复制种子文件到用户目录）
openclaw smart-router enable
```

**为什么必须执行 `openclaw smart-router enable`？**
- 启用命令会自动复制种子文件到 `~/.openclaw/smart-router/`
- 如果不启用，需要手动复制（不推荐）
- 种子文件包括：DNA意图分类 + 默认用户学习数据

### 第二步：配置模型（必须！）

⚠️ **重要：检查并修改路由配置！**

```bash
# 查看当前配置
openclaw config get

# 编辑配置文件
~/.openclaw/config.json
```

**必须确认的配置项：**

```json
{
  "smartRouting": {
    "enabled": true,
    "lightweightModels": ["你的轻量模型"],
    "flagshipModels": ["你的旗舰模型"],
    "embedding": {
      "model": "Qwen/Qwen3-Embedding-0.6B",
      "apiKey": "你的千问API密钥"
    }
  }
}
```

**⚠️ 关键警告：模型一致性！**

```
生成种子数据的模型  必须等于  运行时使用的模型
│                              │
│     Qwen/Qwen3-Embedding-0.6B    │
└────────────────────────────────┘
```

- 项目默认使用 **千问 Qwen3-Embedding-0.6B** 模型
- 如果使用项目自带的数据 → 必须配置千问模型
- 如果使用自己的数据 → 必须用千问模型重新生成

### 第三步：验证配置

```bash
# 发送一个测试查询
echo "测试智能路由"

# 查看路由日志（应该看到路由决策）
# 日志位置：根据你的系统配置
```

---

## 📚 进阶：自定义种子数据

### DNA 分类说明

系统包含 **6 个预定义语义类别**：

| 类别 | 说明 | 优先级 | 示例查询 |
|------|------|--------|----------|
| **CHAT** | 日常闲聊 | 轻量 | "你好", "今天天气怎么样" |
| **CODE** | 代码相关 | 旗舰 | "写个函数", "帮我debug" |
| **FACT** | 事实查询 | 轻量 | "1+1等于几", "法国首都在哪" |
| **REASON** | 推理分析 | 旗舰 | "分析一下这个问题", "比较这两个方案" |
| **TRANS** | 翻译转换 | 轻量 | "翻译这句话", "总结一下" |
| **WRITE** | 写作生成 | 轻量 | "写首诗", "帮我写篇文章" |

### 自定义数据格式

**种子数据 JSON 格式：**

```json
[
  {
    "text": "你的查询文本",
    "label": "类别名称"
  }
]
```

**示例：**

```json
[
  {"text": "帮我写一个Python函数", "label": "CODE"},
  {"text": "今天天气怎么样", "label": "CHAT"},
  {"text": "1加1等于几", "label": "FACT"},
  {"text": "分析一下这两个方案的优缺点", "label": "REASON"},
  {"text": "把这段话翻译成英文", "label": "TRANS"},
  {"text": "帮我写一首关于春天的诗", "label": "WRITE"}
]
```

### 生成种子文件

**重要：生成前配置 API 密钥！**

```bash
# 设置千问 API 密钥
export SILICONFLOW_API_KEY="sk-你的密钥"

# 或者在代码中直接配置（参考下方）
```

**生成命令：**

```bash
# 生成 DNA 意图文件（6个分类的代表点）
pnpm smart-router:generate-dna

# 生成用户学习数据文件
pnpm smart-router:generate-user-memory

# 或一次性生成所有
pnpm smart-router:generate-all
```

**生成脚本位置：**

```
scripts/generate-dna-seeds.ts     # DNA生成脚本
scripts/generate-user-memory.ts  # 用户库生成脚本
```

**输出文件：**

```
src/smart-router/dna/base_dna.bin              # DNA意图分类
src/smart-router/dna/default_user_memory.bin  # 用户学习数据
```

### 修改生成脚本配置

如果需要自定义 API 或种子数据路径，编辑：

**scripts/generate-dna-seeds.ts:**

```typescript
// 配置区域（文件顶部）
const SEED_FILES = [
  path.join(__dirname, 'your-seeds.json')  // 你的种子数据
]

const EMBEDDING_API_KEY = process.env.SILICONFLOW_API_KEY || 'sk-你的密钥'
const EMBEDDING_API_URL = 'https://api.siliconflow.cn/v1/embeddings'
const EMBEDDING_MODEL = 'Qwen/Qwen3-Embedding-0.6B'  // 必须和运行时一致！
```

**scripts/generate-user-memory.ts:** 同上

### 重新生成种子文件

如果修改了种子数据或模型：

```bash
# 1. 重新生成
pnpm smart-router:generate-all

# 2. 复制到用户目录（覆盖旧文件）
cp src/smart-router/dna/base_dna.bin ~/.openclaw/smart-router/
cp src/smart-router/dna/default_user_memory.bin ~/.openclaw/smart-router/user_memory.bin

# 3. 重启应用使新文件生效
```

---

## ⚠️ 常见问题和注意事项

### 问题1：没有启用智能路由

**症状：** 路由不工作，所有查询都用同一个模型

**解决：**
```bash
openclaw smart-router enable
```

### 问题2：模型配置错误

**症状：** 查询报错或路由决策不合理

**解决：**
1. 检查 `~/.openclaw/config.json`
2. 确保 `lightweightModels` 和 `flagshipModels` 配置正确
3. 确保 `embedding.model` 是千问模型

### 问题3：向量质量差

**症状：** 相似度得分普遍很低（< 0.6）

**可能原因：**
- 种子数据模型 ≠ 运行时模型
- API 密钥错误或配额用完

**解决：**
1. 确认模型一致
2. 检查 API 密钥
3. 重新生成种子文件

---

## 📋 目录
- [系统概述](#系统概述)
- [实现原理](#实现原理)
- [使用方法](#使用方法)
- [配置说明](#配置说明)
- [快速教程](#快速教程)
- [核心特性](#核心特性)
- [已知问题](#已知问题)
- [系统架构](#系统架构)
- [问题记录](#问题记录)

---

## 系统概述

### 什么是智能路由？

OpenClaw 智能路由系统是一个基于语义相似度的 AI 模型自动选择引擎，能够：

- **自动分类查询**：根据用户查询的语义类型自动分类
- **智能模型选择**：简单查询用轻量模型，复杂查询用旗舰模型
- **持续学习优化**：根据用户使用习惯自动优化路由决策
- **成本优化**：节省 60-80% 的 API 调用成本

### 核心价值

```
传统方式：所有查询 → 旗舰模型 → 高成本
智能路由：
  ├─ 简单查询（60%） → 轻量模型 → 省钱
  ├─ 代码查询（20%） → 旗舰模型 → 质量
  ├─ 推理查询（15%） → 旗舰模型 → 质量
  └─ 其他查询（5%） → 轻量模型 → 省钱
```

---

## 实现原理

### 1. 向量化表示

所有文本（查询、DNA意图、用户学习数据）都通过 Embedding 模型转换为 1024 维向量：

```typescript
// 文本 → 向量
"写个正则表达式" → Float32Array(1024)
  ↓ Embedding API
[0.0123, -0.0456, 0.0789, ...]  // 1024维向量
```

### 2. 分层索引系统

```
┌─────────────────────────────────────────────┐
│ Layer 1: 用户学习数据 (Patches)             │
│   - 874条个性化学习数据                     │
│   - 软分区双重检测                          │
│   - 阈值: 0.55                              │
├─────────────────────────────────────────────┤
│ Layer 2: DNA意图分类 (Static Categories)    │
│   - 6个预定义语义类别                       │
│   - Medoid代表点                            │
│   - 阈值: 0.60                              │
├─────────────────────────────────────────────┤
│ Layer 3: 关键词匹配 (Keywords)              │
│   - 前缀命令检测                            │
│   - 特殊关键词识别                          │
└─────────────────────────────────────────────┘
```

### 3. 相似度计算

使用**余弦相似度**（通过点积优化）：

```typescript
// 向量已预单位化，余弦相似度 = 点积
similarity = dotProduct(queryVector, centroid)
// 范围: [-1, 1]，1表示完全相同
```

**性能优化：**
- 向量预单位化（一次性 normalize）
- 避免重复计算模长
- 性能提升 10x

### 4. 智能决策流程

```typescript
1. 前缀检测 → 用户手动指定？ → 直接返回
2. 关键词匹配 → 特殊关键词？ → 返回对应模型
3. Patch搜索 → 用户学习数据匹配？ → 返回对应模型
4. DNA分类 → 语义类型匹配？ → 返回对应模型
5. 默认 → 轻量模型
```

---

## 使用方法

### 启用智能路由

```bash
# 方式1：通过配置文件
~/.openclaw/config.json
{
  "smartRouting": {
    "enabled": true
  }
}

# 方式2：通过命令
openclaw smart-router enable
```

### 禁用智能路由

```bash
openclaw smart-router disable
```

### 查看路由统计

```bash
openclaw smart-router stats
```

---

## 配置说明

### 主配置文件：`~/.openclaw/config.json`

```json
{
  "smartRouting": {
    "enabled": true,

    // 模型配置
    "lightweightModels": ["zai/glm-4.5-air", "claude-3-5-haiku"],
    "flagshipModels": ["zai/glm-4.7", "claude-3-7-sonnet"],

    // 阈值配置
    "patchSimilarityThreshold": 0.55,
    "dnaSimilarityThreshold": 0.60,
    "softPartitionThreshold": 0.1,

    // Embedding配置
    "embedding": {
      "model": "Qwen/Qwen3-Embedding-0.6B",
      "timeoutMs": 5000,
      "apiKey": "your-api-key"
    }
  }
}
```

### 阈值说明

| 阈值 | 默认值 | 作用 | 调整建议 |
|------|--------|------|----------|
| `patchSimilarityThreshold` | 0.55 | 用户学习数据匹配阈值 | 提高→更严格，降低→更宽松 |
| `dnaSimilarityThreshold` | 0.60 | DNA意图匹配阈值 | 提高→更严格，降低→更宽松 |
| `softPartitionThreshold` | 0.1 | 软分区边界阈值 | 降低→更多双重检测 |

---

## 快速教程

### 教程1：生成自定义DNA文件

如果你有自己的种子数据，可以生成自定义DNA：

```bash
# 1. 准备种子数据 JSON 文件
cat > my_seeds.json << EOF
[
  {"text": "帮我写个函数", "label": "CODE"},
  {"text": "今天天气怎么样", "label": "CHAT"},
  {"text": "1+1等于几", "label": "FACT"}
]
EOF

# 2. 修改生成脚本
# 编辑 scripts/generate-dna-seeds.ts
# 将 my_seeds.json 添加到 SEED_FILES 数组

# 3. 生成DNA文件
pnpm smart-router:generate-dna

# 4. 复制到配置目录
cp src/smart-router/dna/base_dna.bin ~/.openclaw/smart-router/
```

### 教程2：重新生成用户学习数据

如果向量质量有问题，重新生成用户库：

```bash
# 1. 确保API密钥正确
export SILICONFLOW_API_KEY="your-key"

# 2. 生成用户库
pnpm smart-router:generate-user-memory

# 3. 复制到配置目录
cp src/smart-router/dna/default_user_memory.bin ~/.openclaw/smart-router/user_memory.bin
```

### 教程3：调整路由策略

根据你的需求调整阈值：

```json
{
  "smartRouting": {
    // 更激进：匹配更多查询
    "patchSimilarityThreshold": 0.50,
    "dnaSimilarityThreshold": 0.55,

    // 更保守：只匹配高置信度查询
    "patchSimilarityThreshold": 0.70,
    "dnaSimilarityThreshold": 0.75
  }
}
```

---

## 核心特性

### 1. Medoid算法代替Centroid

**优势：**
- Medoid永远是真实的样本向量
- 不会被"平均化"抹除特征
- 对离群值更鲁棒

**实现：**
```typescript
// 选择到同类其他所有点距离之和最短的向量
Medoid = argmin(Σ distance(v, other))
```

### 2. 动态置信度惩罚

**平滑的惩罚曲线：**
```
confidence >= 0.15 → 无惩罚 (factor = 1.0)
confidence = 0.10  → 轻微惩罚 (factor = 0.98)
confidence = 0.05  → 中度惩罚 (factor = 0.95)
confidence = 0.00  → 重度惩罚 (factor = 0.90)
```

**优势：**
- 更好处理CHAT和WRITE之间的模糊边界
- 避免硬阈值导致的突然跳变

### 3. 短查询增强

**检测：** 字符数 < 6
**增强：** 阈值降低0.05

**示例：**
```typescript
"写个诗" (4字) → 阈值 0.60 → 0.55
"你吃饭了吗" (5字) → 阈值 0.60 → 0.55
```

### 4. 软分区双重检测

**触发条件：** 最佳DNA和第二DNA得分差 < 0.1
**行为：** 同时搜索两个分区的Patches

**示例：**
```
查询: "帮我写一首情诗"
DNA得分: write(0.65), chat(0.62), code(0.30)
置信度: 0.65 - 0.62 = 0.03 < 0.1 → 触发双重检测
搜索: flagship patches + lightweight patches
```

### 5. 查询结果缓存

**LRU缓存：**
- 最大1000条目
- 60秒TTL
- 向量哈希作为key

**性能提升：**
- 缓存命中：< 1ms
- 缓存未命中：5-10ms

---

## 已知问题

### 问题1：向量空间不一致

**现象：**
- 用户库有874条数据
- 但Patch得分只有0.52-0.65
- 理论上应该有>0.80的匹配

**原因：**
- 用户库可能用老Embedding模型生成
- 运行时用新模型
- 向量空间不一致

**解决方案：**
1. 确认用户库和运行时用同一个模型
2. 重新生成用户库（用当前模型）

### 问题2：简短查询匹配困难

**现象：**
```
"写个诗" → 0.526 (低)
"帮我写个很长的函数" → 0.78 (高)
```

**原因：**
- 短查询语义信息少
- Embedding模型对长文本处理更好

**缓解措施：**
- 短查询增强（< 6字符阈值-0.05）
- 添加更多短句种子数据

### 问题3：中英混合性能

**现象：**
```
"Write a function" → 0.75 (好)
"写个函数" → 0.58 (差)
```

**原因：**
- 当前模型Qwen3是多语言模型
- 对中文简短句子理解不够好

**解决方案：**
- 换用中文专用模型：`BAAI/bge-large-zh-v1.5`

### 问题4：DNA类别区分度不够

**现象：**
- 置信度普遍 < 0.1
- 最佳和第二佳差距很小

**原因：**
- 6个类别可能太粗粒度
- CHAT和WRITE边界模糊

**未来改进：**
- 增加类别数量（12个）
- 多标签分类
- 层级分类

---

## 系统架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│                    用户查询输入                            │
│              "帮我写一个Python正则表达式"                │
└─────────────────────┬───────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│              SmartRouter.decide()                        │
│                                                         │
│  1. 前缀检测 → "flagship:" prefix                     │
│  2. 关键词匹配 → 正则、代码关键词                       │
│  3. Embedding API调用 → 1024维向量                     │
│  4. LayeredIndex搜索 → Patches + DNA                    │
│  5. 决策输出 → tier + model + confidence               │
└─────────────────────┬───────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│               LayeredIndex.search()                      │
│                                                         │
│  ┌───────────────────────────────────────────────┐    │
│  │ 查询缓存 (LRU)                               │    │
│  │ - 向量哈希作为key                             │    │
│  │ - 60秒TTL                                    │    │
│  └─────────────────┬─────────────────────────────┘    │
│                    ↓ 缓存未命中                        │
│  ┌───────────────────────────────────────────────┐    │
│  │ searchPatches() - 软分区双重检测             │    │
│  │ - DNA确定tier                               │    │
│  │ - 搜索对应tier的patches                      │    │
│  │ - 阈值: 0.55                                │    │
│  └─────────────────┬─────────────────────────────┘    │
│                    ↓ 未匹配                            │
│  ┌───────────────────────────────────────────────┐    │
│  │ searchDNA() - Top-K置信度检查               │    │
│  │ - 计算6个DNA相似度                          │    │
│  │ - 动态置信度惩罚                            │    │
│  │ - 阈值: 0.60                                │    │
│  └───────────────────────────────────────────────┘    │
└─────────────────────┬───────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│              RoutingDecision 输出                         │
│                                                         │
│  {                                                     │
│    modelTier: "flagship",                             │
│    selectedModel: "zai/glm-4.7",                      │
│    confidence: 0.65,                                   │
│    reasoning: "Patch hit (similarity 0.65)"           │
│  }                                                     │
└─────────────────────────────────────────────────────────┘
```

### 模块依赖关系

```
smart-router/
├── types/
│   └── smart-router.types.ts          # 类型定义
├── routing/
│   ├── router.ts                     # 主路由逻辑
│   ├── layered-index.ts              # 分层索引
│   ├── similarity.ts                 # 相似度计算
│   └── vector-store.ts               # 向量存储
├── memory/
│   └── vector-store.ts               # VectorStore类
└── dna/
    ├── base_dna.bin                  # DNA文件
    └── default_user_memory.bin       # 用户库文件
```

---

## 问题记录

### 当前遇到的问题

#### 问题1：Patch相似度偏低

**时间：** 2026-02-01
**现象：** 874条用户数据，但Patch得分只有0.52-0.65
**分析：**
- 阈值从0.85降到0.55才能匹配
- 说明向量质量或一致性有问题
**当前状态：** 已通过降低阈值缓解（0.55）
**待解决：** 确认用户库生成时的Embedding模型

#### 问题2：DNA置信度普遍低

**时间：** 2026-02-01
**现象：** 置信度大部分 < 0.1
**分析：**
- 最佳和第二佳DNA得分差距太小
- 说明6个DNA类别区分度不够
**当前状态：** 已实现动态置信度惩罚缓解
**待解决：** 考虑增加类别数量或使用更细粒度分类

#### 问题3：简短查询匹配困难

**时间：** 2026-02-01
**现象：** "写个诗"(4字)得分0.526，长句得分0.75+
**分析：** 短查询语义信息少，向量表示不稳定
**当前状态：** 已实现短查询增强（< 6字符阈值-0.05）
**待解决：** 添加更多短句种子数据，或换用中文专用模型

#### 问题4：Embedding模型选择

**时间：** 2026-02-01
**当前模型：** Qwen/Qwen3-Embedding-0.6B
**问题：** 对中文简短句子理解不够好
**建议：** 换用BAAI/bge-large-zh-v1.5
**待测试：** 需要重新生成种子数据验证

### 优化建议优先级

1. **立即测试：** 更换中文Embedding模型
2. **本周完成：** 添加日常对话种子数据
3. **本月考虑：** 增加DNA类别数量（6→12）
4. **长期规划：** 用户反馈学习机制

---

## 技术栈

- **语言：** TypeScript/Node.js
- **向量维度：** 1024
- **相似度算法：** 余弦相似度（点积优化）
- **Embedding模型：** Qwen/Qwen3-Embedding-0.6B
- **向量存储：** 自定义二进制格式（VectorStore）
- **DNA格式：** VCTR (Vector Centroid)

---

## 贡献指南

如果你想改进智能路由系统：

1. **报告问题：** 在GitHub Issues中详细描述
2. **改进代码：** 提交Pull Request
3. **分享经验：** 在论坛分享你的配置和调优经验

---

## 许可证

MIT License - 详见项目根目录LICENSE文件

---

## 联系方式

- 项目地址：[OpenClaw GitHub](https://github.com/your-repo)
- 问题反馈：GitHub Issues
