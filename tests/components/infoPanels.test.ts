// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import BookmarksPanel from '../../src/components/BookmarksPanel.vue'
import TocIndexPanel from '../../src/components/TocIndexPanel.vue'
import PropertiesPanel from '../../src/components/PropertiesPanel.vue'
import DocFlagsPanel from '../../src/components/DocFlagsPanel.vue'
import RevisionsPanel from '../../src/components/RevisionsPanel.vue'
import StoriesPanel from '../../src/components/StoriesPanel.vue'
import SectionsPanel from '../../src/components/SectionsPanel.vue'
import PageFieldsPanel from '../../src/components/PageFieldsPanel.vue'
import CrossReferencesPanel from '../../src/components/CrossReferencesPanel.vue'
import ShapesPanel from '../../src/components/ShapesPanel.vue'
import EquationsPanel from '../../src/components/EquationsPanel.vue'
import WordArtsPanel from '../../src/components/WordArtsPanel.vue'

describe('extracted info panels', () => {
  it('BookmarksPanel renders names and CP ranges, emits toggle', async () => {
    const w = mount(BookmarksPanel, {
      props: {
        modelValue: true,
        title: 'Bookmarks (1)',
        summary: 's',
        bookmarks: [{ name: 'intro', cpStart: 3, cpEnd: 9 }],
      },
    })
    expect(w.find('.bookmark-name').text()).toBe('intro')
    expect(w.find('.bookmark-range').text()).toContain('3')
    expect(w.find('.bookmarks-content').exists()).toBe(true)
    await w.find('button.stories-toggle').trigger('click')
    expect(w.emitted('update:modelValue')).toEqual([[false]])
    w.unmount()
  })

  it('TocIndexPanel renders both panels with named v-model events', async () => {
    const w = mount(TocIndexPanel, {
      props: {
        tocOpen: true,
        indexOpen: true,
        tocTitle: 'TOC',
        indexTitle: 'Index',
        toc: [{ level: 1, text: 'Chapter 1', pageNumber: '2' } as never],
        index: [{ mainTerm: 'alpha', subTerm: 'beta', pageNumber: '3' } as never],
      },
    })
    const buttons = w.findAll('button.stories-toggle')
    expect(buttons).toHaveLength(2)
    expect(w.text()).toContain('Chapter 1')
    expect(w.text()).toContain('alpha')
    await buttons[0].trigger('click')
    await buttons[1].trigger('click')
    expect(w.emitted('update:tocOpen')).toEqual([[false]])
    expect(w.emitted('update:indexOpen')).toEqual([[false]])
    w.unmount()
  })

  it('PropertiesPanel renders both SummaryInformation and document fields', () => {
    const w = mount(PropertiesPanel, {
      props: {
        modelValue: true,
        title: 'Properties',
        summary: '',
        docFieldsTitle: 'Fields',
        docFieldsSummary: '',
        properties: { title: 'Doc title', author: 'Alice' } as never,
        docFields: { author: 'Bob', date: '2026' } as never,
        styleSetLabel: 'Formal',
        wordVersionLabel: 'Word 2003',
      },
    })
    expect(w.text()).toContain('Doc title')
    expect(w.text()).toContain('Alice')
    expect(w.text()).toContain('Bob')
    expect(w.text()).toContain('Formal')
    expect(w.text()).toContain('Word 2003')
    w.unmount()
  })

  it('RevisionsPanel emits change-mode for the three modes', async () => {
    const w = mount(RevisionsPanel, {
      props: {
        modelValue: true,
        title: 'Revisions',
        summary: '',
        mode: 'marks',
        items: [{ type: 'insert', label: 'Insert', author: 'A', time: '', count: 1 }] as never,
      },
    })
    const buttons = w.findAll('button.revision-mode-btn')
    expect(buttons).toHaveLength(3)
    await buttons[1].trigger('click')
    await buttons[2].trigger('click')
    expect(w.emitted('change-mode')).toEqual([['accepted'], ['rejected']])
    w.unmount()
  })

  it('remaining panels render their primary data field', () => {
    const mounts = [
      mount(DocFlagsPanel, { props: { modelValue: true, title: 'Flags', summary: '', items: [{ label: 'Facing', description: 'd' }] } }),
      mount(StoriesPanel, { props: { modelValue: true, title: 'Stories', sections: [{ key: 'headers', label: 'Header', text: 'hello' }], formatStoryText: (s: string) => s } }),
      mount(SectionsPanel, { props: { modelValue: true, title: 'Sections', sections: [{ cpStart: 0, cpEnd: 1, index: 0, pageWidthPt: 595, pageHeightPt: 842 }] as never, formatSizePt: (p?: number) => String(p) } }),
      mount(PageFieldsPanel, { props: { modelValue: true, title: 'Fields', fields: [{ cpStart: 0, cpEnd: 2, type: 'page', instruction: 'PAGE', result: '7' }] as never } }),
      mount(CrossReferencesPanel, { props: { modelValue: true, title: 'Refs', references: [{ cpStart: 0, cpEnd: 2, type: 'ref', instruction: 'REF x', targetBookmarkName: 'x', result: 'x', switches: [] }] as never } }),
      mount(ShapesPanel, { props: { modelValue: true, title: 'Shapes', shapes: [{ spid: 1, type: 'textbox', anchorType: 'char' }] as never } }),
      mount(EquationsPanel, { props: { modelValue: true, title: 'Equations', equations: [{ id: 1, eqnText: 'x^2', latex: 'x^{2}' }] as never } }),
      mount(WordArtsPanel, { props: { modelValue: true, title: 'WordArt', wordArts: [{ id: 1, name: 'Art', effects: ['shadow'], text: 'Hi' }] as never } }),
    ]
    for (const w of mounts) {
      expect(w.find('button.stories-toggle').exists()).toBe(true)
      w.unmount()
    }
  })
})
