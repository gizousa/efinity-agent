/**
 * 向量存储模块（二进制格式）
 *
 * 核心功能：
 * - 二进制文件存储（user_memory.bin）
 * - 4字节对齐（Float32Array要求）
 * - 原子写入（fs.rename）
 * - 时间衰减权重
 * - Float64精度计算（避免累积误差）
 *
 * 文件格式：
 * - Header: 128 bytes
 * - Metadata: JSON + null terminator + padding
 * - Data: Float32Array[N * 1536] + Float32Array[N] + Int32Array[N] + UTF-8 strings
 */

import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import path from 'node:path'
import type { Patch, VectorStoreConfig, VectorStoreHeader } from '../types/smart-router.types.js'
import { normalize } from '../routing/similarity.js'

/**
 * 文件头部大小（固定128字节）
 */
const HEADER_SIZE = 128

/**
 * 魔数：0x56435452 = 'VCTR' (Vector CenTRoid)
 */
const MAGIC_NUMBER = 0x56435452

/**
 * 版本号
 */
const VERSION = 1

/**
 * 默认向量维度（OpenAI embedding）
 */
const DEFAULT_VECTOR_DIM = 1536

/**
 * 向量存储类
 */
export class VectorStore {
  private patches: Patch[] = []
  private config: VectorStoreConfig
  private loaded = false

  constructor(config: VectorStoreConfig) {
    this.config = config
  }

