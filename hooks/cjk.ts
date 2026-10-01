/**
 * jev-pilot — reading prompts written in Chinese (and Japanese) the way the
 * English rules read English ones. Those rules look at a prompt's opening
 * word ("why…", "can…"), its closing "?", and its length in words. Chinese
 * has no spaces, asks with question words and particles wherever the question
 * sits rather than by its first word, and writes a question mark full-width.
 * Each rule here is the Chinese counterpart of one English rule, so the same
 * message gets the same verdict in either language.
 */

/** Han and kana: written without spaces, so splitting on spaces sees one word. */
const UNSPACED = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/gu
const KANA = /[぀-ヿ]/u
const HAN = /[㐀-䶿一-鿿豈-﫿]/u

/**
 * Han or kana characters per English word: measured on 220 real Chinese
 * prompts and their English translations (see tests/cjk.spec.ts), this is
 * the ratio at which the eight-word bar agrees most often.
 */
export const CHARS_PER_WORD = 1.5

/**
 * Words the way the eight-word bar counts them. Text with no Han or kana is
 * split on spaces exactly as before; in text with them, each run of letters
 * or digits between spaces is a word, plus one word per CHARS_PER_WORD Han or
 * kana characters.
 */
export function wordCount(text: string, charsPerWord = CHARS_PER_WORD): number {
  const unspaced = text.match(UNSPACED)?.length ?? 0
  if (unspaced === 0) return text.split(/\s+/).length
  const spaced = text.replace(UNSPACED, ' ').split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length
  return spaced + Math.ceil(unspaced / charsPerWord)
}

/**
 * About how long the prompt would be in English, in characters: each Han or
 * kana character stands for 1/CHARS_PER_WORD of a word of about six
 * characters with its space. Measured on the same 220 pairs, the English
 * translation was a median 3.0 times the Chinese length.
 */
export function englishChars(text: string): number {
  const unspaced = text.match(UNSPACED)?.length ?? 0
  return text.length - unspaced + Math.round((unspaced * 6) / CHARS_PER_WORD)
}

/**
 * The first clause: up to the first comma, full stop or line break, a space
 * between two Han or kana characters (a space beside a Latin word, as in
 * "你说的 ags 炮塔", only spaces the word), or up to and including the first
 * question mark; or a Latin word that opens the prompt. What the English
 * rule's opening word stands for: "wait, what are you doing" opens with
 * "wait", and so does "等一下 你现在在做什么".
 */
function firstClause(text: string): string {
  // A Latin word opening the prompt is its first word, as in English: "ok 我现在需要做什么".
  const opening = /^[A-Za-z0-9][\w.'-]*(?=\s)/.exec(text)
  if (opening) return opening[0]
  const end = /[，,。!！；;：:\n]|\.(?=\s|$)|(?<=[぀-ヿ㐀-鿿])\s+(?=[぀-ヿ㐀-鿿])|[?？]/u.exec(text)
  if (!end) return text
  return /[?？]/u.test(end[0]) ? text.slice(0, end.index + 1) : text.slice(0, end.index)
}

/**
 * Chinese question words. 几 only before a measure word (还剩几个, not 几乎),
 * 哪 not in 哪怕, 多少 not in 或多或少, and an "A 不 A" / "A 没 A" choice
 * (行不行, 有没有, 要不要).
 */
const ASKS = /为什么|为啥|干嘛|怎么|怎样|如何|什么|啥|哪(?!怕)|谁|(?<!或)多少|多久|几(?:个|次|点|天|号|种|条|处|遍|分钟|秒|岁|年|月|周)|是否|对吧|是吧|可不可以|([㐀-鿿])[不没]\1/gu

/** Before a question word, these make it "any": 没什么, 不管怎么, 无论如何. */
const ANY_BEFORE = /(?:没|不管|无论|不论|随便)$/u

/** And before 几, these make it "a few": 这几个, 好几次, 复制了几次. */
const FEW_BEFORE = /(?:这|那|好|前|后|头|最近|了)$/u

/** A 都 or 也 shortly after makes it "any" too: 什么都行, 怎么改都行, 谁都可以. Not after 为什么. */
const ANY_AFTER = /^[^，。！？,.!?\s]{0,3}[都也]/u

/**
 * A verb that makes what follows it a reported question, the way "check
 * whether…" and "tell me why…" are not questions in English: 看看是否正常,
 * 你查一下路径是什么, 告诉我为什么.
 */
const EMBEDS = /看看|看一下|看下|检查|查一下|查查|查|确认|告诉我|说明|说一下|解释|知道|判断|研究|分析|调查|测试|试试|问问|问一下|想想|考虑|决定|记得|明白|了解|确定|评估|对比|比较/u

/**
 * A closing particle that asks: 吗, 么 (not 什么), 没 (还有别的办法没), 不
 * (准确不), and 呢 only after a word or two (现在呢, 那你呢): after a whole
 * statement it is a statement's (我还没看呢).
 */
const CLOSING = /(?:吗|^[^\s，。]{1,3}呢|(?<![什怎那这多要])么|(?<![还都也并就])没|(?<=对|好|行|是|能|准确|正确|可以)不)[~～…]*$/u

/** Japanese asks with か at the end or a question word; read only when there is kana. */
const JAPANESE = /なぜ|どうして|どう(?![ぞも])|どこ|だれ|誰|いつ|どれ|どの|なに|何|か[~～…]*$/u

function asksIn(clause: string): boolean {
  if (CLOSING.test(clause)) return true
  if (KANA.test(clause)) return JAPANESE.test(clause)
  for (const match of clause.matchAll(ASKS)) {
    const word = match[0]
    const at = match.index ?? 0
    const before = clause.slice(0, at)
    if (EMBEDS.test(before)) continue
    const near = before.slice(-2)
    if (ANY_BEFORE.test(near) || (word.startsWith('几') && FEW_BEFORE.test(near))) continue
    if (!/^(?:为什么|为啥)$/u.test(word) && ANY_AFTER.test(clause.slice(at + word.length))) continue
    return true
  }
  return false
}

/**
 * Whether a prompt with Han or kana is a question, by the rule the English
 * one is read by: it ends with a question mark (full-width or not), or its
 * first clause asks, the way an English question opens with "why" or "can".
 * False for text with neither: the English rules read that.
 */
export function asksInChinese(text: string): boolean {
  if (!HAN.test(text) && !KANA.test(text)) return false
  // Its end: a question mark, or a closing 吗, the Chinese for one (a closing
  // 呢 or 不 is as often a statement's: 我还没看呢).
  if (/[?？]$/u.test(text) || /吗[~～…]*$/u.test(text)) return true
  const clause = firstClause(text)
  return /[?？]$/u.test(clause) || asksIn(clause)
}

/**
 * Words that report a failure, each the counterpart of one in the English
 * rule: error (报错, 错误), failed (失败了, 失败的, 已经失败 — not 失败 alone,
 * "fails"), Exception (异常), stack trace (堆栈).
 */
export const CJK_ERROR = /报错|错误|失败[了的]|已(?:经)?失败|异常|堆栈/u

/** A plain Chinese "go on", the counterpart of "continue" / "keep going": 继续, 请继续, 接着来. */
export const CJK_CONTINUE = /^(?:请)?(?:继续|接着来|接着做|接着干|接着)(?:吧)?[。.!！]*$/u
