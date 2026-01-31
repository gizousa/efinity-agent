/**
 * 智能压缩模块
 *
 * 核心功能：
 * - DBSCAN聚类（密度-based）
 * - 加权质心合并（Float64精度）
 * - 时间衰减权重计算
 * - 死亡阈值 + 最小保留数
 *
 * 设计原理：
 * - 将相似补丁合并为一个"质心补丁"
 * - 使用Float64计算避免累积误差
 * - 每个分区至少保留3个补丁，防止记忆真空
 */

import type { Patch, CompactionResult, TimeDecayConfig } from '../types/smart-router.types.js'

/**
 * DBSCAN配置
 */
export interface DBSCANConfig {
  /** 邻域半径（余弦相似度） */
  eps: number
  /** 最小点数 */
  minPts: number
}

/**
 * 智能压缩类
 */
export class Compactor {
  private timeDecayConfig: TimeDecayConfig
  private dbscanConfig: DBSCANConfig

  constructor(timeDecayConfig: TimeDecayConfig, dbscanConfig?: Partial<DBSCANConfig>) {
    this.timeDecayConfig = timeDecayConfig
    this.dbscanConfig = {
      eps: dbscanConfig?.eps || 0.1,  // 余弦相似度阈值
      minPts: dbscanConfig?.minPts || 2  // 最少2个点形成聚类
    }
  }

  /**
   * 压缩补丁列表
   */
  async compact(patches: Patch[]): Promise<CompactionResult> {
    const startTime = Date.now()
    const beforeCount = patches.length

    console.log(`[Compactor] Starting compaction with ${beforeCount} patches...`)

    // 1. 按层级分组
    const flagshipPatches = patches.filter(p => p.tier === 'flagship')
    const lightweightPatches = patches.filter(p => p.tier === 'lightweight')

    // 2. 分别压缩每个层级
    const compressedFlagship = await this.compactByTier(flagshipPatches)
    const compressedLightweight = await this.compactByTier(lightweightPatches)

    // 3. 合并结果
    const compressedPatches = [...compressedFlagship, ...compressedLightweight]

    // 4. 保存到磁盘
    const endTime = Date.now()
    const durationMs = endTime - startTime
    const afterCount = compressedPatches.length
    const deletedCount = beforeCount - afterCount

    // TODO: 计算合并数量（需要追踪原始补丁ID）
    const mergedCount = 0

    const result: CompactionResult = {
      beforeCount,
      afterCount,
      deletedCount,
      mergedCount,
      durationMs
    }

    console.log(`[Compactor] Compaction complete: ${beforeCount} -> ${afterCount} (${durationMs}ms)`)

    return result
  }

  /**
   * 按层级压缩补丁
   */
  private async compactByTier(patches: Patch[]): Promise<Patch[]> {
    if (patches.length === 0) {
      return []
    }

    const currentTime = Date.now()

    // 1. 过滤权重过低的补丁，但保留最小数量
    const alivePatches = this.filterWithMinRetention(patches, currentTime)

    // 2. DBSCAN聚类
    const clusters = this.dbscan(alivePatches)

    // 3. 合并每个聚类为一个质心补丁
    const mergedPatches: Patch[] = []

    for (const cluster of clusters) {
      if (cluster.length === 1) {
        // 单点聚类，直接保留
        mergedPatches.push(cluster[0])
      } else {
        // 多点聚类，合并为质心
        const centroid = this.computeWeightedCentroid(cluster, currentTime)
        mergedPatches.push(centroid)
      }
    }

    return mergedPatches
  }

  /**
   * 过滤补丁（应用最小保留数）
   */
  private filterWithMinRetention(patches: Patch[], currentTime: number): Patch[] {
    // 计算衰减权重并排序
    const withWeights = patches.map(p => ({
      patch: p,
      weight: this.calculateDecayedWeight(p, currentTime)
    }))

    // 按权重降序排序
    withWeights.sort((a, b) => b.weight - a.weight)

    // 保留权重 >= 死亡阈值的
    const valid = withWeights
      .filter(w => w.weight >= this.timeDecayConfig.deathThreshold)
      .map(w => w.patch)

    // 如果数量不足，强制保留前 minRetention 个
    if (valid.length < this.timeDecayConfig.minRetention) {
      return withWeights
        .slice(0, this.timeDecayConfig.minRetention)
        .map(w => w.patch)
    }

    return valid
  }

