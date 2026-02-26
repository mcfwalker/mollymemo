# Visual Refresh

**Date:** 2026-02-26
**Status:** Draft
**Feature:** #4
**Theme:** Design & UX

## Problem

MollyMemo's UI was built quickly during v0.1 development. It's functional but visually plain — default spacing, no typographic hierarchy, and a generic color palette. Needs a polish pass to feel intentional and cohesive without a full redesign.

## Approach

Targeted refresh of the existing design language. Keep the current layout structure (card list, sidebar nav on mobile, etc.) but update:

- **Typography** — Better font choices, size scale, weight hierarchy
- **Spacing** — Consistent spacing system (4/8/12/16/24/32px scale)
- **Color palette** — More refined palette with better contrast ratios
- **Card design** — Subtle improvements to card styling, shadows, hover states
- **Navigation** — Polish the nav bar/mobile drawer
- **Micro-interactions** — Smoother transitions, better loading states

### What's NOT in scope

- Layout restructuring
- New pages (that's covered by Trend Reports feature)
- Component library extraction
- Dark mode (already works via CSS variables)

## Tasks

1. Audit current CSS variables and establish design tokens
2. Select and integrate typography (font stack, size scale, weight hierarchy)
3. Refine color palette and update CSS variables
4. Polish card component styling (shadows, borders, hover, radius)
5. Update spacing across all pages to consistent scale
6. Polish navigation bar and mobile drawer
7. Improve loading states and transitions
8. Cross-browser and mobile responsive verification
