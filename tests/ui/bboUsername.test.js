import { describe, expect, it } from 'vitest'
import { findBboUsername } from '../../src/ui/bboLobbyContent.js'

// A name tag as BBO's current (MDC) Angular Material renders it, including the
// <style> BBO puts inside it, which is why textContent will not do.
const tag = (name, labelClass = 'mdc-button__label') => `
  <name-tag class="nameTagClass"><button class="nameTagClass mdc-button">
    <span class="mdc-button__ripple"></span>
    <span class="${labelClass}"> ${name} <style>.level { stroke-width: 2px; paint-order: stroke fill; }</style>
      <div class="badgeContainer"><img src=""></div></span>
  </button></name-tag>`

// The shape seen on 18 Nov 2026: 54 name tags, the user's in the top bar, the
// rest History hosts and Who's Online players. The decoys come first here, so
// a "first name-tag" rule fails this test.
function page({ navBar = tag('kemistry'), labelClass } = {}) {
  document.body.innerHTML = `
    <div id="bbo_app"><app-root><div id="bbo_everything"><in-house-router-entry>
      <div class="everythingClass">
        <div id="rightDiv"><whos-online-screen><user-list><user-list-item>
          <div class="itemClass"><div class="nonProfileImageDivClass">${tag('aam135')}</div></div>
        </user-list-item></user-list></whos-online-screen>
        <historic-tournament-list><historic-tournament-list-item>${tag('ACBL')}</historic-tournament-list-item></historic-tournament-list></div>
        <nav-bar class="nowWeUseTailwind"><div class="navBarClass">
          <div class="logoutBlock">${labelClass ? navBar.replace('mdc-button__label', labelClass) : navBar}</div>
        </div></nav-bar>
      </div>
    </in-house-router-entry></div></app-root></div>`
  return document
}

describe('findBboUsername', () => {
  it("reads the top bar's name tag, not a host's or another player's", () => {
    expect(findBboUsername(page())).toBe('kemistry')
  })

  it('reads the name and not the <style> inside the tag', () => {
    expect(findBboUsername(page({ navBar: tag('goldy hunt') }))).toBe('goldy hunt')
  })

  it('still reads the older Angular Material markup', () => {
    expect(findBboUsername(page({ labelClass: 'mat-button-wrapper' }))).toBe('kemistry')
  })

  it('is null when the top bar has no name tag (signed out), rather than taking another', () => {
    expect(findBboUsername(page({ navBar: '' }))).toBeNull()
  })
})
