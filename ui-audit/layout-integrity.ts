export type LayoutIssue = { kind: string; target: string; text?: string; detail?: string };

// Runs in the rendered document. Word ranges catch cuts that scrollWidth misses:
// a button can grow taller and still split "Sebelumnya" into two pieces.
export function inspectLayout(): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const dialog = document.querySelector('dialog[open]');
  const scope = dialog ?? document.body;
  const selector = (element: Element) => element.id ? `#${element.id}`
    : element.tagName.toLowerCase() + [...element.classList].slice(0, 3).map(name => '.' + name).join('');
  const shown = (element: Element) => {
    const style = getComputedStyle(element), box = element.getBoundingClientRect();
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const a = getComputedStyle(ancestor), r = ancestor.getBoundingClientRect();
      if (a.clipPath === 'inset(50%)' || r.width <= 1 && r.height <= 1 && a.overflow === 'hidden') return false;
    }
    return element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }) && box.width > 1 && box.height > 1
      && style.clipPath !== 'inset(50%)';
  };
  if (document.documentElement.scrollWidth > innerWidth + 1) issues.push({ kind: 'document-overflow', target: 'html', detail: `${document.documentElement.scrollWidth}>${innerWidth}` });
  const icons = [...scope.querySelectorAll('svg,.mgmt-tile,.admin-tile,.ts-icon-tile,.project-icon,.ceo-icon-tile,.dashboard-team-icon,.dashboard-project-icon,.dashboard-open-icon,.auth-intro-icon,.registration-intro-icon,.registration-status-icon,.superadmin-shield')].filter(shown).map(element => ({ element, box: element.getBoundingClientRect() }));
  for (const tile of icons.filter(({ element }) => !element.matches('svg'))) {
    const token = getComputedStyle(tile.element).getPropertyValue('--tile-size').trim();
    const size = parseFloat(token) * (token.endsWith('rem') ? parseFloat(getComputedStyle(document.documentElement).fontSize) : 1);
    if (Math.abs(tile.box.width - size) > 1 || Math.abs(tile.box.height - size) > 1) {
      issues.push({ kind: 'distorted-tile', target: selector(tile.element), detail: `${tile.box.width}×${tile.box.height}, expected ${size}` });
    }
  }
  const fields = [...scope.querySelectorAll('input,select,textarea')].filter(shown).map(element => ({ element, box: element.getBoundingClientRect() }));
  for (const field of fields) {
    const style = getComputedStyle(field.element), box = field.box;
    const left = box.left + parseFloat(style.paddingLeft), right = box.right - parseFloat(style.paddingRight);
    for (const icon of icons) {
      if (!icon.element.matches('svg') || icon.element.parentElement !== field.element.parentElement) continue;
      const i = icon.box;
      if (Math.min(right, i.right) - Math.max(left, i.left) > 2 && Math.min(box.bottom, i.bottom) - Math.max(box.top, i.top) > 2) {
        issues.push({ kind: 'field-icon-in-text-area', target: selector(field.element), detail: selector(icon.element) });
      }
    }
  }
  for (const brand of [...scope.querySelectorAll('.brand')].filter(shown)) {
    const b = brand.getBoundingClientRect();
    for (const icon of icons) {
      if (brand.contains(icon.element)) continue;
      const i = icon.box;
      if (Math.min(b.right, i.right) - Math.max(b.left, i.left) > 2 && Math.min(b.bottom, i.bottom) - Math.max(b.top, i.top) > 2) {
        issues.push({ kind: 'brand-icon-overlap', target: selector(brand), detail: selector(icon.element) });
      }
    }
  }
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const textEntries: { parent: HTMLElement; rect: DOMRect; text: string; nav: boolean }[] = [];
  const textCells = new Map<string, number[]>();
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || !shown(parent) || parent.closest('svg,script,style,option,.skip-link') || !node.textContent?.trim()) continue;
    const text = node.textContent;
    // Addresses, URLs and opaque identifiers may wrap within a token; normal
    // words, headings and action labels must wrap only between words.
    for (const token of text.matchAll(/\S+/gu)) {
      if (/@|https?:|[0-9a-f]{8}-[0-9a-f]{4}-/i.test(token[0])) continue;
      for (const word of token[0].matchAll(/\p{L}{2,}/gu)) {
        const start = token.index! + word.index!;
        const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + word[0].length);
        const lines = new Set([...range.getClientRects()].filter(r => r.width > .5).map(r => Math.round(r.top)));
        if (lines.size > 1) issues.push({ kind: 'split-word', target: selector(parent), text: word[0] });
      }
    }
    const range = document.createRange(); range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter(r => r.width > 1 && r.height > 1);
    for (const field of fields) {
      if (field.element.contains(parent)) continue;
      if (Boolean(field.element.closest('nav,[role="navigation"]')) !== Boolean(parent.closest('nav,[role="navigation"]'))) continue;
      // Noninteractive absolute labels deliberately replace transparent native
      // field text. Their icon clearance and clipping are still inspected.
      let intentionalOverlay = false;
      if (field.element.parentElement?.contains(parent)) for (let element: Element | null = parent; element && element !== field.element.parentElement; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (style.position === 'absolute' && style.pointerEvents === 'none') intentionalOverlay = true;
      }
      if (intentionalOverlay) continue;
      const box = field.box;
      if (rects.some(r => Math.min(r.right, box.right) - Math.max(r.left, box.left) > 2
        && Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top) > 2)) {
        issues.push({ kind: 'text-field-overlap', target: selector(parent), text: text.trim().slice(0, 80), detail: selector(field.element) });
      }
    }
    for (const icon of icons) {
      if (icon.element.contains(parent)) continue;
      if (Boolean(icon.element.closest('nav,[role="navigation"]')) !== Boolean(parent.closest('nav,[role="navigation"]'))) continue;
      const i = icon.box;
      if (rects.some(r => Math.min(r.right, i.right) - Math.max(r.left, i.left) > 2 && Math.min(r.bottom, i.bottom) - Math.max(r.top, i.top) > 2)) {
        issues.push({ kind: 'text-icon-overlap', target: selector(parent), text: text.trim().slice(0, 80), detail: selector(icon.element) });
      }
    }
    const nav = Boolean(parent.closest('nav,[role="navigation"]'));
    for (const rect of rects) {
      const cells: string[] = [], candidates = new Set<number>();
      for (let x = Math.floor(rect.left / 64); x <= Math.floor(rect.right / 64); x++) {
        for (let y = Math.floor(rect.top / 64); y <= Math.floor(rect.bottom / 64); y++) {
          const key = `${x},${y}`; cells.push(key);
          for (const id of textCells.get(key) ?? []) candidates.add(id);
        }
      }
      for (const id of candidates) {
        const other = textEntries[id];
        if (nav !== other.nav || parent === other.parent || parent.contains(other.parent) || other.parent.contains(parent)) continue;
        if (Math.min(rect.right, other.rect.right) - Math.max(rect.left, other.rect.left) > 2
          && Math.min(rect.bottom, other.rect.bottom) - Math.max(rect.top, other.rect.top) > 2) {
          issues.push({ kind: 'overlapping-text', target: selector(parent), text: text.trim().slice(0, 80), detail: other.text });
        }
      }
      const id = textEntries.push({ parent, rect, text: text.trim().slice(0, 80), nav }) - 1;
      for (const key of cells) { const values = textCells.get(key) ?? []; values.push(id); textCells.set(key, values); }
    }
    const control = parent.closest('button,a,summary,label');
    if (control) {
      const box = control.getBoundingClientRect();
      if (rects.some(r => r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1)) {
        issues.push({ kind: 'text-outside-control', target: selector(control), text: text.trim().slice(0, 80) });
      }
    }
    for (let ancestor: Element | null = parent; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect();
      const clipX = ['hidden', 'clip'].includes(style.overflowX), clipY = ['hidden', 'clip'].includes(style.overflowY);
      if (rects.some(r => clipX && (r.left < box.left - 1 || r.right > box.right + 1)
        || clipY && (r.top < box.top - 1 || r.bottom > box.bottom + 1))) {
        issues.push({ kind: 'clipped-text', target: selector(ancestor), text: text.trim().slice(0, 80) }); break;
      }
    }
  }
  const controls = [...scope.querySelectorAll('button,a,input,select,textarea')].filter(shown);
  for (const control of controls) {
    if (control.closest('nav,[role="navigation"]')) continue;
    const box = control.getBoundingClientRect();
    for (const sibling of controls) {
      if (control === sibling || control.contains(sibling) || sibling.contains(control) || control.compareDocumentPosition(sibling) & Node.DOCUMENT_POSITION_PRECEDING) continue;
      if (sibling.closest('nav,[role="navigation"]') || control.closest('label')?.contains(sibling) || sibling.closest('label')?.contains(control)) continue;
      const inputAdornment = control.matches('input') && sibling.matches('button') && control.parentElement === sibling.parentElement && getComputedStyle(sibling).position === 'absolute';
      if (inputAdornment) continue;
      const other = sibling.getBoundingClientRect();
      if (Math.min(box.right, other.right) - Math.max(box.left, other.left) > 2
        && Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 2) {
        issues.push({ kind: 'overlapping-controls', target: selector(control), detail: selector(sibling) });
      }
    }
  }
  const statusLabels = [...scope.querySelectorAll('.status-badge,.ts-status,.mgmt-badge,.ceo-status-name,.dashboard-stat > div > span,.mgmt-stat div > span,.admin-stat div > span')].filter(shown);
  for (let i = 0; i < statusLabels.length; i++) for (let j = i + 1; j < statusLabels.length; j++) {
    const left = statusLabels[i], right = statusLabels[j];
    if (left.contains(right) || right.contains(left)) continue;
    const a = left.getBoundingClientRect(), b = right.getBoundingClientRect();
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) {
      issues.push({ kind: 'overlapping-status-labels', target: selector(left), detail: selector(right) });
    }
  }
  for (const row of scope.querySelectorAll('.registration-actions')) {
    const actions = [...row.children].filter(shown).filter(el => el.matches('a,button'));
    if (actions.length === 2) {
      const [left, right] = actions.map(el => el.getBoundingClientRect());
      if (Math.abs(left.top - right.top) > 1 || Math.abs(left.height - right.height) > 1 || Math.abs(left.width - right.width) > 1 || right.left - left.right < 11) {
        issues.push({ kind: 'unequal-navigation-row', target: selector(row) });
      }
    }
  }
  for (const note of scope.querySelectorAll('.install-platforms + .registration-note')) {
    const previous = note.previousElementSibling!;
    const gap = note.getBoundingClientRect().top - previous.getBoundingClientRect().bottom;
    if (gap < 12) issues.push({ kind: 'touching-blocks', target: selector(note), detail: `gap=${gap}` });
  }
  return [...new Map(issues.map(issue => [JSON.stringify(issue), issue])).values()];
}
