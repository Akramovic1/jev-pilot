import { expect, test } from 'bun:test'
import { asksInChinese, englishChars, wordCount } from '../hooks/cjk.ts'
import { signalsOf } from '../hooks/context.ts'
import { isContinuation } from '../hooks/jev-call.ts'
import { isFollowUp } from '../hooks/model-router.policy.ts'

// The goal: a message gets the same verdict in Chinese as in English, with
// the English rules left exactly as they were. The pairs are real prompts
// from a Chinese-speaking user's sessions and their English translations
// (220 were measured, 2026-09-29; these are a spread of them).

const PAIRS: [string, string][] = [
  ['继续', 'continue'],
  ['请继续', 'please continue'],
  ['推送', 'push'],
  ['确认', 'confirm'],
  ['暂停一下', 'pause for a moment'],
  ['保存记忆', 'save memory'],
  ['可以推送了', 'you can push now'],
  ['好吧', 'okay'],
  ['没什么问题，继续', 'no problem, continue'],
  ['哪怕失败也继续', 'continue even if it fails'],
  ['这几个都改了，继续', 'these few are all changed, continue'],
  ['下一步我应该做什么', 'what should I do next'],
  ['这个能用吗', 'does this work?'],
  ['哪个好', 'which one is better?'],
  ['还剩几个', 'how many are left?'],
  ['要不要推送', 'should we push'],
  ['谁改的', 'who changed it'],
  ['这个配置是什么意思？', 'what does this config mean?'],
  ['现在呢？', 'what about now?'],
  ['等一下 你现在在做什么', 'wait, what are you doing right now'],
  ['ok 我现在需要做什么', 'ok what do I need to do now'],
  ['你说的 ags 炮塔是船首的发射筒吗', 'is the ags turret you mentioned the launcher at the bow'],
  ['我已经重启了看看是否正常是否生效', "I already restarted, check whether it's working and whether it took effect"],
  ['检查一下你现在是否可以控制我的电脑', 'check whether you can control my computer right now'],
  ['看一下现在收集到哪一步了', 'check which step the collection has reached now'],
  ['帮我把登录页面改成深色主题，并且补上对应的截图测试', 'change the login page to a dark theme and add the matching screenshot tests'],
  ['把所有 API 路由的错误处理统一成一个中间件，然后更新对应的测试', 'unify the error handling of every API route into one middleware, then update the tests'],
  ['启动就报错', 'it throws an error on startup'],
  ['测试失败了', 'the tests failed'],
  ['控制台有异常', 'there is an Exception in the console'],
  ['把按钮改成蓝色', 'make the button blue'],
  ['修改src/api/orders.ts里的函数，还有db/schema.sql。', 'change the function in src/api/orders.ts, and db/schema.sql.'],
  ['继续写测试', 'continue writing tests'],
  ['继续？', 'continue?'],
]

test('each message gets the same verdicts in Chinese as in English', () => {
  for (const [zh, en] of PAIRS) {
    const [z, e] = [signalsOf(zh, []), signalsOf(en, [])]
    expect({ zh, followUp: isFollowUp(zh) }).toEqual({ zh, followUp: isFollowUp(en) })
    expect({ zh, question: z.is_question }).toEqual({ zh, question: e.is_question })
    expect({ zh, error: z.has_code_or_error }).toEqual({ zh, error: e.has_code_or_error })
    expect({ zh, files: z.files_mentioned }).toEqual({ zh, files: e.files_mentioned })
    expect({ zh, continuation: isContinuation(zh) }).toEqual({ zh, continuation: isContinuation(en) })
  }
})

test('English is read exactly as before', () => {
  const before = (prompt: string) => {
    const text = prompt.trim()
    if (!text || text.endsWith('?')) return false
    if (/^(what|why|how|is|are|do|does|did|can|could|should|where|when|which|who)\b/i.test(text)) return false
    return text.split(/\s+/).length <= 8
  }
  for (const text of ['fix all and continue', 'stop here, what are you doing right now? I have not looked yet', 'do both, apply the local patch first', 'is it finish', 'see https://example.com/x?id=1 and fix it', 'fix it — now', 'a b c d e f g h i']) {
    expect({ text, followUp: isFollowUp(text) }).toEqual({ text, followUp: before(text) })
  }
  expect(asksInChinese('why does the build fail')).toBe(false)
})

test('a Chinese prompt asks the way an English one does: by its end or its first clause', () => {
  // The end: a question mark or a closing 吗.
  expect(asksInChinese('我记得我们提交了pr 你忘记了吗')).toBe(true)
  // The first clause, like the English opening word; a later question is not read, as in English.
  expect(asksInChinese('这里停一下，你现在在做什么？我还没有看')).toBe(false)
  expect(asksInChinese('13 14不是已经做了吗 你回忆一下')).toBe(false)
  // A reported question ("check whether", "look up what") is not one.
  expect(asksInChinese('你查一下正确的xcode27的路径是什么')).toBe(false)
  // A question word meaning "any", or 几 meaning "a few", is not one.
  for (const text of ['不管怎么样先推送', '有没有都行', '就按你说的怎么改都行', '好了 复制了几次 看起来恢复正常了']) {
    expect({ text, asks: asksInChinese(text) }).toEqual({ text, asks: false })
  }
  // A closing 呢 is as often a statement's as a question's.
  expect(asksInChinese('我还没有去看你的图呢')).toBe(false)
})

test('Chinese length is measured in English words and characters', () => {
  expect(wordCount('我已经连接了这个邮箱')).toBe(7)
  expect(wordCount('ok 继续')).toBe(3)
  expect(wordCount('a b  c')).toBe('a b  c'.split(/\s+/).length)
  expect(englishChars('继续')).toBe(8)
  expect(englishChars('fix it')).toBe(6)
})
