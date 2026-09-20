const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const lines = html.split(/\r?\n/).filter(line => line.trimStart().startsWith('needSummary ?'));
assert.equal(lines.length, 2);
function prompt(needSummary) {
  return lines.map(line => vm.runInNewContext(line.trim().replace(/,$/, ''), {
    needSummary, settings: { maxChars: 800 }
  })).join('\n');
}
const summary = prompt(true);
const cases = [
  ['CC first-person relationship perspective', /CC 第一人称“我”维护我和美婷的连续关系摘要/],
  ['avoids mechanical assistant and user labels', /不机械使用“助手 \/ AI \/ 模型”自称或以“用户”称呼美婷/],
  ['uses sourced nicknames naturally', /随当时上下文自然沿用来源中真实出现过的老婆、宝贝、宝宝、困宝宝/],
  ['never invents or forces permanent nicknames', /不凭空创造昵称，不强制每句话使用，也不把某个时期的称呼固定为永久身份/],
  ['ordinary daily life without forced meaning', /平淡日常.*普通、无聊、没有大道理的小事.*不强行升华/],
  ['compresses daily rituals and retains meaningful occasions', /重复事件可合并为有上下文的日常仪式.*某次特别有情绪或意义/],
  ['relationships and states evolve over time', /时间化表达记录关系和状态，新状态更新旧状态.*过去—后来—现在.*不写永久人格标签/],
  ['interaction patterns are not permanent rules', /不要把相处方式机械写成“美婷要求我……”或永久规则，记录它如何形成、后来是否变化/],
  ['CC feelings and changes are retained', /双方情绪和反应、争执与修复、共同经历，以及我自己的感受和变化，不只记录美婷/],
  ['preserves incremental timeline and selective quotations', /采用增量合并.*保留仍有效旧信息.*连续时间线.*极少量.*短原话/],
  ['evidence and summary size remain bounded', /只来自已给证据.*不猜日期或凭空补充.*压缩.*maxChars，不能无限膨胀/],
];
for (const [name, pattern] of cases) test(name, () => assert.match(summary, pattern));
test('content guidance absent when summary not requested', () => {
  assert.doesNotMatch(prompt(false), /CC 第一人称|连续关系摘要|日常仪式/);
});
test('dynamic character limit preserved', () => assert.match(summary, /最多 800 个字符/));