  /**
   * DBSCAN聚类算法
   *
   * 返回聚类列表，每个聚类是一个补丁数组
   */
  private dbscan(patches: Patch[]): Patch[][] {
    const clusters: Patch[][] = []
    const visited = new Set<number>()
    const noise: Patch[] = []

    for (let i = 0; i < patches.length; i++) {
      if (visited.has(i)) {
        continue
      }

      const neighbors = this.regionQuery(patches, i)

      if (neighbors.length < this.dbscanConfig.minPts) {
        // 噪声点
        noise.push(patches[i])
        visited.add(i)
      } else {
        // 创建新聚类
        const cluster: Patch[] = []
        this.expandCluster(patches, i, neighbors, cluster, visited)
        clusters.push(cluster)
      }
    }

    // 噪声点各自成一个聚类
    for (const patch of noise) {
      clusters.push([patch])
    }

    return clusters
  }

  /**
   * 区域查询（找邻居）
   */
  private regionQuery(patches: Patch[], index: number): number[] {
    const neighbors: number[] = []
    const patch = patches[index]

    for (let i = 0; i < patches.length; i++) {
      if (i === index) {
        continue
      }

      const similarity = this.cosineSimilarity(patch.vector, patches[i].vector)

      if (similarity >= this.dbscanConfig.eps) {
        neighbors.push(i)
      }
    }

    return neighbors
  }

  /**
   * 扩展聚类
   */
  private expandCluster(
    patches: Patch[],
    index: number,
    neighbors: number[],
    cluster: Patch[],
    visited: Set<number>
  ): void {
    cluster.push(patches[index])
    visited.add(index)

    let i = 0
    while (i < neighbors.length) {
      const neighborIndex = neighbors[i]

      if (!visited.has(neighborIndex)) {
        visited.add(neighborIndex)
        cluster.push(patches[neighborIndex])

        const newNeighbors = this.regionQuery(patches, neighborIndex)
        if (newNeighbors.length >= this.dbscanConfig.minPts) {
          neighbors.push(...newNeighbors)
        }
      }

      i++
    }
  }

  /**
   * 计算加权质心（Float64精度）
   */
  private computeWeightedCentroid(patches: Patch[], currentTime: number): Patch {
    const vectorDim = patches[0].vector.length

    // 使用Float64计算，避免累积误差
    const weightedSum = new Float64Array(vectorDim)
    let totalWeight = 0

    for (const patch of patches) {
      const weight = this.calculateDecayedWeight(patch, currentTime)

      for (let i = 0; i < vectorDim; i++) {
        weightedSum[i] += patch.vector[i] * weight
      }

      totalWeight += weight
    }

    // 计算质心（Float64）
    const centroid64 = new Float64Array(vectorDim)
    if (totalWeight > 0) {
      for (let i = 0; i < vectorDim; i++) {
        centroid64[i] = weightedSum[i] / totalWeight
      }
    }

    // 转回Float32存储
    const centroid32 = new Float32Array(vectorDim)
    for (let i = 0; i < vectorDim; i++) {
      centroid32[i] = centroid64[i]
    }

    // 选择最常见的标签
    const labelCounts = new Map<string, number>()
    for (const patch of patches) {
      const count = labelCounts.get(patch.label) || 0
      labelCounts.set(patch.label, count + 1)
    }
    const mostCommonLabel = [...labelCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]

    // 使用最新时间戳
    const latestTimestamp = Math.max(...patches.map(p => p.timestamp))

    return {
      vector: centroid32,
      tier: patches[0].tier,
      label: mostCommonLabel,
      timestamp: latestTimestamp,
      initialWeight: totalWeight
    }
  }

  /**
   * 计算衰减权重
   *
   * 公式：w_t = w_0 * γ^(t / T_half)
   */
  calculateDecayedWeight(patch: Patch, currentTime: number): number {
    const timeDiff = currentTime - patch.timestamp
    const daysDiff = timeDiff / (24 * 60 * 60 * 1000)

    const weight = (patch.initialWeight || 1.0) *
      Math.pow(this.timeDecayConfig.gamma, daysDiff / this.timeDecayConfig.halfLifeDays)

    return weight
  }

  /**
   * 余弦相似度（向量已单位化）
   */
  private cosineSimilarity(vecA: Float32Array, vecB: Float32Array): number {
    let dot = 0
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i]
    }
    return dot
  }
}

/**
 * 创建压缩器实例
 */
export function createCompactor(
  timeDecayConfig?: Partial<TimeDecayConfig>,
  dbscanConfig?: Partial<DBSCANConfig>
): Compactor {
  const fullTimeDecayConfig: TimeDecayConfig = {
    gamma: timeDecayConfig?.gamma || 0.95,
    halfLifeDays: timeDecayConfig?.halfLifeDays || 30,
    deathThreshold: timeDecayConfig?.deathThreshold || 0.1,
    minRetention: timeDecayConfig?.minRetention || 3
  }

  return new Compactor(fullTimeDecayConfig, dbscanConfig)
}
