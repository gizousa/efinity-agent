/**
 * OpenClaw 智能路由系统 - 类型定义
 *
 * 核心思想：意图指纹 + 进化补丁
 * - 静态DNA：6个核心意图的重心向量
 * - 动态补丁：用户通过前缀指令产生的个性化数据
 */

/**
 * 路由决策结果
 */
export interface RoutingDecision {
  /** 模型层级 */
  modelTier: 'flagship' | 'lightweight'
  /** 选择的模型 */
  selectedModel: string
  /** 置信度 (0-1) */
  confidence: number
  /** 决策理由 */
  reasoning: string
}

/**
 * 用户补丁（学习数据）
 */
export interface Patch {
  /** 向量 (已预单位化) */
  vector: Float32Array
  /** 模型层级 */
  tier: 'flagship' | 'lightweight'
  /** 标签 (清理前缀后的查询) */
  label: string
  /** 创建时间 (Unix timestamp, 毫秒) */
  timestamp: number
  /** 初始权重 (用于时间衰减计算) */
  initialWeight?: number
}

/**
 * DNA意图（静态特征）
 */
export interface DNAIntent {
  /** 意图ID */
  id: string
  /** 意图名称 */
  name: string
  /** 描述 */
  description: string
  /** 偏好的模型层级 */
  preferredTier: 'flagship' | 'lightweight'
  /** 重心向量 (已预单位化) */
  centroid: Float32Array
  /** 置信度 (0-1) */
  confidence: number
  /** 样本数量 */
  sampleCount: number
}

/**
 * DNA配置文件
 */
export interface DNAConfig {
  /** 版本 */
  version: string
  /** 生成时间 */
  generatedAt: number
  /** 意图列表 */
  intents: DNAIntent[]
}

/**
 * 向量存储配置
 */
export interface VectorStoreConfig {
  /** 配置目录 */
  configDir: string
  /** 向量维度 (默认1536 for OpenAI embedding) */
  vectorDim: number
  /** 数据文件路径 */
  dataFilePath: string
  /** 是否启用压缩 */
  enableCompaction: boolean
  /** 压缩阈值 (补丁数量) */
  compactionThreshold: number
}

/**
 * 向量存储头部信息
 */
export interface VectorStoreHeader {
  /** 魔数 (0x56435452 = 'VCTR') */
  magic: number
  /** 版本 */
  version: number
  /** 向量维度 */
  vectorDim: number
  /** 补丁数量 */
  count: number
  /** Metadata偏移 */
  metadataOffset: bigint
  /** Data偏移 */
  dataOffset: bigint
  /** 标志位 */
  flags: number
}

/**
 * 补丁搜索结果
 */
export interface PatchSearchResult {
  /** 是否匹配 */
  found: boolean
  /** 数据来源 */
  from: 'patch-dual' | 'patch-single' | 'dna' | 'keyword' | 'default'
  /** 匹配的补丁 (如果找到) */
  patch?: Patch
  /** 匹配的意图 (如果来自DNA) */
  intent?: DNAIntent
  /** 关键词 (如果来自关键词匹配) */
  keyword?: string
  /** 相似度分数 */
  score: number
  /** 模型层级 */
  tier: 'flagship' | 'lightweight'
}

/**
 * 前缀检测结果
 */
export type PrefixCommand = 'flagship' | 'lightweight' | null

/**
 * 前缀配置
 */
export interface PrefixConfig {
  /** 旗舰模型前缀 */
  flagship: string[]
  /** 轻量模型前缀 */
  lightweight: string[]
}

/**
 * 时间衰减配置
 */
export interface TimeDecayConfig {
  /** 衰减系数 (gamma) */
  gamma: number
  /** 半衰期 (天数) */
  halfLifeDays: number
  /** 死亡阈值 */
  deathThreshold: number
  /** 最小保留数 (每个分区) */
  minRetention: number
}

/**
 * 压缩结果
 */
export interface CompactionResult {
  /** 压缩前补丁数量 */
  beforeCount: number
  /** 压缩后补丁数量 */
  afterCount: number
  /** 删除的补丁数量 */
  deletedCount: number
  /** 合并的补丁数量 */
  mergedCount: number
  /** 耗时 (毫秒) */
  durationMs: number
}

/**
 * 关键词匹配结果
 */
export interface KeywordMatchResult {
  /** 是否匹配 */
  matched: boolean
  /** 模型层级 */
  tier: 'flagship' | 'lightweight'
  /** 匹配的关键词 */
  keyword: string
}

/**
 * Embedding API配置
 */
export interface EmbeddingConfig {
  /** API超时时间 (毫秒) */
  timeoutMs: number
  /** 最大重试次数 */
  maxRetries: number
  /** 重试延迟 (毫秒) */
  retryDelayMs: number
}

/**
 * 路由器配置
 */
export interface SmartRouterConfig {
  /** 向量存储配置 */
  vectorStore: VectorStoreConfig
  /** 前缀配置 */
  prefix: PrefixConfig
  /** 时间衰减配置 */
  timeDecay: TimeDecayConfig
  /** Embedding配置 */
  embedding: EmbeddingConfig
  /** 补丁相似度阈值 */
  patchSimilarityThreshold: number
  /** DNA相似度阈值 */
  dnaSimilarityThreshold: number
  /** 软分区边界阈值 */
  softPartitionThreshold: number
  /** 默认轻量模型 */
  defaultLightweightModel: string
  /** 默认旗舰模型 */
  defaultFlagshipModel: string
}
