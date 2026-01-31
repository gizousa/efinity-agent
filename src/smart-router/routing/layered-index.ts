/**
 * 分层索引模块（软分区）
 *
 * 核心功能：
 * - L0: 粗粒度分区（6个DNA分区）
 * - L1: 补丁索引（线性搜索，极快）
 * - 软分区：边界案例双重检测
 *
 * 设计原理：
 * - 如果两个DNA分区得分接近（< 0.1），同时搜索两个分区
 * - 避免边界案例错误分类
 */

import type { DNAIntent, Patch, PatchSearchResult } from '../types/smart-router.types.js'
import { dotProduct, findTopKSimilar } from './similarity.js'

/**
 * 软分区配置
 */
export interface LayeredIndexConfig {
  /** 软分区边界阈值 */
  softPartitionThreshold: number
  /** 补丁搜索返回数量 */
  patchSearchTopK: number
  /** 补丁相似度阈值 */
  patchSimilarityThreshold: number
  /** DNA相似度阈值 */
  dnaSimilarityThreshold: number
}

/**
 * 分层索引类
 */
export class LayeredIndex {
  private dnaIntents: DNAIntent[] = []
  private patches: Patch[] = []
  private config: LayeredIndexConfig
  // 查询缓存（用向量哈希作为key）
  private queryCache = new Map<string, { result: PatchSearchResult; timestamp: number }>()
  private cacheHits = 0
  private cacheMisses = 0
  private readonly CACHE_TTL = 60000  // 60秒缓存过期时间
  private readonly MAX_CACHE_SIZE = 1000  // 最大缓存条目
  // 相似度历史记录（用于动态阈值）
  private similarityHistory: number[] = []
  private readonly MAX_HISTORY_SIZE = 1000  // 最多记录1000个相似度

  constructor(config: LayeredIndexConfig) {
    this.config = config
  }

  /**
   * 加载DNA意图
   */
  loadDNA(intents: DNAIntent[]): void {
    this.dnaIntents = intents
    console.log(`[LayeredIndex] Loaded ${intents.length} DNA intents`)
  }

  /**
   * 加载补丁
   */
  loadPatches(patches: Patch[]): void {
    this.patches = patches
  }

  /**
   * 搜索（主入口）- 带缓存
   */
  search(queryVector: Float32Array, queryText?: string): PatchSearchResult {
    // 生成缓存key（向量的简单哈希 + 文本长度，避免纯文本key）
    const cacheKey = this.vectorToHash(queryVector) + (queryText ? `_${queryText.length}` : '')

    // 检查缓存
    const cached = this.getFromCache(cacheKey)
    if (cached) {
      this.cacheHits++
      console.log(`[LayeredIndex] Cache hit! (Hits: ${this.cacheHits}, Misses: ${this.cacheMisses})`)
      return cached
    }

    this.cacheMisses++

    // 执行搜索（传递查询文本用于短查询增强）
    const result = this.searchInternal(queryVector, queryText)

    // 存入缓存
    this.setToCache(cacheKey, result)

    return result
  }

