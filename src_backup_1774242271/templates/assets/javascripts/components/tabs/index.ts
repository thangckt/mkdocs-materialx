/*
 * Copyright (c) 2016-2025 Martin Donath <martin.donath@squidfunk.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

import {
  Observable,
  Subject,
  defer,
  distinctUntilKeyChanged,
  finalize,
  map,
  of,
  switchMap,
  tap
} from "rxjs"

import { feature } from "~/_"
import {
  Viewport,
  watchElementSize,
  watchViewportAt
} from "~/browser"

import { Component } from "../_"
import { Header } from "../header"

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Navigation tabs
 */
export interface Tabs {
  hidden: boolean                      /* Navigation tabs are hidden */
}

/* ----------------------------------------------------------------------------
 * Helper types
 * ------------------------------------------------------------------------- */

/**
 * Watch options
 */
interface WatchOptions {
  viewport$: Observable<Viewport>      /* Viewport observable */
  header$: Observable<Header>          /* Header observable */
}

/**
 * Mount options
 */
interface MountOptions {
  viewport$: Observable<Viewport>      /* Viewport observable */
  header$: Observable<Header>          /* Header observable */
}

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Watch navigation tabs
 *
 * @param el - Navigation tabs element
 * @param options - Options
 *
 * @returns Navigation tabs observable
 */
export function watchTabs(
  el: HTMLElement, { viewport$, header$ }: WatchOptions
): Observable<Tabs> {
  const limit = feature("navigation.tabs.header") ? 60 : 10
  return watchElementSize(document.body)
    .pipe(
      switchMap(() => watchViewportAt(el, { header$, viewport$ })),
      map(({ offset: { y } }) => {
        return {
          hidden: y >= limit
        }
      }),
      distinctUntilKeyChanged("hidden")
    )
}

/**
 * Set up overflow dropdown for navigation tabs (mimic Chrome bookmarks bar).
 * Items that don't fit are hidden and shown in a fixed-position dropdown.
 *
 * @param el - Navigation tabs element (.md-tabs)
 */
function setupTabsOverflow(el: HTMLElement): void {
  const list = el.querySelector<HTMLElement>(".md-tabs__list")
  if (!list) return

  // Clip overflow so hidden items don't create a scrollbar.
  list.style.overflow = "clip"

  // Dropdown appended to <body> so it escapes every overflow/clip ancestor.
  const dropdown = document.createElement("ul")
  dropdown.className = "md-tabs__overflow-dropdown"
  dropdown.setAttribute("role", "menu")
  document.body.append(dropdown)

  const triggerLi = document.createElement("li")
  triggerLi.className = "md-tabs__item md-tabs__item--overflow"
  const triggerBtn = document.createElement("button")
  triggerBtn.type = "button"
  triggerBtn.className = "md-tabs__overflow-btn"
  triggerBtn.textContent = "\u00bb"
  triggerBtn.setAttribute("aria-label", "More tabs")
  triggerBtn.setAttribute("aria-haspopup", "true")
  triggerLi.append(triggerBtn)

  let isOpen = false

  const positionDropdown = (): void => {
    const r = triggerBtn.getBoundingClientRect()
    dropdown.style.top   = `${r.bottom}px`
    dropdown.style.right = `${window.innerWidth - r.right}px`
    dropdown.style.left  = "auto"
  }

  const openDropdown = (): void => {
    positionDropdown()
    dropdown.classList.add("md-tabs__overflow-dropdown--open")
    isOpen = true
    triggerBtn.setAttribute("aria-expanded", "true")
  }

  const closeDropdown = (): void => {
    dropdown.classList.remove("md-tabs__overflow-dropdown--open")
    isOpen = false
    triggerBtn.setAttribute("aria-expanded", "false")
  }

  triggerBtn.addEventListener("click", ev => {
    ev.stopPropagation()
    isOpen ? closeDropdown() : openDropdown()
  })
  document.addEventListener("click", ev => {
    if (isOpen && !dropdown.contains(ev.target as Node)) closeDropdown()
  })
  window.addEventListener("scroll",
    () => { if (isOpen) positionDropdown() }, { passive: true })
  window.addEventListener("resize",
    () => { if (isOpen) positionDropdown() }, { passive: true })

  const recalculate = (): void => {
    if (list.clientWidth === 0) return

    closeDropdown()
    dropdown.innerHTML = ""

    const items = Array.from(
      list.querySelectorAll<HTMLElement>(".md-tabs__item:not(.md-tabs__item--overflow)")
    )
    for (const item of items) item.hidden = false
    triggerLi.remove()

    const available = list.clientWidth
    const totalNeeded = items.reduce((sum, it) => sum + it.offsetWidth, 0)
    if (totalNeeded <= available) return

    list.append(triggerLi)
    let used = triggerLi.offsetWidth
    for (let i = 0; i < items.length; i++) {
      if (used + items[i].offsetWidth > available) {
        for (; i < items.length; i++) {
          items[i].hidden = true
          const clone = items[i].cloneNode(true) as HTMLElement
          clone.hidden = false
          clone.removeAttribute("aria-current")
          dropdown.append(clone)
        }
        break
      }
      used += items[i].offsetWidth
    }
    if (dropdown.childElementCount === 0) triggerLi.remove()
  }

  let rafId = 0
  const scheduleRecalc = (): void => {
    cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(recalculate)
  }

  new ResizeObserver(scheduleRecalc).observe(el)
  requestAnimationFrame(recalculate)
}

/**
 * Mount navigation tabs
 *
 * This function hides the navigation tabs when scrolling past the threshold
 * and makes them reappear in a nice CSS animation when scrolling back up.
 *
 * @param el - Navigation tabs element
 * @param options - Options
 *
 * @returns Navigation tabs component observable
 */
export function mountTabs(
  el: HTMLElement, options: MountOptions
): Observable<Component<Tabs>> {
  setupTabsOverflow(el)
  return defer(() => {
    const push$ = new Subject<Tabs>()
    push$.subscribe({

      /* Handle emission */
      next({ hidden }) {
        el.hidden = hidden
      },

      /* Handle complete */
      complete() {
        el.hidden = false
      }
    })

    /* Create and return component */
    return (
      feature("navigation.tabs.sticky") || feature("navigation.tabs.header")
        ? of({ hidden: false })
        : watchTabs(el, options)
    )
      .pipe(
        tap(state => push$.next(state)),
        finalize(() => push$.complete()),
        map(state => ({ ref: el, ...state }))
      )
  })
}
