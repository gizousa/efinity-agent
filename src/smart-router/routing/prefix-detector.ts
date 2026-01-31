/**
 * 前缀检测模块
 *
 * 核心功能：
 * - 检测用户输入中的模型指令前缀
 * - 清理前缀，得到纯净查询用于向量化
 *
 * 设计原理：
 * - 使用"关键词 + 冒号/空格"作为前缀，区分"指令"和"内容"
 * - 例如："旗舰: 帮我写个脚本" 触发旗舰模型
 * - 例如："旗舰店在哪里" 不触发（无分隔符）
 */

import type { PrefixCommand } from '../types/smart-router.types.js'

/**
 * 旗舰模型前缀列表
 *
 * 支持中文和英文，冒号或空格分隔
 */
const FLAGSHIP_PREFIXES = [
  '旗舰:',
  '旗舰 ',
  'Force:',
  'Force ',
  'F:',
  'F '
]

/**
 * 轻量模型前缀列表
 *
 * 支持中文和英文，冒号或空格分隔
 */
const LIGHTWEIGHT_PREFIXES = [
  '轻量:',
  '轻量 ',
  'Fast:',
  'Fast ',
  'L:',
  'L '
]

/**
 * 检测前缀指令（最高优先级）
 *
 * 在路由决策前先检查，如果检测到前缀，直接使用用户指定的模型层级。
 *
 * 设计原理：
 * - 必须有冒号或空格分隔，避免误判
 * - 例如："旗舰店在哪里" 不触发旗舰模型
 * - 例如："旗舰: 帮我写个脚本" 触发旗舰模型
 *
 * @param query - 用户输入的原始查询
 * @returns 前缀指令，如果没有检测到则返回null
 *
 * @example
 * ```ts
 * detectPrefixCommand('旗舰: 帮我写个脚本')  // => 'flagship'
 * detectPrefixCommand('旗舰店在哪里')         // => null
 * detectPrefixCommand('轻量 解释一下闭包')    // => 'lightweight'
 * detectPrefixCommand('普通查询')            // => null
 * ```
 */
export function detectPrefixCommand(query: string): PrefixCommand {
  const trimmedQuery = query.trim()

  // 检测旗舰模型前缀
  for (const prefix of FLAGSHIP_PREFIXES) {
    if (trimmedQuery.startsWith(prefix)) {
      return 'flagship'
    }
  }

  // 检测轻量模型前缀
  for (const prefix of LIGHTWEIGHT_PREFIXES) {
    if (trimmedQuery.startsWith(prefix)) {
      return 'lightweight'
    }
  }

  return null
}

/**
 * 清理前缀（正则优化版）
 *
 * 使用正则表达式一次性处理所有可能的分隔符（冒号、全角冒号、空格）。
 * 学习时必须删除前缀，否则向量会污染，导致"旗舰店"也触发旗舰模型。
 *
 * @param query - 原始查询
 * @param tier - 模型层级（用于选择正确的正则表达式）
 * @returns 清理后的查询（无前缀）
 *
 * @example
 * ```ts
 * stripPrefix('旗舰: 帮我写个脚本', 'flagship')  // => '帮我写个脚本'
 * stripPrefix('F: design a system', 'flagship')  // => 'design a system'
 * stripPrefix('轻量 解释闭包', 'lightweight')    // => '解释闭包'
 * ```
 */
export function stripPrefix(query: string, tier: 'flagship' | 'lightweight'): string {
  // 旗舰模型正则：匹配 旗舰/Force/F + 冒号/空格
  const flagshipPattern = /^(旗舰|Force|F)[:：\s]+/i

  // 轻量模型正则：匹配 轻量/Fast/L + 冒号/空格
  const lightweightPattern = /^(轻量|Fast|L)[:：\s]+/i

  // 根据层级选择正则表达式
  const pattern = tier === 'flagship' ? flagshipPattern : lightweightPattern

  // 替换并去除首尾空格
  return query.replace(pattern, '').trim()
}