  /**
   * 加载向量存储
   */
  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.config.dataFilePath)
      await this.parseBuffer(data)
      this.loaded = true
      console.log(`[VectorStore] Loaded ${this.patches.length} patches from ${this.config.dataFilePath}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // 文件不存在，创建新存储
        this.patches = []
        this.loaded = true
        console.log('[VectorStore] No existing data file, starting fresh')
      } else {
        console.error('[VectorStore] Failed to load data file:', error)
        throw error
      }
    }
  }

  /**
   * 解析二进制缓冲区
   */
  private async parseBuffer(buffer: Buffer): Promise<void> {
    // 解析头部
    const header = this.parseHeader(buffer)

    // 验证魔数
    if (header.magic !== MAGIC_NUMBER) {
      throw new Error(`Invalid magic number: 0x${header.magic.toString(16).padStart(8, '0')}`)
    }

    // 验证版本
    if (header.version !== VERSION) {
      throw new Error(`Unsupported version: ${header.version}`)
    }

    // 验证向量维度
    if (header.vectorDim !== this.config.vectorDim) {
      throw new Error(`Vector dimension mismatch: expected ${this.config.vectorDim}, got ${header.vectorDim}`)
    }

    // 读取 Metadata（JSON）
    const metadataStart = Number(header.metadataOffset)
    const metadataEnd = buffer.indexOf('\0', metadataStart)
    const metadataStr = buffer.subarray(metadataStart, metadataEnd).toString('utf-8')
    const metadata = metadataStr ? JSON.parse(metadataStr) : {}

    // 读取 Data
    const dataStart = Number(header.dataOffset)
    const dataBuffer = buffer.subarray(dataStart)

    // 解析补丁数据
    this.patches = this.parsePatches(dataBuffer, header.count)
  }

  /**
   * 解析文件头部
   */
  private parseHeader(buffer: Buffer): VectorStoreHeader {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

    return {
      magic: view.getUint32(0, true),  // Little-endian
      version: view.getUint16(4, true),
      vectorDim: view.getUint32(8, true),
      count: view.getUint32(12, true),
      metadataOffset: view.getBigUint64(16, false),  // Big-endian
      dataOffset: view.getBigUint64(24, false),       // Big-endian
      flags: view.getUint32(32, true)
    }
  }

  /**
   * 解析补丁数据
   */
  private parsePatches(buffer: Buffer, count: number): Patch[] {
    const patches: Patch[] = []
    const vectorDim = this.config.vectorDim

    // 计算各部分偏移
    const vectorsBytes = count * vectorDim * 4  // Float32
    const weightsBytes = count * 4              // Float32
    const timestampsBytes = count * 4           // Int32

    let offset = 0

    // 读取向量
    const vectorsData = buffer.subarray(offset, offset + vectorsBytes)
    const vectors = new Float32Array(
      vectorsData.buffer,
      vectorsData.byteOffset,
      count * vectorDim
    )
    offset += vectorsBytes

    // 读取权重
    const weightsData = buffer.subarray(offset, offset + weightsBytes)
    const weights = new Float32Array(
      weightsData.buffer,
      weightsData.byteOffset,
      count
    )
    offset += weightsBytes

    // 读取时间戳
    const timestampsData = buffer.subarray(offset, offset + timestampsBytes)
    const timestamps = new Int32Array(
      timestampsData.buffer,
      timestampsData.byteOffset,
      count
    )
    offset += timestampsBytes

    // 读取标签（null分隔的字符串）
    const labelsData = buffer.subarray(offset)
    const labels: string[] = []
    let labelStart = 0
    for (let i = 0; i < labelsData.length; i++) {
      if (labelsData[i] === 0) {
        const label = labelsData.subarray(labelStart, i).toString('utf-8')
        labels.push(label)
        labelStart = i + 1
      }
    }

    // 组装补丁
    for (let i = 0; i < count; i++) {
      const vectorStart = i * vectorDim
      const vector = vectors.slice(vectorStart, vectorStart + vectorDim)

      patches.push({
        vector,
        tier: weights[i] > 0.5 ? 'flagship' : 'lightweight',  // 根据权重推断层级
        label: labels[i] || '',
        timestamp: timestamps[i],
        initialWeight: 1.0
      })
    }

    return patches
  }

  /**
   * 保存向量存储
   */
  async save(): Promise<void> {
    // 序列化数据
    const buffer = await this.serialize()

    // 原子写入：使用唯一临时文件名
    const tmpPath = `${this.config.dataFilePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`

    try {
      // 写入临时文件
      await fs.writeFile(tmpPath, buffer)

      // 原子重命名
      await fs.rename(tmpPath, this.config.dataFilePath)

      console.log(`[VectorStore] Saved ${this.patches.length} patches to ${this.config.dataFilePath}`)
    } catch (error) {
      // 清理临时文件
      fs.unlink(tmpPath).catch(() => {})
      console.error('[VectorStore] Failed to save data file:', error)
      throw error
    }
  }

  /**
   * 序列化数据为二进制缓冲区
   */
  private async serialize(): Promise<Buffer> {
    const count = this.patches.length
    const vectorDim = this.config.vectorDim

    // 计算 Data 部分大小
    const vectorsBytes = count * vectorDim * 4  // Float32
    const weightsBytes = count * 4              // Float32
    const timestampsBytes = count * 4           // Int32

    // 计算标签大小
    const labelsStrings = this.patches.map(p => p.label)
    const labelsBuffer = Buffer.concat([
      ...labelsStrings.map(label => Buffer.from(label, 'utf-8')),
      Buffer.from([0])  // null terminator
    ])
    const labelsBytes = labelsBuffer.length

    const dataSize = vectorsBytes + weightsBytes + timestampsBytes + labelsBytes

    // 计算 Metadata 大小
    const metadataObj = {
      version: VERSION,
      vectorDim,
      count,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    const metadataStr = JSON.stringify(metadataObj)
    const metadataBuffer = Buffer.from(metadataStr, 'utf-8')
    const metadataSize = metadataBuffer.length + 1  // +1 for null terminator

    // 计算 padding（4字节对齐）
    const paddingSize = (4 - (HEADER_SIZE + metadataSize) % 4) % 4

    // 计算 dataStartOffset（数据区起始位置）
    const dataStartOffset = HEADER_SIZE + metadataSize + paddingSize

    // 分配总缓冲区
    const totalSize = dataStartOffset + dataSize
    const buffer = Buffer.allocUnsafeSlow(totalSize)

    // 写入 Header
    const headerView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    headerView.setUint32(0, MAGIC_NUMBER, true)           // Magic
    headerView.setUint16(4, VERSION, true)                 // Version
    headerView.setUint32(8, vectorDim, true)               // Vector Dim
    headerView.setUint32(12, count, true)                  // Count
    headerView.setBigUint64(16, BigInt(HEADER_SIZE))       // Metadata Offset
    headerView.setBigUint64(24, BigInt(dataStartOffset))   // Data Offset
    headerView.setUint32(32, 0, true)                      // Flags

    // 写入 Metadata
    metadataBuffer.copy(buffer, HEADER_SIZE)
    buffer[HEADER_SIZE + metadataBuffer.length] = 0  // null terminator

    // 写入 padding
    const paddingBuffer = Buffer.alloc(paddingSize, 0)
    paddingBuffer.copy(buffer, HEADER_SIZE + metadataSize)

    // 写入 Data
    let dataOffset = HEADER_SIZE + metadataSize + paddingSize

    // 写入向量
    const vectorsArray = new Float32Array(count * vectorDim)
    for (let i = 0; i < count; i++) {
      const vector = this.patches[i].vector
      for (let j = 0; j < vectorDim; j++) {
        vectorsArray[i * vectorDim + j] = vector[j]
      }
    }
    const vectorsBuffer = Buffer.from(vectorsArray.buffer)
    vectorsBuffer.copy(buffer, dataOffset)
    dataOffset += vectorsBytes

    // 写入权重
    const weightsArray = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      weightsArray[i] = this.patches[i].tier === 'flagship' ? 1.0 : 0.0
    }
    const weightsBuffer = Buffer.from(weightsArray.buffer)
    weightsBuffer.copy(buffer, dataOffset)
    dataOffset += weightsBytes

    // 写入时间戳
    const timestampsArray = new Int32Array(count)
    for (let i = 0; i < count; i++) {
      timestampsArray[i] = this.patches[i].timestamp
    }
    const timestampsBuffer = Buffer.from(timestampsArray.buffer)
    timestampsBuffer.copy(buffer, dataOffset)
    dataOffset += timestampsBytes

    // 写入标签
    labelsBuffer.copy(buffer, dataOffset)

    return buffer
  }

  /**
   * 添加补丁
   */
  async addPatch(patch: Patch): Promise<void> {
    // 确保向量已单位化
    normalize(patch.vector)

    // 添加到内存
    this.patches.push(patch)

    // 自动保存
    await this.save()

    // 检查是否需要压缩
    if (this.patches.length >= this.config.compactionThreshold) {
      await this.compact()
    }
  }

  /**
   * 获取所有补丁
   */
  getAllPatches(): Patch[] {
    return [...this.patches]
  }

  /**
   * 获取补丁数量
   */
  getCount(): number {
    return this.patches.length
  }

  /**
   * 计算衰减权重
   *
   * 公式：w_t = w_0 * γ^(t / T_half)
   * - γ (gamma) = 0.95
   * - T_half (半衰期) = 30 天
   */
  calculateDecayedWeight(patch: Patch, currentTime: number): number {
    const timeDiff = currentTime - patch.timestamp
    const daysDiff = timeDiff / (24 * 60 * 60 * 1000)

    // γ = 0.95, T_half = 30 天
    const gamma = 0.95
    const halfLifeDays = 30

    const decayedWeight = patch.initialWeight || 1.0
    const weight = decayedWeight * Math.pow(gamma, daysDiff / halfLifeDays)

    return weight
  }

  /**
   * 压缩补丁（DBSCAN + 加权质心 + 最小保留数）
   */
  async compact(): Promise<void> {
    console.log('[VectorStore] Starting compaction...')

    const startTime = Date.now()
    const beforeCount = this.patches.length

    // TODO: 实现 DBSCAN 聚类和加权质心合并
    // 当前简化版：只删除权重过低的补丁

    const currentTime = Date.now()
    const deathThreshold = 0.1
    const minRetention = 3  // 每个分区至少保留3个

    // 按层级分组
    const flagshipPatches = this.patches.filter(p => p.tier === 'flagship')
    const lightweightPatches = this.patches.filter(p => p.tier === 'lightweight')

    // 过滤并保留最小数量
    const filterWithMinRetention = (patches: Patch[]): Patch[] => {
      // 按权重排序
      const sorted = [...patches].sort((a, b) => {
        const weightA = this.calculateDecayedWeight(a, currentTime)
        const weightB = this.calculateDecayedWeight(b, currentTime)
        return weightB - weightA
      })

      // 保留权重 >= 0.1 的
      const valid = sorted.filter(p => this.calculateDecayedWeight(p, currentTime) >= deathThreshold)

      // 如果不足 minRetention 个，强制保留前 minRetention 个
      if (valid.length < minRetention) {
        return sorted.slice(0, minRetention)
      }

      return valid
    }

    const keptFlagship = filterWithMinRetention(flagshipPatches)
    const keptLightweight = filterWithMinRetention(lightweightPatches)

    this.patches = [...keptFlagship, ...keptLightweight]

    await this.save()

    const duration = Date.now() - startTime
    const afterCount = this.patches.length

    console.log(`[VectorStore] Compaction complete: ${beforeCount} -> ${afterCount} (${duration}ms)`)
  }

  /**
   * 清空所有补丁
   */
  async clear(): Promise<void> {
    this.patches = []
    await this.save()
    console.log('[VectorStore] Cleared all patches')
  }

  /**
   * 检查是否已加载
   */
  isLoaded(): boolean {
    return this.loaded
  }
}

/**
 * 创建向量存储实例
 */
export async function createVectorStore(config: Partial<VectorStoreConfig> = {}): Promise<VectorStore> {
  const fullConfig: VectorStoreConfig = {
    configDir: config.configDir || process.cwd(),
    vectorDim: config.vectorDim || DEFAULT_VECTOR_DIM,
    dataFilePath: config.dataFilePath || path.join(process.cwd(), 'user_memory.bin'),
    enableCompaction: config.enableCompaction ?? true,
    compactionThreshold: config.compactionThreshold || 1500
  }

  const store = new VectorStore(fullConfig)
  await store.load()

  return store
}
