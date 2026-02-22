# Sidebar Navigation Redesign

**Ticket:** MOL-14
**Date:** 2026-02-22
**Status:** Design approved

## Summary

Move navigation and filters from the top bar into a left sidebar. Mobile gets a hamburger drawer for nav, with filters remaining inline above cards.

## Desktop Layout (≥768px)

```
┌──────────┬─────────────────────────────┐
│  Logo    │  [Search bar.............]  │
│          │                             │
│  Nav     │  ┌─────────────────────┐    │
│  --------│  │  Card               │    │
│  Home    │  └─────────────────────┘    │
│  Contain.│  ┌─────────────────────┐    │
│  Settings│  │  Card               │    │
│  Admin   │  └─────────────────────┘    │
│          │                             │
│  Filters │                             │
│  --------│                             │
│  Contain.│                             │
│  Project │                             │
│  Domain  │                             │
│  Type    │                             │
│  Status  │                             │
│          │                             │
│  --------│                             │
│  12 items│                             │
│          │                             │
│  Theme ☀ │                             │
│  Logout  │                             │
└──────────┴─────────────────────────────┘
```

- Sidebar: ~220px wide, fixed position, separated by 1px border
- Same background as page (subtle, not distinct)
- Main content fills remaining width, scrolls independently
- Search bar at top of main content area

## Mobile Layout (<768px)

```
┌─────────────────────────────┐
│  ☰  Logo        [Search..] │
│                             │
│  [Container▾] [Project▾]   │
│  [Domain▾] [Type▾] [Stat▾] │
│  12 items                   │
│                             │
│  ┌─────────────────────┐    │
│  │  Card               │    │
│  └─────────────────────┘    │
└─────────────────────────────┘
```

- Hamburger icon slides in a drawer from the left
- Drawer contains: logo, nav links, theme toggle, logout
- Dimmed backdrop, tap to close
- Filters stay inline above cards (horizontal wrapping)

## Files

### New
- `src/components/Sidebar.tsx` — Nav links + filters + theme toggle + logout. Visible desktop only via CSS.
- `src/components/MobileDrawer.tsx` — Hamburger button + slide-out overlay with nav + theme toggle + logout. Visible mobile only via CSS.

### Modified
- `src/app/page.tsx` — Replace `<header>` + `<FilterBar>` with `<Sidebar>` / `<MobileDrawer>`. Search moves to content header. FilterBar renders inline on mobile.
- `src/app/page.module.css` — Sidebar layout grid, mobile breakpoints. Card styles untouched.
- `src/components/FilterBar.tsx` — No logic changes. Used inside Sidebar (desktop) and inline (mobile).

### Untouched
- `src/components/ItemCard.tsx`
- `src/components/ThemeToggle.tsx`
- All API routes
- All other pages (login, admin, settings, containers)

## Implementation Steps

1. Create `Sidebar.tsx` — nav links, filter dropdowns, theme toggle, logout, item count
2. Create `MobileDrawer.tsx` — hamburger button, slide-out drawer, dimmed backdrop
3. Update `page.module.css` — sidebar + main content grid layout, mobile breakpoint
4. Update `page.tsx` — wire Sidebar/MobileDrawer, move search to content header, keep FilterBar for mobile
5. Verify mobile responsiveness
6. Verify desktop layout
