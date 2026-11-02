// "Hide / Show Bridge Craftwork DD", on the top level of the deal menu in BBO's
// History panel — beside BBO's own "Show double dummy", where someone looking
// for a way to turn the marks off would look.
//
// The same approach as Fetch's Export ▸ Bridge Classroom item
// (src/ui/bboLobbyContent.js, syncDealMenuItem), for the same reasons: the menu
// is found by what it contains, because its class names several menus; our row
// is a clone of one of BBO's so Angular's scoped styles apply; and it is
// re-synced on every mutation, because BBO reuses one container for both menu
// levels and only manages the rows it made.

export const TOGGLE_ITEM_ID = 'bridge-craftwork-dd-toggle'
export const ENABLED_KEY = 'dd-overlay-enabled'

// BBO's menu highlight, from its stylesheet (see bboLobbyContent.js).
const MENU_HOVER_COLOR = 'rgb(255, 206, 0)'

/** The deal menu's top level, while it is open: the one visible menu holding
 *  both "Show double dummy" and "Export". The Export submenu holds neither. */
export function findDealMenu(doc, isVisible = (menu) => menu.offsetParent !== null) {
  return (
    [...doc.querySelectorAll('.menuClass')].find((menu) => {
      if (!isVisible(menu)) return false
      const labels = [...menu.children].map((item) => item.textContent.trim())
      return labels.includes('Export') && labels.some((t) => /double dummy/i.test(t))
    }) ?? null
  )
}

export function toggleLabel(enabled) {
  return `${enabled ? 'Hide' : 'Show'} Bridge Craftwork DD`
}

/** Put our row on the deal menu's top level, labelled for the current state,
 *  and nowhere else. Idempotent. */
export function syncToggleItem(doc, enabled, onToggle, isVisible) {
  const menu = findDealMenu(doc, isVisible)
  const existing = doc.getElementById(TOGGLE_ITEM_ID)
  if (!menu) {
    existing?.remove()
    return null
  }
  if (existing && existing.parentElement === menu) {
    const label = existing.querySelector('div') ?? existing
    if (label.textContent !== toggleLabel(enabled)) label.textContent = toggleLabel(enabled)
    return existing
  }
  existing?.remove()

  const template = menu.querySelector('menu-item')
  if (!template) return null
  const item = template.cloneNode(true)
  item.id = TOGGLE_ITEM_ID
  const label = item.querySelector('div') ?? item
  label.textContent = toggleLabel(enabled)
  const base = label.style.backgroundColor
  label.addEventListener('mouseenter', () => {
    label.style.backgroundColor = MENU_HOVER_COLOR
  })
  label.addEventListener('mouseleave', () => {
    label.style.backgroundColor = base
  })
  label.addEventListener('click', (event) => {
    event.stopPropagation()
    onToggle()
  })
  menu.appendChild(item)
  return item
}
