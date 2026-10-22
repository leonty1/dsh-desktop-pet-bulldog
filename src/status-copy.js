const COPY = Object.freeze({
  idle: [
    '我在这儿等新任务哦',
    '现在暂时没任务呢',
    '法斗正在待命中~',
  ],
  preparing: [
    '新任务正在梳理中哦~',
    '让我先看看项目呢',
    '正在理清接下来要做什么呀',
  ],
  thinking: [
    '正在认真想下一步呢',
    '正在梳理思路哦~',
    '让我整理一下刚才的结果呢',
  ],
  searching: [
    '正在帮你找相关内容呢',
    '正在项目里仔细找找哦~',
    '正在查看相关文件呢',
  ],
  editing: [
    '这部分正在修改中哦',
    '正在把改动写进去呢',
    '正在认真调整实现呢',
  ],
  testing: [
    '正在认真检查结果呢',
    '正在跑测试确认一下哦',
    '正在验证改动有没有问题呢',
  ],
  commanding: [
    '正在执行项目命令呢',
    '正在让项目跑起来哦',
    '正在看看命令执行得怎么样呢',
  ],
  working: [
    '正在继续处理任务呢',
    '这一步正在进行中哦',
    '法斗还在认真干活呢',
  ],
  result: [
    '正在整理刚才的结果呢',
    '这一步处理好了，继续看看哦',
    '正在确认下一步怎么做呢',
  ],
  waiting: [
    '需要你确认一下后续呢',
    '这里要等你看一下哦',
    '轮到你来决定下一步啦',
  ],
  approval: [
    '需要你审批一下哦',
    '这里在等你的批准呢',
    '有个权限操作要你确认一下啦',
  ],
  success: [
    '这次的任务搞定啦~',
    '这一轮顺利完成啦',
    '任务完成咯~',
  ],
  toolError: [
    '这一步好像没跑通呢',
    '刚才的操作遇到一点问题哦',
    '这里卡了一下，我再等等你呢',
  ],
  error: [
    '任务好像遇到一点问题呢',
    '这里需要回来看看啦',
    '这次没有顺利跑完呢',
  ],
  stopped: [
    '任务已经停下来啦',
    '这次任务先停在这里哦',
  ],
  limit: [
    '内容有点多，到上限啦',
    '这次输出已经到上限咯',
  ],
})

function seedNumber(seed) {
  const number = Number(seed)
  if (Number.isFinite(number)) return Math.abs(Math.trunc(number))
  return [...String(seed ?? '')].reduce((total, character) => total + character.codePointAt(0), 0)
}

export function statusCopy(group, seed = 0) {
  const variants = COPY[group] ?? COPY.working
  return variants[seedNumber(seed) % variants.length]
}

export function activityCopy(activity, seed = 0) {
  return statusCopy({
    searching: 'searching',
    editing: 'editing',
    testing: 'testing',
    commanding: 'commanding',
  }[activity] ?? 'working', seed)
}

export function activityStage(activity) {
  return {
    searching: '查找阶段',
    editing: '实现阶段',
    testing: '验证阶段',
    commanding: '执行阶段',
  }[activity] ?? '处理阶段'
}

export function taskCopy(task) {
  const value = String(task ?? '').trim().replace(/[。！？.!?]+$/u, '')
  if (!value) return statusCopy('working')
  if (/^(正在|继续)/u.test(value)) {
    return `${value}呢`
  }
  if (/^(准备|检查|验证|修改|修复|测试|构建|整理|分析|梳理|查找|搜索|读取|实现)/u.test(value)) {
    return `正在${value}呢`
  }
  return `正在处理「${value}」呢`
}

// Turn one tool invocation into the short concrete phrase the status card shows
// beside the state: the file it touched, the command it ran, the words it
// searched for. The card is one line, so every value is trimmed to fit and the
// caller falls back to the generic activity copy when nothing useful survives.
const DETAIL_LIMIT = 42

function shorten(value, limit = DETAIL_LIMIT) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim()
  if (!text) return ''
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

function baseName(path) {
  const text = String(path ?? '').trim()
  if (!text) return ''
  const parts = text.split(/[\\/]+/u).filter(Boolean)
  return parts.length >= 2 ? parts.slice(-2).join('/') : parts[0] ?? ''
}

export function toolDetail(toolName, args) {
  const name = String(toolName ?? '').toLowerCase()
  let value = args
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      value = undefined
    }
  }
  const input = value !== null && typeof value === 'object' ? value : {}
  const pick = (...keys) => {
    for (const key of keys) {
      const found = input[key]
      if (typeof found === 'string' && found.trim()) return found
      if (Array.isArray(found) && found.length > 0) {
        const first = found.find((item) => typeof item === 'string' && item.trim())
        if (first) return first
      }
    }
    return ''
  }

  if (/shell|bash|exec|command|terminal|powershell/u.test(name)) {
    const command = pick('command', 'script', 'cmd')
    if (command) return shorten(command.split('\n').find((line) => line.trim()) ?? command)
    return ''
  }
  if (/web|fetch|search/u.test(name)) {
    const query = pick('query', 'q', 'search', 'prompt')
    if (query) return shorten(query)
    const url = pick('url', 'href', 'link')
    if (url) return shorten(url)
    return ''
  }
  if (/read|write|edit|patch|replace|create|move|delete|glob|grep|find/u.test(name)) {
    const target = pick('filePath', 'file_path', 'path', 'target', 'filename', 'file')
    if (target) return shorten(baseName(target))
    const pattern = pick('pattern', 'glob', 'query')
    if (pattern) return shorten(pattern)
    return ''
  }
  const generic = pick('filePath', 'file_path', 'path', 'query', 'command', 'pattern', 'description', 'prompt', 'name')
  return generic ? shorten(generic) : ''
}

export function activityDetail(activity, toolName, args) {
  const detail = toolDetail(toolName, args)
  if (!detail) return ''
  // Name the concrete operation rather than the coarse activity bucket: a
  // read that the classifier files under "searching" still reads better as
  // "读取 x" than "查找 x" on the card.
  const name = String(toolName ?? '').toLowerCase()
  const verb = /read|open|view|cat/u.test(name) ? '读取'
    : /grep|glob|find|search|query/u.test(name) ? '查找'
      : /write|edit|patch|replace|create|move|delete/u.test(name) ? '修改'
        : /test|check|lint|build|verify/u.test(name) ? '验证'
          : /shell|bash|exec|command|terminal|powershell/u.test(name) ? '执行'
            : {
              searching: '查找',
              editing: '修改',
              testing: '验证',
              commanding: '执行',
              'using-tool': '使用',
            }[activity]
  return verb ? `${verb} ${detail}` : detail
}

export { COPY as statusCopyLibrary }
