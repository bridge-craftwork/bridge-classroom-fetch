import { describe, it, expect, beforeEach } from 'vitest'
import { findDealMenu, syncToggleItem, toggleLabel, TOGGLE_ITEM_ID } from '../../src/ui/ddMenu.js'

// The deal menu as captured from the live v3 client: its top level, and the
// Export submenu BBO swaps into the same container.
const ITEM = (text) =>
  `<menu-item class="ng-star-inserted"><div style="background-color: rgb(191, 214, 153); color: rgb(0, 0, 0); padding: 5px;">\n${text}\n</div></menu-item>`
const TOP = ['Pictures of cards', 'Advance card by card', 'Show double dummy', 'Export']
const EXPORT = ['LIN', 'PBN', 'Handviewer link', 'Image', 'Text', 'Copy']

let doc, menu
const visible = () => true
beforeEach(() => {
  doc = new DOMParser().parseFromString(
    `<body><div class="menuClass" style="display: block">${TOP.map(ITEM).join('')}</div></body>`,
    'text/html'
  )
  menu = doc.querySelector('.menuClass')
})

describe('the Show/Hide Bridge Craftwork DD item', () => {
  it("joins the deal menu's top level, after BBO's own rows", () => {
    const item = syncToggleItem(doc, true, () => {}, visible)
    expect(item.parentElement).toBe(menu)
    expect(menu.lastElementChild).toBe(item)
    expect(item.textContent).toBe('Hide Bridge Craftwork DD')
    // Cloned from BBO's row, so it carries BBO's styling.
    expect(item.querySelector('div').style.padding).toBe('5px')
  })

  it('says what clicking it will do, and calls back', () => {
    let clicks = 0
    syncToggleItem(doc, true, () => clicks++, visible)
    doc.getElementById(TOGGLE_ITEM_ID).querySelector('div').click()
    expect(clicks).toBe(1)
    syncToggleItem(doc, false, () => clicks++, visible)
    expect(doc.getElementById(TOGGLE_ITEM_ID).textContent).toBe(toggleLabel(false))
    expect(doc.querySelectorAll(`#${TOGGLE_ITEM_ID}`)).toHaveLength(1)
  })

  it('leaves when BBO swaps the container to the Export submenu', () => {
    syncToggleItem(doc, true, () => {}, visible)
    for (const row of [...menu.querySelectorAll('menu-item:not([id])')]) row.remove()
    menu.insertAdjacentHTML('afterbegin', EXPORT.map(ITEM).join(''))
    expect(findDealMenu(doc, visible)).toBeNull()
    syncToggleItem(doc, true, () => {}, visible)
    expect(doc.getElementById(TOGGLE_ITEM_ID)).toBeNull()
  })

  it('is not added to a menu that is closed', () => {
    syncToggleItem(doc, true, () => {}, () => false)
    expect(doc.getElementById(TOGGLE_ITEM_ID)).toBeNull()
  })
})
