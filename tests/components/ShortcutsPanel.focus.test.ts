// DOC-POLISH③ · ShortcutsPanel 模态焦点管理单测（watch/restoreFocus/trapFocus 分支覆盖）
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import ShortcutsPanel from '../../src/components/ShortcutsPanel.vue'

/** 面板外触发按钮：模拟 aria-controls 入口，验证焦点归还路径 */
function makeTrigger(): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.setAttribute('aria-controls', 'doc-shortcuts-panel')
  document.body.appendChild(btn)
  return btn
}

/** 原生可取消 keydown，冒泡到 overlay 的 @keydown="trapFocus"；返回事件以检查 defaultPrevented */
function fireKey(el: HTMLElement, key: string, shiftKey = false): KeyboardEvent {
  const evt = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  el.dispatchEvent(evt)
  return evt
}

describe('ShortcutsPanel focus management', () => {
  beforeEach(() => {
    // 清空 body 残留节点（避免上一用例的 trigger/panel 影响 aria-controls 回退选择器）
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild)
  })

  it('moves focus into the dialog on open and restores it to the trigger on close', async () => {
    const trigger = makeTrigger()
    trigger.focus()
    const wrapper = mount(ShortcutsPanel, {
      props: { modelValue: false },
      attachTo: document.body,
    })
    await wrapper.setProps({ modelValue: true })
    await nextTick()
    await nextTick()
    const panel = document.getElementById('doc-shortcuts-panel')
    expect(panel).not.toBeNull()
    expect(document.activeElement).toBe(panel)

    await wrapper.setProps({ modelValue: false })
    await nextTick()
    await nextTick()
    // previouslyFocused（trigger）仍 connected → 焦点归还触发按钮
    expect(document.activeElement).toBe(trigger)
    wrapper.unmount()
  })

  it('falls back to the aria-controls entry when the original trigger was unmounted', async () => {
    const trigger = makeTrigger()
    trigger.focus()
    const wrapper = mount(ShortcutsPanel, { props: { modelValue: true }, attachTo: document.body })
    await nextTick()
    await nextTick()
    // 打开后记录 activeElement=trigger；随后卸载 trigger 使其 disconnected
    trigger.remove()
    const standIn = makeTrigger() // 回退选择器命中的现存入口
    await wrapper.setProps({ modelValue: false })
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(standIn)
    wrapper.unmount()
  })

  it('traps Tab at the last focusable back to first, and Shift+Tab at first to last', async () => {
    const wrapper = mount(ShortcutsPanel, { props: { modelValue: true }, attachTo: document.body })
    await nextTick()
    const panel = wrapper.find('#doc-shortcuts-panel')
    const closeBtn = panel.find('button.shortcuts-close').element as HTMLElement
    const panelEl = panel.element as HTMLElement

    // 焦点在面板容器（tabindex=-1）→ Tab 不拦截，交由浏览器默认行为进入首个可聚焦元素
    // （happy-dom 不模拟 Tab 默认移动，只断言 preventDefault 未被调用）
    panelEl.focus()
    expect(fireKey(panelEl, 'Tab').defaultPrevented).toBe(false)

    // 唯一可聚焦项 first===last===closeBtn：Shift+Tab 在 first → 回环到 last（preventDefault 生效）
    closeBtn.focus()
    expect(fireKey(panelEl, 'Tab', true).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(closeBtn)

    // 普通 Tab 在 last → 回环到 first
    expect(fireKey(panelEl, 'Tab').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(closeBtn)

    // 焦点逃到面板外（body）→ Tab 拉回 first
    document.body.focus()
    expect(fireKey(panelEl, 'Tab').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(closeBtn)

    // 非 Tab 键不拦截
    closeBtn.focus()
    expect(fireKey(panelEl, 'Enter').defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(closeBtn)
    wrapper.unmount()
  })
})
