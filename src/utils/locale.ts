import { shallowRef } from 'vue'

export type Locale = 'zh-CN' | 'en'

const _locale = shallowRef<Locale>('zh-CN')

const saved = localStorage.getItem('locale') as Locale | null
if (saved === 'zh-CN' || saved === 'en') {
  _locale.value = saved
}

export { _locale as currentLocale }

export function setLocale(locale: Locale) {
  _locale.value = locale
  localStorage.setItem('locale', locale)
}

type TransValue = string | Record<string, string> | ((params: Record<string, any>) => string)

const zh: Record<string, TransValue> = {
  // App
  'app.title': 'DOC文件在线预览',
  'app.desc': '上传或通过地址加载 .doc 文件进行在线预览（纯前端实现）',
  'app.upload.area.title': '选择或拖拽DOC文档',
  'app.upload.area.title.drag': '释放文件开始预览',
  'app.upload.area.hint': '支持 .doc / .dot 格式文件，最大 50MB',
  'app.upload.btn': '点击选择文件',
  'app.upload.or': '或者',
  'app.upload.url.placeholder': '输入 .doc 文件地址...',
  'app.upload.url.btn': '加载',
  'app.upload.error.format': ({ ext }) => `不支持的文件格式 ".${ext}"，请选择 .doc 或 .dot 文件`,
  'app.upload.error.docx': '.docx 格式暂不支持。\n此工具为旧版 .doc (OLE2) 格式设计，\n.docx 文件需使用 Microsoft Word 或其他兼容工具打开。',
  'app.upload.error.size': ({ size, max }) => `文件过大 (${size})，最大支持 ${max}`,
  'app.back': '← 返回',
  'app.theme.dark': '切换暗色模式',
  'app.theme.light': '切换亮色模式',
  'app.font.on': '关闭 Web Font',
  'app.font.off': '启用 Web Font',
  'app.reader.on': '退出阅读模式',
  'app.reader.off': '阅读模式',
  'app.lang.switch': '切换语言 / Switch Language',

  // Loading / Error
  'loading.text': '正在解析文档...',
  'loading.size': ({ size }) => `大小: ${size}`,
  'loading.time': ({ sec }) => `已用: ${sec}秒`,
  'loading.worker': '⚡ 后台线程',
  'loading.progress.reading': '读取文件...',
  'loading.progress.downloading': '下载文件...',
  'loading.progress.parsing': '解析文档结构...',
  'loading.progress.rendering': '渲染文档内容...',
  'error.render': ({ msg }) => `❌ 渲染文档时发生错误\n\n${msg}`,
  'error.parse.fail': '解析失败',
  'error.parse.unknown': '未知错误',
  'error.load.url': ({ msg }) => `❌ 无法从地址加载文件\n\n${msg}\n\n可能原因：\n• 地址不可达或已失效\n• 跨域限制（CORS）\n• 服务器返回了错误状态码`,
  'error.load.fail': ({ msg }) => `❌ 加载失败\n\n${msg}`,
  'error.retry': '重试',
  'error.details': '查看技术细节',

  // Toolbar
  'toolbar.zoom.in': '放大',
  'toolbar.zoom.out': '缩小',
  'toolbar.zoom.reset': '重置缩放',
  'toolbar.zoom.reset.aria': '重置缩放为 100%',
  'toolbar.search': '搜索文档',
  'toolbar.print': '打印 / 导出 PDF',
  'toolbar.download.txt': '下载为文本文件',
  'toolbar.download.html': '下载为 HTML 文件',
  'toolbar.download.md': '下载为 Markdown 文件',
  'toolbar.copy': '复制文本到剪贴板',
  'toolbar.outline': '文档大纲',
  'toolbar.hidden.show': '隐藏文字：显示中',
  'toolbar.hidden.hide': '隐藏文字：已隐藏',
  'toolbar.hidden.toggle': '切换隐藏文字显示',
  'toolbar.theme': '切换主题',
  'toolbar.shortcuts': '快捷键',
  'toolbar.stats': '文档统计',
  'toolbar.internal.links': '内部链接跳转',
  'toolbar.page.fields': '页码域跳转',
  'toolbar.cross.refs': '交叉引用跳转',
  'toolbar.paginate': '分页',

  // Search
  'search.placeholder': '搜索文档内容...',
  'search.no.results': '无匹配结果',
  'search.results': ({ n }) => `找到 ${n} 个匹配`,
  'search.case': '大小写敏感',
  'search.word': '全词匹配',

  // Pagination
  'pagination.prev': '上一页',
  'pagination.next': '下一页',
  'pagination.page': ({ current, total }) => `${current} / ${total}`,

  // Doc status
  'doc.status.ok': '✓ 解析成功',
  'doc.status.empty': '文档内容为空',

  // Outline
  'outline.header': '文档大纲',

  // Stories panels
  'story.headers': '页眉/页脚',
  'story.footnotes': '脚注',
  'story.endnotes': '尾注',
  'story.comments': '批注',
  'story.textboxes': '文本框',
  'story.title': '非正文内容',
  'story.headerParts.titleHeader': '首页页眉',
  'story.headerParts.titleFooter': '首页页脚',
  'story.headerParts.oddHeader': '奇数页页眉',
  'story.headerParts.oddFooter': '奇数页页脚',
  'story.headerParts.evenHeader': '偶数页页眉',
  'story.headerParts.evenFooter': '偶数页页脚',
  'story.headerFallback': '页眉/页脚',
  'story.image.caption': ({ fmt }) => `${fmt || '图片'}`,

  // Properties panel
  'props.title': '文档属性',
  'props.docFields': '文档域',
  'props.field.title': '标题',
  'props.field.subject': '主题',
  'props.field.author': '作者',
  'props.field.lastAuthor': '最后修改者',
  'props.field.keywords': '关键词',
  'props.field.comments': '备注',
  'props.field.lastSavedBy': '最后保存者',
  'props.field.created': '创建日期',
  'props.field.lastSaved': '最后保存日期',
  'props.field.printed': '打印日期',
  'props.field.date': '日期',
  'props.field.time': '时间',
  'props.field.revision': '修订号',
  'props.pages': '页数',
  'props.words': '字数',
  'props.chars': '字符数',
  'props.category': '类别',
  'props.company': '公司',
  'props.manager': '经理',
  'props.template': '模板',
  'props.styleSet': '样式集',
  'props.styleSet.custom': ' (自定义)',
  'props.appName': '应用程序',
  'props.wordVersion': 'Word 版本',
  'props.revisionNumber': '修订号',
  'props.lines': '行数',
  'props.paragraphs': '段落数',
  'props.charsWithSpaces': '字符数(含空格)',

  // Doc flags
  'flags.title': '文档标志',
  'flags.facingPages': '奇偶页不同',
  'flags.facingPages.desc': 'fFacingPages — 奇数页和偶数页有不同的页眉页脚',
  'flags.titlePage': '首页不同',
  'flags.titlePage.desc': 'fTitlePage — 首页有独立的页眉页脚',
  'flags.pmhMain': '有页眉',
  'flags.pmhMain.desc': 'fPMHMain — 主文档包含页眉',
  'flags.trackChanges': '修订模式',
  'flags.trackChanges.desc': 'fRMW — 文档启用了修订记录（track changes）',
  'flags.ftnRestart': '脚注重编号',
  'flags.ftnRestart.desc': 'fFtnRestart — 脚注每页或每节重新编号',
  'flags.ftnEnd': '脚注在节末',
  'flags.ftnEnd.desc': 'fFtnEnd — 脚注位于节末',
  'flags.ftnAtEnd': '脚注在文末',
  'flags.ftnAtEnd.desc': 'fFtnAtEnd — 脚注位于文档末尾',
  'flags.items': ({ n }) => `${n} 项`,

  // TOC panel
  'toc.title': '目录',
  'toc.summary': '目录条目',

  // Index panel
  'index.title': '索引',
  'index.summary': '索引条目',

  // Revisions panel
  'revisions.title': '修订记录',
  'revisions.marks': '显示标记',
  'revisions.accept': '接受全部',
  'revisions.reject': '拒绝全部',
  'revisions.count': ({ n }) => `${n} 处`,
  'revisions.type.insert': '插入',
  'revisions.type.delete': '删除',
  'revisions.type.format': '格式修订',
  'revisions.author.unknown': '未知作者',

  // Bookmarks panel
  'bookmarks.title': '书签',
  'bookmarks.summary': '命名范围',

  // Sections panel
  'sections.title': '分节与页面布局',
  'sections.summary': '纸张 / 边距 / 方向 / 分栏',
  'sections.index': ({ n }) => `节 ${n + 1}`,
  'sections.pageSize': '页面尺寸',
  'sections.marginLeft': '左边距',
  'sections.marginRight': '右边距',
  'sections.marginTop': '上边距',
  'sections.marginBottom': '下边距',
  'sections.gutter': '装订线',
  'sections.columns': '分栏',
  'sections.columns.gap': ({ pt }) => `（间距 ${pt}）`,
  'sections.startPageNum': '起始页码',
  'sections.break.nextPage': '下一页',
  'sections.break.oddPage': '奇数页',
  'sections.break.evenPage': '偶数页',
  'sections.break.continuous': '连续',
  'sections.orientation.landscape': '横向',
  'sections.orientation.portrait': '纵向',

  // Page fields panel
  'pageFields.title': '页码域',
  'pageFields.type.page': '当前页码 (PAGE)',
  'pageFields.type.numPages': '总页数 (NUMPAGES)',
  'pageFields.type.section': '当前节 (SECTION)',
  'pageFields.type.sectionPages': '节内页数 (SECTIONPAGES)',
  'pageFields.value': ({ v }) => `值：${v}`,
  'pageFields.instruction': ({ inst }) => `指令：${inst}`,

  // Cross references panel
  'crossRefs.title': '交叉引用',
  'crossRefs.type.ref': '引用 (REF)',
  'crossRefs.type.noteref': '脚注引用 (NOTEREF)',
  'crossRefs.switch.h': '超链接',
  'crossRefs.switch.n': '段落编号',
  'crossRefs.switch.r': '段落编号(无分隔符)',
  'crossRefs.switch.w': '完整段落编号',
  'crossRefs.switch.p': '相对位置(上方/下方)',
  'crossRefs.switch.f': '插入引用类型',
  'crossRefs.switch.d': '分隔符',
  'crossRefs.show': ({ v }) => `显示：${v}`,
  'crossRefs.instruction': ({ inst }) => `指令：${inst}`,
  'crossRefs.target': '目标书签',
  'crossRefs.switches': '开关',

  // Shapes panel
  'shapes.title': '形状与图片锚点',
  'shapes.summary': '浮动图片定位',
  'shapes.type.rectangle': '矩形',
  'shapes.type.ellipse': '椭圆',
  'shapes.type.line': '线条',
  'shapes.type.freeform': '自由形状',
  'shapes.type.textbox': '文本框',
  'shapes.type.picture': '图片',
  'shapes.type.group': '组合',
  'shapes.type.unknown': '未知',
  'shapes.anchor.char': '字符',
  'shapes.anchor.paragraph': '段落',
  'shapes.anchor.page': '页面',
  'shapes.anchor.margin': '边距',
  'shapes.anchor.unknown': '未知',
  'shapes.floating': '浮动',
  'shapes.hasPicture': '含图片',
  'shapes.spid': ({ id }) => `形状 ID: ${id}`,
  'shapes.position': ({ x, y }) => `位置: (${x}, ${y}) twips`,
  'shapes.size': ({ w, h }) => `尺寸: ${w} × ${h} twips`,
  'shapes.anchorType': ({ type, cp }) => `锚点类型: ${type}${cp !== undefined ? ` (CP: ${cp})` : ''}`,
  'shapes.fcPic': ({ fc }) => `图片偏移 (fcPic): ${fc}`,
  'shapes.name': ({ name }) => `名称: ${name}`,
  'shapes.groupId': ({ id }) => `组合 ID: ${id}`,

  // Equations panel
  'equations.title': '公式',
  'equations.summary': 'Equation Editor 公式',
  'equations.id': ({ id }) => `公式 ${id}`,
  'equations.hasPicture': '含图片',
  'equations.latex': 'LaTeX:',
  'equations.original': '原始:',

  // Charts panel
  'charts.title': '图表',
  'charts.summary': 'MSGraph/Excel/SmartArt 对象',
  'charts.id': ({ id }) => `图表 ${id}`,
  'charts.hasPicture': '含图片',
  'charts.hasData': '含数据',
  'charts.label.name': '名称:',
  'charts.label.subtype': '子类型:',
  'charts.label.dataSize': '数据大小:',
  'charts.type.msgraph': 'MSGraph',
  'charts.type.excel': 'Excel',
  'charts.type.smartart': 'SmartArt',
  'charts.type.oleobject': 'OLE 对象',
  'charts.type.chart': '图表',
  'charts.type.unknown': '未知',
  'charts.subtype.column': '柱状图',
  'charts.subtype.bar': '条形图',
  'charts.subtype.line': '折线图',
  'charts.subtype.pie': '饼图',
  'charts.subtype.area': '面积图',
  'charts.subtype.scatter': '散点图',
  'charts.subtype.doughnut': '环形图',
  'charts.subtype.radar': '雷达图',
  'charts.subtype.surface': '曲面图',
  'charts.subtype.bubble': '气泡图',
  'charts.subtype.stock': '股价图',
  'charts.subtype.cone': '圆锥图',
  'charts.subtype.cylinder': '圆柱图',
  'charts.subtype.pyramid': '棱锥图',
  'charts.subtype.orgchart': '组织结构图',
  'charts.subtype.process': '流程',
  'charts.subtype.cycle': '循环',
  'charts.subtype.hierarchy': '层次结构',
  'charts.subtype.matrix': '矩阵',
  'charts.subtype.relationship': '关系',
  'charts.subtype.list': '列表',
  'charts.subtype.picture': '图片',
  'charts.subtype.chart': '图表',
  'charts.subtype.unknown': '未知',

  // WordArt panel
  'wordart.title': '艺术字',
  'wordart.summary': 'Office Art WordArt 对象',
  'wordart.id': ({ id }) => `艺术字 ${id}`,
  'wordart.text': '文本:',
  'wordart.name': '名称:',
  'wordart.colors': '颜色:',
  'wordart.effect.gradient': '渐变',
  'wordart.effect.shadow': '阴影',
  'wordart.effect.emboss': '浮雕',
  'wordart.effect.bevel': '斜角',
  'wordart.effect.outline': '轮廓',
  'wordart.effect.fill': '填充',
  'wordart.effect.3d': '3D',
  'wordart.effect.rotate': '旋转',
  'wordart.effect.flip': '翻转',
  'wordart.effect.stretch': '拉伸',
  'wordart.effect.unknown': '未知',

  // Images panel
  'images.title': '文档图片',
  'images.summary': '点击展开查看嵌入图片',
  'images.alt': ({ n }) => `图片 ${n}`,
  'images.floating': '浮动',

  // Stats panel
  'stats.title': '文档统计',
  'stats.words': '字数',
  'stats.chars': '字符数',
  'stats.paragraphs': '段落',
  'stats.pages': '页数',
  'stats.images': '图片',
  'stats.tables': '表格',
  'stats.summary': ({ words, paras, pages }) => `${words} 字 · ${paras} 段 · ${pages} 页`,

  // Shortcuts panel
  'shortcuts.title': '快捷键',
  'shortcuts.close': '关闭快捷键面板',
  'shortcuts.help': '快捷键列表',
  'shortcuts.items': {
    'toggleShortcuts': '打开/关闭快捷键面板',
    'toggleSearch': '搜索文档',
    'nextMatch': '下一个匹配',
    'prevMatch': '上一个匹配',
    'closeSearch': '关闭搜索',
    'print': '打印 / 导出 PDF',
    'toggleOutline': '打开/关闭文档大纲',
    'toggleDarkMode': '切换亮色/暗色模式',
    'prevPage': '上一页',
    'nextPage': '下一页',
    'firstPage': '首页',
    'lastPage': '末页',
    'zoomIn': '放大',
    'zoomOut': '缩小',
    'zoomReset': '重置缩放',
    'focusContent': '聚焦文档内容',
    'closePanel': '关闭当前面板',
  } as Record<string, string>,

  // Textbox anchor
  'textbox.anchor': '文本框',
  'textbox.anchor.tooltip': ({ type, x, y, w, h, cp, spid }) =>
    `锚点: ${type}\n位置: (${x}, ${y}) twips\n尺寸: ${w} × ${h} twips\nCP: ${cp}\nSPID: ${spid}`,

  // Revision time format
  'revision.author.prefix': ({ i }) => `作者#${i}`,

  // Section
  'section.pageSize': ({ w, h }) => `${w} × ${h}`,
}

