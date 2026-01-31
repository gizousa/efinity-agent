/**
 * 智能路由配置类型定义
 * US-006: 配置系统扩展
 */

/**
 * 智能路由配置接口
 * 控制智能路由行为的所有配置项
 *
 * 配置说明：
 * - enabled: 是否启用智能路由（默认 false）
 * - lightweightModels: 轻量模型列表，如果不配置将自动从 agents.defaults.model 推断
 * - flagshipModels: 旗舰模型列表，如果不配置将自动从 agents.defaults.model 推断
 * - 其他配置项：保留用于高级用户，一般不需要配置
 */
export interface SmartRouterConfig {
  /**
   * 是否启用智能路由
   * @default false
   */
  enabled?: boolean

  /**
   * 轻量模型列表（用于简单查询）
   * 这些模型成本更低、响应更快
   *
   * 如果不配置，将自动从 agents.defaults.model.fallbacks[0] 推断
   */
  lightweightModels?: string[]

  /**
   * 旗舰模型列表（用于复杂查询）
   * 这些模型能力更强、成本更高
   *
   * 如果不配置，将自动从 agents.defaults.model.primary 推断
   */
  flagshipModels?: string[]

  /**
   * 置信度阈值
   * 当向量相似度匹配的置信度低于此值时，回退到旗舰模型
   * 范围: 0-1，值越高越保守
   *
   * 高级配置：一般不需要配置，使用默认值即可
   */
  confidenceThreshold?: number

  /**
   * Token数量阈值
   * 当查询Token数量超过此值时，强制使用旗舰模型
   *
   * 高级配置：一般不需要配置，使用默认值即可
   */
  tokenThreshold?: number

  /**
   * 强制旗舰模型的关键词列表
   * 检测到这些关键词时会强制使用旗舰模型
   *
   * 高级配置：一般不需要配置，系统会自动加载默认关键词
   */
  flagshipKeywords?: string[]

  /**
   * 向量索引文件路径
   * 存储历史查询向量和路由决策记录
   *
   * 高级配置：一般不需要配置，系统会自动使用 CONFIG_DIR/smart-router/index.json
   */
  vectorIndexPath?: string

  /**
   * 默认模型
   * 当无历史数据或路由失败时使用的模型
   *
   * 高级配置：一般不需要配置，系统会自动使用 agents.defaults.model.primary
   */
  defaultModel?: string

  /**
   * 关键词文件路径
   * 存储自定义关键词配置
   *
   * 高级配置：一般不需要配置，系统会自动使用 CONFIG_DIR/smart-router/keywords.json
   */
  keywordsFilePath?: string
}