  /**
   * 内部搜索实现（无缓存）
   */
  private searchInternal(queryVector: Float32Array, queryText?: string): PatchSearchResult {
    // 1. 搜索补丁（优先级最高）
    const patchResult = this.searchPatches(queryVector)

    // 2. 搜索DNA（软分区）- 传入查询文本用于短查询增强
    const dnaResult = this.searchDNA(queryVector, queryText)

    // 记录相似度到历史（用于动态阈值分析）
    if (patchResult.found) {
      this.recordSimilarity(patchResult.score, 'patch')
    }
    if (dnaResult.found) {
      this.recordSimilarity(dnaResult.score, 'dna')
    }

    // 使用动态阈值（可选）
    const dynamicThreshold = this.calculateDynamicThreshold()

    // 短查询增强：对短查询降低DNA阈值要求
    const isShortQuery = queryText ? queryText.trim().length < 6 : false
    const shortQueryBonus = isShortQuery ? 0.05 : 0  // 短查询阈值降低0.05

    // 判断是否匹配
    if (patchResult.found && patchResult.score >= Math.max(this.config.patchSimilarityThreshold, dynamicThreshold.patch)) {
      return patchResult
    }

    const dnaThreshold = Math.max(
      this.config.dnaSimilarityThreshold - shortQueryBonus,
      dynamicThreshold.dna
    )

    if (dnaResult.found && dnaResult.score >= dnaThreshold) {
      // 如果是短查询且匹配成功，记录日志
      if (isShortQuery && dnaResult.score >= this.config.dnaSimilarityThreshold) {
        console.log(`[LayeredIndex] Short query bonus applied: "${queryText}" (+0.05 threshold)`)
      }
      return dnaResult
    }

    // 3. 都没命中，返回最佳结果
    if (patchResult.found) {
      return patchResult
    }
    if (dnaResult.found) {
      return dnaResult
    }

    // 4. 完全没有匹配，返回默认
    return {
      found: false,
      from: 'default',
      score: 0,
      tier: 'lightweight'
    }
  }

  /**
   * 记录相似度到历史
   */
  private recordSimilarity(score: number, source: 'patch' | 'dna'): void {
    this.similarityHistory.push(score)

    // 限制历史大小
    if (this.similarityHistory.length > this.MAX_HISTORY_SIZE) {
      this.similarityHistory.shift()
    }
  }

  /**
   * 计算动态阈值（基于历史相似度分布）
   */
  private calculateDynamicThreshold(): { patch: number; dna: number } {
    if (this.similarityHistory.length < 10) {
      // 数据不足，返回配置的阈值
      return {
        patch: this.config.patchSimilarityThreshold,
        dna: this.config.dnaSimilarityThreshold
      }
    }

    // 计算统计信息
    const mean = this.similarityHistory.reduce((a, b) => a + b, 0) / this.similarityHistory.length
    const variance = this.similarityHistory.reduce((sum, s) => sum + (s - mean) ** 2, 0) / this.similarityHistory.length
    const std = Math.sqrt(variance)

    // 动态阈值 = 均值 - 0.5 * 标准差
    // 这样可以自适应地调整阈值
    const dynamicThreshold = mean - 0.5 * std

    // 分别计算patch和dna的阈值（这里简化处理，都用同一个）
    return {
      patch: Math.max(0.5, Math.min(0.95, dynamicThreshold)),  // 限制在合理范围
      dna: Math.max(0.3, Math.min(0.9, dynamicThreshold))
    }
  }

  /**
   * 获取相似度分布统计
   */
  getSimilarityStats(): {
    count: number
    mean: number
    std: number
    min: number
    max: number
    median: number
  } {
    if (this.similarityHistory.length === 0) {
      return { count: 0, mean: 0, std: 0, min: 0, max: 0, median: 0 }
    }

    const sorted = [...this.similarityHistory].sort((a, b) => a - b)
    const mean = this.similarityHistory.reduce((a, b) => a + b, 0) / this.similarityHistory.length
    const variance = this.similarityHistory.reduce((sum, s) => sum + (s - mean) ** 2, 0) / this.similarityHistory.length
    const std = Math.sqrt(variance)

    return {
      count: this.similarityHistory.length,
      mean,
      std,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      median: sorted[Math.floor(sorted.length / 2)]
    }
  }

  /**
   * 向量转哈希（用于缓存key）
   */
  private vectorToHash(vec: Float32Array): string {
    // 使用前8个维度生成简单哈希
    const sample = Math.min(vec.length, 8)
    let hash = 0
    for (let i = 0; i < sample; i++) {
      // 将浮点数转换为整数哈希
      const bits = new Float32Array([vec[i]])
      const view = new Uint32Array(bits.buffer)
      hash ^= view[0]
      hash = Math.imul(hash, 31)
    }
    return hash.toString(36)
  }

