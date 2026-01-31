# Smart Router 审查文档

## 📋 目录
1. [原始需求与目的](#原始需求与目的)
2. [当前问题列表](#当前问题列表)
3. [系统架构](#系统架构)
4. [核心算法代码](#核心算法代码)
5. [数据分析](#数据分析)
6. [改进方向](#改进方向)

---

## 原始需求与目的

### 🎯 核心需求
**智能路由系统**：根据用户查询的复杂度和语义类型，自动选择最合适的AI模型，实现：
- **成本优化**：简单任务用轻量模型（便宜）
- **质量保证**：复杂任务用旗舰模型（强大）
- **个性化学习**：根据用户历史使用习惯优化路由决策

### 📊 业务目标
1. **降低成本**：60-80%的查询用轻量模型处理
2. **保持质量**：旗舰模型处理复杂任务，确保用户体验
3. **自适应优化**：系统根据用户反馈持续学习改进

### 🔧 技术方案
- **向量化**：将查询和意图转化为1024维向量
- **语义匹配**：通过余弦相似度判断查询类型
- **分层索引**：DNA（静态分类） + Patch（用户学习）
- **软分区**：边界案例双重检测，避免误判

---

## 当前问题列表

### 🔴 严重问题

#### 问题1：相似度得分普遍偏低（0.50-0.65）
**现象：**
```
"写个正则提取代码"   → 0.576 (预期应该是CODE，应该>0.70)
"今天天气太差了"     → 0.609 (预期应该是CHAT，应该>0.70)
"我心情不好写首诗"    → 0.526 (预期应该是WRITE，应该>0.70)
"If I have baskets"  → 0.546 (预期应该是REASON，应该>0.70)
```

**影响：**
- 大部分查询无法超过阈值，导致fallback到unknown
- 路由决策不准确，简单查询也用旗舰模型

**可能原因：**
1. **Embedding模型语义理解不足**
   - Qwen3-Embedding-0.6B是通用模型
   - 对中文简短句子编码质量不佳
   - 对代码、诗歌等专业领域语义理解不够

2. **Centroid计算方式问题**
   - 当前：简单平均所有同类别种子的向量
   - 问题：没有考虑类别内的分布差异
   - 影响：centroid可能偏离真实语义中心

3. **种子数据与实际查询不匹配**
   - 种子数据："制定一个为期六个月的零基础转行前端开发者的学习路径"
   - 实际查询："写个正则提取代码"
   - 风格差异巨大！

#### 问题2：置信度普遍很低（0.006-0.086）
**现象：**
```
"写个正则提取代码"   → Confidence: 0.019 (0.576 - 0.557)
"今天天气太差了"     → Confidence: 0.032 (0.609 - 0.577)
"我心情不好写首诗"    → Confidence: 0.006 (0.526 - 0.520)
```

**影响：**
- 最佳和第二佳得分差距太小，说明DNA类别区分度不够
- 低置信度时降低得分，进一步降低匹配率

**根本原因：**
- **6个DNA类别可能有重叠**：CHAT和WRITE边界模糊
- **Centroid太接近**：不同类别的中心向量在语义空间中距离太近

#### 问题3：简短查询匹配更差
**现象对比：**
```
长查询："制定一个为期六个月的零基础转行前端开发者的学习路径" → 匹配好
短查询："写个正则"                                                 → 匹配差
```

**原因：**
- 短查询语义信息少，向量表示不稳定
- Embedding模型对长文本处理更好

---

### 🟡 中等问题

#### 问题4：阈值调整困难
**困境：**
- 0.70：太严格，大部分查询不匹配
- 0.60：仍有40%查询不匹配
- 0.50：误匹配风险增加

#### 问题5：软分区触发频率低
**设计目标：**
```
softPartitionThreshold: 0.1
当 (bestScore - secondScore) < 0.1 时，双重检测
```

**实际情况：**
- 置信度大部分 < 0.1，应该触发双重检测
- 但日志中很少看到 `patch-dual` 的from标签

#### 问题6：缓存命中率低
```
Cache hit! (Hits: 4, Misses: 4) → 50%命中率
```

- 用户查询多样化，重复率低
- 缓存向量哈希可能冲突（只采样前8维）

---

## 系统架构

### 📐 整体流程
```
用户查询
  ↓
Embedding API (Qwen3-0.6B) → 1024维向量
  ↓
LayeredIndex.search()
  ↓
┌─────────────────────────────────┐
│ 1. 搜索用户Patches (优先级最高)   │
│    - 软分区：确定tier            │
│    - 搜索对应tier的patches       │
│    - 阈值：0.85                  │
└─────────────────────────────────┘
  ↓ 未命中
┌─────────────────────────────────┐
│ 2. 搜索DNA Intents               │
│    - 计算6个DNA的相似度          │
│    - Top-K置信度检查             │
│    - 阈值：0.60                  │
└─────────────────────────────────┘
  ↓ 未命中
┌─────────────────────────────────┐
│ 3. 返回最佳fallback              │
│    - 优先Patch                  │
│    - 其次DNA                    │
│    - 最后默认lightweight         │
└─────────────────────────────────┘
```

### 🗂️ 数据结构

#### DNA Intent
```typescript
interface DNAIntent {
  id: string          // 'chat', 'code', 'fact', 'reason', 'trans', 'write'
  centroid: Float32Array  // 1024维向量（类别中心）
  preferredTier: 'flagship' | 'lightweight'
  description: string
  keywords: string[]
}
```

#### Patch
```typescript
interface Patch {
  vector: Float32Array        // 1024维向量
  tier: 'flagship' | 'lightweight'
  label: string               // 原始文本
  timestamp: number           // Unix时间戳
  initialWeight: number       // 初始权重1.0
}
```

---

## 核心算法代码

### 1️⃣ 相似度计算 (similarity.ts)

#### 余弦相似度（通过点积优化）
```typescript
// 向量已预单位化，余弦相似度 = 点积
export function dotProduct(vecA: Float32Array, vecB: Float32Array): number {
  let dot = 0
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i]
  }
  return dot  // 范围：[-1, 1]，1表示完全相同
}
```

**性能优化：**
- 向量预单位化：一次normalize，后续直接点积
- 避免重复计算模长：10x性能提升

**数学原理：**
```
余弦相似度 = (A·B) / (|A| * |B|)
如果 |A| = |B| = 1（单位向量）
则 余弦相似度 = A·B（点积）
```

#### Top-K搜索
```typescript
export function findTopKSimilar(
  query: Float32Array,
  candidates: Float32Array[],
  k: number
): Array<{ vector: Float32Array; index: number; score: number }> {
  const results: Array<{ vector: Float32Array; index: number; score: number }> = []

  for (let i = 0; i < candidates.length; i++) {
    const score = dotProduct(query, candidates[i])
    results.push({ vector: candidates[i], index: i, score })
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, k)
}
```

**复杂度：** O(n * d + n log n)
- n: 候选向量数量
- d: 向量维度（1024）
- 排序：n log n

---

### 2️⃣ 分层搜索 (layered-index.ts)

#### 主搜索流程
```typescript
search(queryVector: Float32Array): PatchSearchResult {
  // 1. 检查缓存
  const cached = this.getFromCache(cacheKey)
  if (cached) return cached

  // 2. 执行内部搜索
  const result = this.searchInternal(queryVector)

  // 3. 存入缓存
  this.setToCache(cacheKey, result)

  return result
}
```

#### DNA搜索（带置信度）
```typescript
private searchDNA(queryVector: Float32Array): PatchSearchResult {
  // 1. 计算与所有DNA的相似度
  const scores = this.dnaIntents.map(intent => ({
    intent,
    score: dotProduct(queryVector, intent.centroid)
  }))

  // 2. 按相似度降序排序
  scores.sort((a, b) => b.score - a.score)

  const best = scores[0]
  const second = scores[1]

  // 3. 计算置信度（最佳 - 第二佳）
  const confidence = second ? (best.score - second.score) : best.score

  // 4. 监控日志
  console.log(`[LayeredIndex] DNA Top-3: ... | Confidence: ${confidence.toFixed(3)}`)

  // 5. 置信度惩罚
  const minConfidence = 0.05
  const effectiveScore = confidence < minConfidence
    ? best.score * 0.9  // 低置信度降低10%
    : best.score

  return { found: true, from: 'dna', intent: best.intent, score: effectiveScore }
}
```

**置信度检查逻辑：**
```
置信度 < 0.05 → 降低得分10%（惩罚不确定的匹配）
置信度 >= 0.05 → 保持原得分
```

#### Patch搜索（软分区）
```typescript
private searchPatches(queryVector: Float32Array): PatchSearchResult {
  // 1. 计算与所有DNA的相似度，确定分区
  const dnaScores = this.dnaIntents.map(intent => ({
    id: intent.id,
    score: dotProduct(queryVector, intent.centroid),
    preferredTier: intent.preferredTier
  }))

  dnaScores.sort((a, b) => b.score - a.score)

  const bestDNA = dnaScores[0]
  const secondDNA = dnaScores[1]

  // 2. 判断是否需要软分区双重检测
  const needsDualSearch = secondDNA &&
    (bestDNA.score - secondDNA.score) < this.config.softPartitionThreshold

  if (needsDualSearch) {
    // 3a. 双重检测：同时搜索两个分区的patches
    const patches1 = this.patches.filter(p => p.tier === bestDNA.preferredTier)
    const patches2 = this.patches.filter(p => p.tier === secondDNA.preferredTier)

    const results1 = findTopKSimilar(queryVector, patches1.map(p => p.vector), 5)
    const results2 = findTopKSimilar(queryVector, patches2.map(p => p.vector), 5)

    // 合并排序
    const allResults = [...results1, ...results2].sort((a, b) => b.score - a.score)

    return { found: true, from: 'patch-dual', ...allResults[0] }
  } else {
    // 3b. 单分区搜索
    const tierPatches = this.patches.filter(p => p.tier === bestDNA.preferredTier)
    const results = findTopKSimilar(queryVector, tierPatches.map(p => p.vector), 5)

    return { found: true, from: 'patch-single', ...results[0] }
  }
}
```

**软分区逻辑：**
```
bestScore - secondScore < 0.1 → 双重检测（边界案例）
bestScore - secondScore >= 0.1 → 单分区检测
```

---

### 3️⃣ Centroid计算 (generate-dna-seeds.ts)

#### 当前算法：简单平均
```typescript
// 1. 累加同类别的所有向量
for (const item of batch) {
  const vec = vectors[idx]
  const acc = centroids.get(item.label)

  for (let d = 0; d < VECTOR_DIM; d++) {
    acc.sum[d] += vec[d]
  }
  acc.count++
}

// 2. 计算平均值
for (const [label, acc] of centroids) {
  const avg = new Float32Array(VECTOR_DIM)
  for (let i = 0; i < VECTOR_DIM; i++) {
    avg[i] = acc.sum[i] / acc.count
  }
  normalize(avg)  // L2单位化
  result.set(label, avg)
}
```

**公式：**
```
centroid[label] = normalize(
  (vector₁ + vector₂ + ... + vectorₙ) / n
)
```

**问题：**
- 简单平均对离群值敏感
- 没有考虑类别内的分布形状
- 不同cluster可能有不同的方差

---

### 4️⃣ 动态阈值计算

#### 基于统计的自适应阈值
```typescript
private calculateDynamicThreshold(): { patch: number; dna: number } {
  if (this.similarityHistory.length < 10) {
    return {
      patch: this.config.patchSimilarityThreshold,
      dna: this.config.dnaSimilarityThreshold
    }
  }

  // 计算统计量
  const mean = this.similarityHistory.reduce((a, b) => a + b, 0) / this.similarityHistory.length
  const variance = this.similarityHistory.reduce((sum, s) => sum + (s - mean) ** 2, 0) / this.similarityHistory.length
  const std = Math.sqrt(variance)

  // 动态阈值 = 均值 - 0.5 * 标准差
  const dynamicThreshold = mean - 0.5 * std

  return {
    patch: Math.max(0.5, Math.min(0.95, dynamicThreshold)),
    dna: Math.max(0.3, Math.min(0.9, dynamicThreshold))
  }
}
```

**公式：**
```
threshold = μ - 0.5σ
μ: 历史相似度均值
σ: 标准差
```

**当前状态：**
- ✅ 代码已实现
- ⚠️ 但实际效果未知（需要收集足够历史数据）

---

## 数据分析

### 📊 种子数据统计
```
总数据量: 873条
分布:
  CHAT:   138条 (15.8%)
  CODE:   137条 (15.7%)
  FACT:   138条 (15.8%)
  REASON: 137条 (15.7%)
  TRANS:  187条 (21.4%)
  WRITE:  137条 (15.7%)

平衡性: ✅ 良好（最大差异 < 6%）
```

### 📈 实际查询相似度分布
```
查询样本 (最近5条):
  "写个正则提取代码"   → 0.576 (CODE类别)
  "今天天气太差了"     → 0.609 (CHAT类别)
  "If I have baskets"  → 0.546 (REASON类别)
  "我心情不好写首诗"    → 0.526 (WRITE类别)
  "你吃饭了吗"         → 0.589 (CHAT类别)

统计:
  均值: 0.569
  范围: [0.526, 0.609]
  标准差: 0.030
  中位数: 0.576
```

**观察：**
- 所有查询都低于0.60阈值
- 得分集中在狭窄区间 [0.53, 0.61]
- 标准差很小，说明区分度不足

### 🔬 Centroid距离分析
```
理想情况: 不同DNA类别的centroid应该距离较远
实际情况: 大部分查询置信度 < 0.1

推论: DNA centroids在向量空间中可能太接近
```

---

## 改进方向

### 🎯 方案1：改进Centroid计算

#### 当前问题
- 简单平均对离群值敏感
- 没有考虑类别内部分布

#### 改进方案A：加权平均
```typescript
// 按时间衰减权重
const age = Date.now() - patch.timestamp
const weight = Math.exp(-age / DECAY_CONSTANT)  // 指数衰减
weightedSum += vec * weight
```

#### 改进方案B：聚类后取中心
```typescript
// 1. 对每个类别的种子进行K-means聚类
// 2. 取最大cluster的中心作为centroid
// 3. 优点: 更鲁棒，离群值影响小
```

#### 改进方案C：使用Medoid
```typescript
// Medoid = 到其他所有点距离最小的点
// 优点: 对离群值更鲁棒
// 缺点: 计算成本高 O(n²)

function findMedoid(vectors: Float32Array[]): Float32Array {
  let minDist = Infinity
  let medoid = vectors[0]

  for (const v1 of vectors) {
    let totalDist = 0
    for (const v2 of vectors) {
      totalDist += 1 - dotProduct(v1, v2)  // 距离 = 1 - 相似度
    }
    if (totalDist < minDist) {
      minDist = totalDist
      medoid = v1
    }
  }

  return medoid
}
```

---

### 🎯 方案2：改进相似度计算

#### 当前方法：余弦相似度
```typescript
similarity = dotProduct(query, centroid)
// 范围: [-1, 1]
```

#### 改进方案A：考虑得分的绝对值
```typescript
// 不只是方向，也考虑大小
similarity = dotProduct(query, centroid) * Math.abs(dotProduct(query, centroid))
// 惩罚负相似度
```

#### 改进方案B：使用欧氏距离
```typescript
// 对于单位向量: distance² = 2 * (1 - cosine_similarity)
// 可能对某些场景更敏感
distance = euclideanDistance(query, centroid)
similarity = 1 / (1 + distance)  // 转换到[0, 1]
```

#### 改进方案C：加权余弦相似度
```typescript
// 对重要维度加权
const importance = getDimensionImportance()  // 1024维的权重
similarity = weightedDotProduct(query, centroid, importance)
```

---

### 🎯 方案3：改进DNA分类

#### 当前问题
- 6个类别可能太粗粒度
- CHAT和WRITE边界模糊
- 某些查询可能同时属于多个类别

#### 改进方案A：增加类别数量
```typescript
// 从6个增加到12个
const DNA_CATEGORIES = [
  'chat-casual',    // 日常闲聊
  'chat-emotional', // 情感交流
  'code-snippet',   // 代码片段
  'code-debug',     // 代码调试
  'fact-simple',    // 简单事实
  'fact-complex',   // 复杂事实
  'reason-logic',   // 逻辑推理
  'reason-math',    // 数学计算
  'trans-translate',// 翻译
  'trans-summary',  // 摘要
  'write-creative', // 创意写作
  'write-formal'    // 正式写作
]
```

#### 改进方案B：层级分类
```typescript
// 第一层：粗分类
const LEVEL_1 = ['CHAT', 'CODE', 'FACT', 'REASON', 'TRANS', 'WRITE']

// 第二层：细分类（只对高分匹配的）
const LEVEL_2_CHAT = ['GREETING', 'EMOTION', 'CASUAL']
const LEVEL_2_CODE = ['SNIPPET', 'DEBUG', 'REVIEW']
// ...
```

#### 改进方案C：多标签分类
```typescript
// 允许一个查询匹配多个DNA
interface DNAMatch {
  intent: DNAIntent
  score: number
  weight: number  // 组合权重
}

// 最终决策 = 加权组合
finalScore = Σ(match.score * match.weight)
```

---

### 🎯 方案4：改进种子数据

#### 当前问题
- 种子数据太正式
- 与实际查询风格差异大

#### 改进方案：添加日常查询样本
```json
[
  {"text": "你吃饭了吗", "label": "CHAT"},
  {"text": "今天天气怎么样", "label": "CHAT"},
  {"text": "帮我写个函数", "label": "CODE"},
  {"text": "写个正则", "label": "CODE"},
  {"text": "1+1等于几", "label": "FACT"},
  {"text": "写首诗", "label": "WRITE"},
  {"text": "心情不好", "label": "CHAT"},
  {"text": "帮我看下代码", "label": "CODE"}
]
```

**策略：**
- 收集真实用户查询
- 定期重新生成centroid
- 持续优化数据质量

---

### 🎯 方案5：更换Embedding模型

#### 当前模型
```
Qwen/Qwen3-Embedding-0.6B
- 维度: 1024
- 类型: 通用多语言
- 性能: 中等
- 成本: 低/免费
```

#### 推荐模型

**选项A：中文专用模型**
```
BAAI/bge-large-zh-v1.5
- 维度: 1024
- 类型: 中文专用
- 性能: ⭐⭐⭐⭐⭐ (中文任务SOTA)
- 成本: 低
- 预期提升: +20-30%相似度
```

**选项B：多语言高精度**
```
BAAI/bge-m3
- 维度: 1024
- 类型: 多语言高精度
- 性能: ⭐⭐⭐⭐
- 成本: 中
- 特点: 支持100+语言
```

**选项C：OpenAI模型**
```
text-embedding-3-large
- 维度: 3072
- 类型: 通用高精度
- 性能: ⭐⭐⭐⭐⭐
- 成本: 高
- 缺点: 需要API key，有延迟
```

---

### 🎯 方案6：引入学习机制

#### 当前状态
- 静态DNA centroids
- 无用户反馈

#### 改进方案：在线学习
```typescript
// 1. 记录用户反馈
interface RouterFeedback {
  query: string
  predictedTier: 'flagship' | 'lightweight'
  userSatisfied: boolean  // 用户是否满意
  correctTier: 'flagship' | 'lightweight'  // 正确的tier（如果有）
}

// 2. 更新centroid
function updateCentroid(feedback: RouterFeedback[]) {
  // 如果用户不满意，调整centroid
  // 方向：让预测正确的查询得分更高
}

// 3. A/B测试
// 随机分组：新旧算法对比
// 收集指标：满意度、准确率、成本
```

---

## 总结

### 🔴 核心问题
1. **Embedding语义理解不足** → 相似度偏低
2. **Centroid计算过于简单** → 类别区分度不够
3. **种子数据不匹配** → 风格差异巨大

### ✅ 已实施的改进
1. Top-K置信度检查
2. 查询结果缓存
3. 动态阈值计算
4. 相似度分布监控

### 🎯 推荐优先级
1. **立即：** 更换 `bge-large-zh-v1.5` 模型
2. **本周：** 添加日常对话种子数据
3. **本月：** 改进centroid计算（使用Medoid）
4. **长期：** 引入用户反馈学习机制

---

## 📚 参考资料

- [BGE模型论文](https://arxiv.org/abs/2309.07597)
- [vLLM Semantic Router](https://vllm-semantic-router.com/docs/)
- [Amazon NNCR Paper](https://assets.amazon.science/e3/01/066f52474b5ca0dc010b62b3cbf0/nncr-revising-classifications-using-embedding-based-k-nearest-neighbor-search.pdf)
- [Milvus HNSW vs IVF](https://milvus.io/blog/understanding-ivf-vector-index-how-It-works-and-when-to-choose-it-over-hnsw.md)