/**
 * 获取前缀字符串（用于日志）
 *
 * @param query - 原始查询
 * @returns 检测到的前缀字符串，如果没有则返回空字符串
 *
 * @example
 * ```ts
 * getDetectedPrefix('旗舰: 帮我写个脚本')  // => '旗舰:'
 * getDetectedPrefix('普通查询')            // => ''
 * ```
 */
export function getDetectedPrefix(query: string): string {
  const trimmedQuery = query.trim()

  for (const prefix of FLAGSHIP_PREFIXES) {
    if (trimmedQuery.startsWith(prefix)) {
      return prefix
    }
  }

  for (const prefix of LIGHTWEIGHT_PREFIXES) {
    if (trimmedQuery.startsWith(prefix)) {
      return prefix
    }
  }

  return ''
}

/**
 * 检查是否包含前缀（不区分具体类型）
 *
 * @param query - 用户输入
 * @returns 是否包含任何前缀
 */
export function hasPrefix(query: string): boolean {
  return detectPrefixCommand(query) !== null
}

/**
 * 前缀检测单元测试数据
 *
 * 用于验证前缀检测的正确性
 */
export const PREFIX_TEST_CASES = {
  // 旗舰模型测试用例
  flagship: {
    positive: [
      '旗舰: 帮我写个脚本',
      '旗舰 帮我写个脚本',
      'Force: design a system',
      'Force design a system',
      'F: implement feature',
      'F implement feature'
    ],
    negative: [
      '旗舰店在哪里',      // 无分隔符，不触发
      '这是旗舰产品',      // 无分隔符，不触发
      'f字开头',          // 小写f无冒号，不触发
      '普通查询'           // 无前缀
    ]
  },
  // 轻量模型测试用例
  lightweight: {
    positive: [
      '轻量: 解释一下闭包',
      '轻量 解释一下闭包',
      'Fast: what is closure',
      'Fast what is closure',
      'L: simple answer',
      'L simple answer'
    ],
    negative: [
      '轻量级组件',        // 无分隔符，不触发
      '这是轻量操作',      // 无分隔符，不触发
      'l字母开头',         // 小写l无冒号，不触发
      '普通查询'           // 无前缀
    ]
  }
} as const

/**
 * 运行前缀检测测试
 *
 * @returns 测试结果对象
 */
export function runPrefixDetectionTests(): {
  passed: number
  failed: number
  results: Array<{ case: string; expected: PrefixCommand; actual: PrefixCommand; passed: boolean }>
} {
  const results: Array<{
    case: string
    expected: PrefixCommand
    actual: PrefixCommand
    passed: boolean
  }> = []

  // 测试旗舰模型正向用例
  for (const testCase of PREFIX_TEST_CASES.flagship.positive) {
    const actual = detectPrefixCommand(testCase)
    results.push({
      case: testCase,
      expected: 'flagship',
      actual,
      passed: actual === 'flagship'
    })
  }

  // 测试旗舰模型负向用例
  for (const testCase of PREFIX_TEST_CASES.flagship.negative) {
    const actual = detectPrefixCommand(testCase)
    results.push({
      case: testCase,
      expected: null,
      actual,
      passed: actual === null
    })
  }

  // 测试轻量模型正向用例
  for (const testCase of PREFIX_TEST_CASES.lightweight.positive) {
    const actual = detectPrefixCommand(testCase)
    results.push({
      case: testCase,
      expected: 'lightweight',
      actual,
      passed: actual === 'lightweight'
    })
  }

  // 测试轻量模型负向用例
  for (const testCase of PREFIX_TEST_CASES.lightweight.negative) {
    const actual = detectPrefixCommand(testCase)
    results.push({
      case: testCase,
      expected: null,
      actual,
      passed: actual === null
    })
  }

  const passed = results.filter(r => r.passed).length
  const failed = results.length - passed

  return { passed, failed, results }
}