const en: Record<string, TransValue> = {
  // App
  'app.title': 'DOC File Online Preview',
  'app.desc': 'Upload or load a .doc file for online preview (frontend only)',
  'app.upload.area.title': 'Select or Drag & Drop DOC File',
  'app.upload.area.title.drag': 'Release to Preview',
  'app.upload.area.hint': 'Supports .doc / .dot files, up to 50MB',
  'app.upload.btn': 'Choose File',
  'app.upload.or': 'or',
  'app.upload.url.placeholder': 'Enter .doc file URL...',
  'app.upload.url.btn': 'Load',
  'app.upload.error.format': ({ ext }) => `Unsupported format ".${ext}". Please select a .doc or .dot file`,
  'app.upload.error.docx': '.docx format is not yet supported.\nThis tool is designed for legacy .doc (OLE2) format.\n.docx files require Microsoft Word or other compatible software.',
  'app.upload.error.size': ({ size, max }) => `File too large (${size}), max ${max}`,
  'app.back': '← Back',
  'app.theme.dark': 'Switch to dark mode',
  'app.theme.light': 'Switch to light mode',
  'app.font.on': 'Disable Web Font',
  'app.font.off': 'Enable Web Font',
  'app.reader.on': 'Exit reader mode',
  'app.reader.off': 'Reader mode',
  'app.lang.switch': 'Switch Language / 切换语言',

  // Loading / Error
  'loading.text': 'Parsing document...',
  'loading.size': ({ size }) => `Size: ${size}`,
  'loading.time': ({ sec }) => `Elapsed: ${sec}s`,
  'loading.worker': '⚡ Worker',
  'loading.progress.reading': 'Reading file...',
  'loading.progress.downloading': 'Downloading file...',
  'loading.progress.parsing': 'Parsing document structure...',
  'loading.progress.rendering': 'Rendering document content...',
  'error.render': ({ msg }) => `❌ Error rendering document\n\n${msg}`,
  'error.parse.fail': 'Parse failed',
  'error.parse.unknown': 'Unknown error',
  'error.load.url': ({ msg }) => `❌ Cannot load from URL\n\n${msg}\n\nPossible causes:\n• URL unreachable or expired\n• CORS restriction\n• Server returned error status`,
  'error.load.fail': ({ msg }) => `❌ Load failed\n\n${msg}`,
  'error.retry': 'Retry',
  'error.details': 'View technical details',

  // Toolbar
  'toolbar.zoom.in': 'Zoom in',
  'toolbar.zoom.out': 'Zoom out',
  'toolbar.zoom.reset': 'Reset zoom',
  'toolbar.zoom.reset.aria': 'Reset zoom to 100%',
  'toolbar.search': 'Search document',
  'toolbar.print': 'Print / Export PDF',
  'toolbar.download.txt': 'Download as text file',
  'toolbar.download.html': 'Download as HTML file',
  'toolbar.download.md': 'Download as Markdown file',
  'toolbar.copy': 'Copy text to clipboard',
  'toolbar.outline': 'Document outline',
  'toolbar.hidden.show': 'Hidden text: showing',
  'toolbar.hidden.hide': 'Hidden text: hidden',
  'toolbar.hidden.toggle': 'Toggle hidden text',
  'toolbar.theme': 'Toggle theme',
  'toolbar.shortcuts': 'Shortcuts',
  'toolbar.stats': 'Document statistics',
  'toolbar.internal.links': 'Internal link navigation',
  'toolbar.page.fields': 'Page field navigation',
  'toolbar.cross.refs': 'Cross-reference navigation',
  'toolbar.paginate': 'Pagination',

  // Search
  'search.placeholder': 'Search document content...',
  'search.no.results': 'No matches found',
  'search.results': ({ n }) => `Found ${n} matches`,
  'search.case': 'Case sensitive',
  'search.word': 'Whole word',

  // Pagination
  'pagination.prev': 'Previous page',
  'pagination.next': 'Next page',
  'pagination.page': ({ current, total }) => `${current} / ${total}`,

  // Doc status
  'doc.status.ok': '✓ Parse succeeded',
  'doc.status.empty': 'Document content is empty',

  // Outline
  'outline.header': 'Document Outline',

  // Stories panels
  'story.headers': 'Headers/Footers',
  'story.footnotes': 'Footnotes',
  'story.endnotes': 'Endnotes',
  'story.comments': 'Comments',
  'story.textboxes': 'Textboxes',
  'story.title': 'Non-body content',
  'story.headerParts.titleHeader': 'Title Page Header',
  'story.headerParts.titleFooter': 'Title Page Footer',
  'story.headerParts.oddHeader': 'Odd Page Header',
  'story.headerParts.oddFooter': 'Odd Page Footer',
  'story.headerParts.evenHeader': 'Even Page Header',
  'story.headerParts.evenFooter': 'Even Page Footer',
  'story.headerFallback': 'Headers/Footers',
  'story.image.caption': ({ fmt }) => `${fmt || 'Image'}`,

  // Properties panel
  'props.title': 'Document Properties',
  'props.docFields': 'Document Fields',
  'props.field.title': 'Title',
  'props.field.subject': 'Subject',
  'props.field.author': 'Author',
  'props.field.lastAuthor': 'Last Modified By',
  'props.field.keywords': 'Keywords',
  'props.field.comments': 'Comments',
  'props.field.lastSavedBy': 'Last Saved By',
  'props.field.created': 'Created',
  'props.field.lastSaved': 'Last Saved',
  'props.field.printed': 'Printed',
  'props.field.date': 'Date',
  'props.field.time': 'Time',
  'props.field.revision': 'Revision Number',
  'props.pages': 'Pages',
  'props.words': 'Words',
  'props.chars': 'Characters',
  'props.category': 'Category',
  'props.company': 'Company',
  'props.manager': 'Manager',
  'props.template': 'Template',
  'props.styleSet': 'Style Set',
  'props.styleSet.custom': ' (Custom)',
  'props.appName': 'Application',
  'props.wordVersion': 'Word Version',
  'props.revisionNumber': 'Revision Number',
  'props.lines': 'Lines',
  'props.paragraphs': 'Paragraphs',
  'props.charsWithSpaces': 'Chars (w/ spaces)',

  // Doc flags
  'flags.title': 'Document Flags',
  'flags.facingPages': 'Different odd/even pages',
  'flags.facingPages.desc': 'fFacingPages — odd and even pages have different headers/footers',
  'flags.titlePage': 'Different first page',
  'flags.titlePage.desc': 'fTitlePage — first page has separate headers/footers',
  'flags.pmhMain': 'Has header',
  'flags.pmhMain.desc': 'fPMHMain — main document contains headers',
  'flags.trackChanges': 'Track changes',
  'flags.trackChanges.desc': 'fRMW — document has track changes enabled',
  'flags.ftnRestart': 'Footnote renumber',
  'flags.ftnRestart.desc': 'fFtnRestart — footnotes are renumbered per page or section',
  'flags.ftnEnd': 'Footnotes at section end',
  'flags.ftnEnd.desc': 'fFtnEnd — footnotes appear at end of each section',
  'flags.ftnAtEnd': 'Footnotes at document end',
  'flags.ftnAtEnd.desc': 'fFtnAtEnd — footnotes appear at end of document',
  'flags.items': ({ n }) => `${n} items`,

  // TOC panel
  'toc.title': 'Table of Contents',
  'toc.summary': 'Table of Contents',

  // Index panel
  'index.title': 'Index',
  'index.summary': 'Index Entries',

  // Revisions panel
  'revisions.title': 'Revisions',
  'revisions.marks': 'Show marks',
  'revisions.accept': 'Accept all',
  'revisions.reject': 'Reject all',
  'revisions.count': ({ n }) => `${n} changes`,
  'revisions.type.insert': 'Insert',
  'revisions.type.delete': 'Delete',
  'revisions.type.format': 'Format',
  'revisions.author.unknown': 'Unknown author',

  // Bookmarks panel
  'bookmarks.title': 'Bookmarks',
  'bookmarks.summary': 'Named ranges',

  // Sections panel
  'sections.title': 'Sections & Layout',
  'sections.summary': 'Paper / Margins / Orientation / Columns',
  'sections.index': ({ n }) => `Section ${n + 1}`,
  'sections.pageSize': 'Page Size',
  'sections.marginLeft': 'Left Margin',
  'sections.marginRight': 'Right Margin',
  'sections.marginTop': 'Top Margin',
  'sections.marginBottom': 'Bottom Margin',
  'sections.gutter': 'Gutter',
  'sections.columns': 'Columns',
  'sections.columns.gap': ({ pt }) => `(gap ${pt})`,
  'sections.startPageNum': 'Start Page Number',
  'sections.break.nextPage': 'Next Page',
  'sections.break.oddPage': 'Odd Page',
  'sections.break.evenPage': 'Even Page',
  'sections.break.continuous': 'Continuous',
  'sections.orientation.landscape': 'Landscape',
  'sections.orientation.portrait': 'Portrait',

  // Page fields panel
  'pageFields.title': 'Page Fields',
  'pageFields.type.page': 'Current Page (PAGE)',
  'pageFields.type.numPages': 'Total Pages (NUMPAGES)',
  'pageFields.type.section': 'Current Section (SECTION)',
  'pageFields.type.sectionPages': 'Section Pages (SECTIONPAGES)',
  'pageFields.value': ({ v }) => `Value: ${v}`,
  'pageFields.instruction': ({ inst }) => `Instruction: ${inst}`,

  // Cross references panel
  'crossRefs.title': 'Cross References',
  'crossRefs.type.ref': 'Reference (REF)',
  'crossRefs.type.noteref': 'Footnote Ref (NOTEREF)',
  'crossRefs.switch.h': 'Hyperlink',
  'crossRefs.switch.n': 'Paragraph Number',
  'crossRefs.switch.r': 'Para Number (no separator)',
  'crossRefs.switch.w': 'Full Para Number',
  'crossRefs.switch.p': 'Relative Position (above/below)',
  'crossRefs.switch.f': 'Insert Reference Type',
  'crossRefs.switch.d': 'Separator',
  'crossRefs.show': ({ v }) => `Show: ${v}`,
  'crossRefs.instruction': ({ inst }) => `Instruction: ${inst}`,
  'crossRefs.target': 'Target Bookmark',
  'crossRefs.switches': 'Switches',

  // Shapes panel
  'shapes.title': 'Shapes & Image Anchors',
  'shapes.summary': 'Floating image positioning',
  'shapes.type.rectangle': 'Rectangle',
  'shapes.type.ellipse': 'Ellipse',
  'shapes.type.line': 'Line',
  'shapes.type.freeform': 'Freeform',
  'shapes.type.textbox': 'Textbox',
  'shapes.type.picture': 'Picture',
  'shapes.type.group': 'Group',
  'shapes.type.unknown': 'Unknown',
  'shapes.anchor.char': 'Character',
  'shapes.anchor.paragraph': 'Paragraph',
  'shapes.anchor.page': 'Page',
  'shapes.anchor.margin': 'Margin',
  'shapes.anchor.unknown': 'Unknown',
  'shapes.floating': 'Floating',
  'shapes.hasPicture': 'Has Image',
  'shapes.spid': ({ id }) => `Shape ID: ${id}`,
  'shapes.position': ({ x, y }) => `Position: (${x}, ${y}) twips`,
  'shapes.size': ({ w, h }) => `Size: ${w} × ${h} twips`,
  'shapes.anchorType': ({ type, cp }) => `Anchor type: ${type}${cp !== undefined ? ` (CP: ${cp})` : ''}`,
  'shapes.fcPic': ({ fc }) => `Image offset (fcPic): ${fc}`,
  'shapes.name': ({ name }) => `Name: ${name}`,
  'shapes.groupId': ({ id }) => `Group ID: ${id}`,

  // Equations panel
  'equations.title': 'Equations',
  'equations.summary': 'Equation Editor formulas',
  'equations.id': ({ id }) => `Equation ${id}`,
  'equations.hasPicture': 'Has Picture',
  'equations.latex': 'LaTeX:',
  'equations.original': 'Original:',

  // Charts panel
  'charts.title': 'Charts',
  'charts.summary': 'MSGraph/Excel/SmartArt objects',
  'charts.id': ({ id }) => `Chart ${id}`,
  'charts.hasPicture': 'Has Picture',
  'charts.hasData': 'Has Data',
  'charts.label.name': 'Name:',
  'charts.label.subtype': 'Subtype:',
  'charts.label.dataSize': 'Data Size:',
  'charts.type.msgraph': 'MSGraph',
  'charts.type.excel': 'Excel',
  'charts.type.smartart': 'SmartArt',
  'charts.type.oleobject': 'OLE Object',
  'charts.type.chart': 'Chart',
  'charts.type.unknown': 'Unknown',
  'charts.subtype.column': 'Column',
  'charts.subtype.bar': 'Bar',
  'charts.subtype.line': 'Line',
  'charts.subtype.pie': 'Pie',
  'charts.subtype.area': 'Area',
  'charts.subtype.scatter': 'Scatter',
  'charts.subtype.doughnut': 'Doughnut',
  'charts.subtype.radar': 'Radar',
  'charts.subtype.surface': 'Surface',
  'charts.subtype.bubble': 'Bubble',
  'charts.subtype.stock': 'Stock',
  'charts.subtype.cone': 'Cone',
  'charts.subtype.cylinder': 'Cylinder',
  'charts.subtype.pyramid': 'Pyramid',
  'charts.subtype.orgchart': 'Organizational Chart',
  'charts.subtype.process': 'Process',
  'charts.subtype.cycle': 'Cycle',
  'charts.subtype.hierarchy': 'Hierarchy',
  'charts.subtype.matrix': 'Matrix',
  'charts.subtype.relationship': 'Relationship',
  'charts.subtype.list': 'List',
  'charts.subtype.picture': 'Picture',
  'charts.subtype.chart': 'Chart',
  'charts.subtype.unknown': 'Unknown',

  // WordArt panel
  'wordart.title': 'WordArt',
  'wordart.summary': 'Office Art WordArt objects',
  'wordart.id': ({ id }) => `WordArt ${id}`,
  'wordart.text': 'Text:',
  'wordart.name': 'Name:',
  'wordart.colors': 'Colors:',
  'wordart.effect.gradient': 'Gradient',
  'wordart.effect.shadow': 'Shadow',
  'wordart.effect.emboss': 'Emboss',
  'wordart.effect.bevel': 'Bevel',
  'wordart.effect.outline': 'Outline',
  'wordart.effect.fill': 'Fill',
  'wordart.effect.3d': '3D',
  'wordart.effect.rotate': 'Rotate',
  'wordart.effect.flip': 'Flip',
  'wordart.effect.stretch': 'Stretch',
  'wordart.effect.unknown': 'Unknown',

  // Images panel
  'images.title': 'Images',
  'images.summary': 'Click to view embedded images',
  'images.alt': ({ n }) => `Image ${n}`,
  'images.floating': 'Floating',

  // Stats panel
  'stats.title': 'Document Statistics',
  'stats.words': 'Words',
  'stats.chars': 'Characters',
  'stats.paragraphs': 'Paragraphs',
  'stats.pages': 'Pages',
  'stats.images': 'Images',
  'stats.tables': 'Tables',
  'stats.summary': ({ words, paras, pages }) => `${words} words · ${paras} paras · ${pages} pages`,

  // Shortcuts panel
  'shortcuts.title': 'Keyboard Shortcuts',
  'shortcuts.close': 'Close shortcuts panel',
  'shortcuts.help': 'Shortcuts List',
  'shortcuts.items': {
    'toggleShortcuts': 'Toggle shortcuts panel',
    'toggleSearch': 'Search document',
    'nextMatch': 'Next match',
    'prevMatch': 'Previous match',
    'closeSearch': 'Close search',
    'print': 'Print / Export PDF',
    'toggleOutline': 'Toggle document outline',
    'toggleDarkMode': 'Toggle dark/light mode',
    'prevPage': 'Previous page',
    'nextPage': 'Next page',
    'firstPage': 'First page',
    'lastPage': 'Last page',
    'zoomIn': 'Zoom in',
    'zoomOut': 'Zoom out',
    'zoomReset': 'Reset zoom',
    'focusContent': 'Focus document content',
    'closePanel': 'Close current panel',
  } as Record<string, string>,

  // Textbox anchor
  'textbox.anchor': 'Textbox',
  'textbox.anchor.tooltip': ({ type, x, y, w, h, cp, spid }) =>
    `Anchor: ${type}\nPosition: (${x}, ${y}) twips\nSize: ${w} × ${h} twips\nCP: ${cp}\nSPID: ${spid}`,

  // Revision time format
  'revision.author.prefix': ({ i }) => `Author #${i}`,

  // Section
  'section.pageSize': ({ w, h }) => `${w} × ${h}`,
}

const translations: Record<Locale, Record<string, TransValue>> = { 'zh-CN': zh, en }

export function t(key: string, params?: Record<string, any>): string {
  const locale = _locale.value
  const value = translations[locale]?.[key]
  if (value === undefined) return key
  if (typeof value === 'function') {
    return value(params || {})
  }
  if (typeof value === 'string') {
    if (params) {
      let result = value as string
      for (const [k, v] of Object.entries(params)) {
        result = result.replace(`{${k}}`, String(v))
      }
      return result
    }
    return value
  }
  // Record<string, string> type (nested object like shortcuts.items) - not directly translatable via t()
  return key
}

export function tMap(keyPrefix: string, subKey: string): string {
  const locale = _locale.value
  const map = translations[locale]?.[keyPrefix] as Record<string, string> | undefined
  if (map && map[subKey] !== undefined) return map[subKey]
  return subKey
}