  /**
   * 从缓存获取
   */
  private getFromCache(key: string): PatchSearchResult | null {
    const entry = this.queryCache.get(key)
    if (!entry) return null

    // 检查是否过期
    if (Date.now() - entry.timestamp > this.CACHE_TTL) {
      this.queryCache.delete(key)
      return null
    }

    return entry.result
  }

  /**
   * 存入缓存
   */
  private setToCache(key: string, result: PatchSearchResult): void {
    // LRU淘汰：如果缓存满了，删除最旧的
    if (this.queryCache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.queryCache.keys().next().value
      if (firstKey) {
        this.queryCache.delete(firstKey)
      }
    }

    this.queryCache.set(key, {
      result,
      timestamp: Date.now()
    })
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.queryCache.clear()
    this.cacheHits = 0
    this.cacheMisses = 0
    console.log('[LayeredIndex] Cache cleared')
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): { hits: number; misses: number; size: number; hitRate: number } {
    const total = this.cacheHits + this.cacheMisses
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      size: this.queryCache.size,
      hitRate: total > 0 ? this.cacheHits / total : 0
    }
  }

  /**
   * 搜索补丁（带软分区双重检测）
   */
  private searchPatches(queryVector: Float32Array): PatchSearchResult {
    if (this.patches.length === 0) {
      return {
        found: false,
        from: 'patch-single',
        score: 0,
        tier: 'lightweight'
      }
    }

    // 1. 计算与所有DNA的相似度，确定最匹配的分区
    const dnaScores = this.dnaIntents.map(intent => ({
      id: intent.id,
      score: dotProduct(queryVector, intent.centroid),
      preferredTier: intent.preferredTier
    }))

    dnaScores.sort((a, b) => b.score - a.score)

    const bestDNA = dnaScores[0]
    const secondDNA = dnaScores[1]

    // 2. 判断是否需要双重检测（边界案例）
    const needsDualSearch = secondDNA && (bestDNA.score - secondDNA.score) < this.config.softPartitionThreshold

    if (needsDualSearch) {
      // 双重检测：同时搜索两个分区的补丁
      const tier1 = bestDNA.preferredTier
      const tier2 = secondDNA.preferredTier

      const patches1 = this.patches.filter(p => p.tier === tier1)
      const patches2 = this.patches.filter(p => p.tier === tier2)

      const vectors1 = patches1.map(p => p.vector)
      const vectors2 = patches2.map(p => p.vector)

      const results1 = findTopKSimilar(queryVector, vectors1, this.config.patchSearchTopK)
      const results2 = findTopKSimilar(queryVector, vectors2, this.config.patchSearchTopK)

      // 合并结果
      const allResults = [
        ...results1.map(r => ({ ...r, patch: patches1[r.index] })),
        ...results2.map(r => ({ ...r, patch: patches2[r.index] }))
      ]

      allResults.sort((a, b) => b.score - a.score)

      const best = allResults[0]
      if (best && best.score > 0) {
        return {
          found: true,
          from: 'patch-dual',
          patch: best.patch,
          score: best.score,
          tier: best.patch.tier
        }
      }
    } else {
      // 单分区搜索：只搜索最佳匹配的分区的补丁
      const tier = bestDNA.preferredTier
      const tierPatches = this.patches.filter(p => p.tier === tier)
      const vectors = tierPatches.map(p => p.vector)

      const results = findTopKSimilar(queryVector, vectors, this.config.patchSearchTopK)

      if (results.length > 0 && results[0].score > 0) {
        const best = results[0]
        return {
          found: true,
          from: 'patch-single',
          patch: tierPatches[best.index],
          score: best.score,
          tier: tierPatches[best.index].tier
        }
      }
    }

    return {
      found: false,
      from: 'patch-single',
      score: 0,
      tier: 'lightweight'
    }
  }

  /**
   * 搜索DNA（静态特征）- 带动态置信度检查
   *
   * @param queryVector - 查询向量
   * @param queryText - 查询文本（可选，用于短查询检测）
   */
  private searchDNA(queryVector: Float32Array, queryText?: string): PatchSearchResult {
    if (this.dnaIntents.length === 0) {
      return {
        found: false,
        from: 'dna',
        score: 0,
        tier: 'lightweight'
      }
    }

    // 计算与所有DNA的相似度
    const scores = this.dnaIntents.map(intent => ({
      intent,
      score: dotProduct(queryVector, intent.centroid)
    }))

    // 按相似度降序排序
    scores.sort((a, b) => b.score - a.score)

    const best = scores[0]
    const second = scores[1]

    // 计算置信度（最佳与第二佳的差距）
    const confidence = second ? (best.score - second.score) : best.score

    // 监控日志：记录Top-3得分和置信度
    if (this.dnaIntents.length >= 2) {
      console.log(`[LayeredIndex] DNA Top-3: ${scores.slice(0, 3).map(s =>
        `${s.intent.id}(${s.score.toFixed(3)})`
      ).join(', ')} | Confidence: ${confidence.toFixed(3)}`)
    }

    // 动态置信度惩罚：惩罚系数与置信度成反比
    // 置信度越高 → 惩罚越小 → 有效得分越接近原得分
    // 置信度越低 → 惩罚越大 → 有效得分越低
    const penaltyFactor = this.calculateConfidencePenalty(confidence)
    const effectiveScore = best.score * penaltyFactor

    // 如果有显著惩罚，记录日志
    if (penaltyFactor < 0.98) {
      console.log(`[LayeredIndex] Confidence penalty applied: ${(penaltyFactor * 100).toFixed(1)}% (confidence: ${confidence.toFixed(3)})`)
    }

    if (best && best.score > 0) {
      return {
        found: true,
        from: 'dna',
        intent: best.intent,
        score: effectiveScore,
        tier: best.intent.preferredTier
      }
    }

    return {
      found: false,
      from: 'dna',
      score: 0,
      tier: 'lightweight'
    }
  }

  /**
   * 计算置信度惩罚因子
   *
   * 惩罚曲线：
   * - confidence >= 0.15 → 无惩罚 (factor = 1.0)
   * - confidence = 0.10 → 轻微惩罚 (factor = 0.98)
   * - confidence = 0.05 → 中度惩罚 (factor = 0.95)
   * - confidence = 0.00 → 重度惩罚 (factor = 0.90)
   *
   * @param confidence - 置信度（最佳与第二佳的差距）
   * @returns 惩罚因子 [0.90, 1.0]
   */
  private calculateConfidencePenalty(confidence: number): number {
    // 无置信度时使用默认惩罚
    if (confidence <= 0) return 0.90

    // 高置信度：无惩罚
    if (confidence >= 0.15) return 1.0

    // 中等置信度：线性插值
    // confidence ∈ [0.05, 0.15] → factor ∈ [0.95, 1.0]
    if (confidence >= 0.05) {
      return 0.95 + (confidence - 0.05) * 0.5  // 0.95到1.0线性映射
    }

    // 低置信度：重度惩罚
    // confidence ∈ [0.00, 0.05] → factor ∈ [0.90, 0.95]
    return 0.90 + confidence * 1.0  // 0.90到0.95线性映射
  }

  /**
   * 获取补丁数量
   */
  getPatchCount(): number {
    return this.patches.length
  }

  /**
   * 获取DNA数量
   */
  getDNACount(): number {
    return this.dnaIntents.length
  }
}

/**
 * 创建分层索引实例
 */
export function createLayeredIndex(config: Partial<LayeredIndexConfig> = {}): LayeredIndex {
  const fullConfig: LayeredIndexConfig = {
    softPartitionThreshold: config.softPartitionThreshold || 0.1,
    patchSearchTopK: config.patchSearchTopK || 5,
    patchSimilarityThreshold: config.patchSimilarityThreshold || 0.92,
    dnaSimilarityThreshold: config.dnaSimilarityThreshold || 0.85
  }

  return new LayeredIndex(fullConfig)
}
