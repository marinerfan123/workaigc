# 东方古典美人承接页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/` render the reference landing page for “东方古典美人 · 创作工作台” instead of the unrelated generic “墨灵AI” page.

**Architecture:** Keep the existing `LandingPage` route and authentication entry points. Replace only the page component with the existing reference-aligned implementation in `LandingPage.tsx.bak`, preserving route navigation to the workspace, studio, shop, library, characters, and model hub. Validate the result through the Vite build and the live 5173 browser page.

**Tech Stack:** React 19, TypeScript, React Router, lucide-react, Tailwind utility classes, Vite.

## Global Constraints

- Interface language is Chinese.
- Use the pure-black, dark, grid-based visual direction from the supplied reference images.
- Keep the landing page scoped to the landing page and do not change the existing application routes.
- Keep authentication behavior: unauthenticated CTA opens the existing auth modal; authenticated CTA navigates to `/workspace`.

---

### Task 1: Restore The Reference Landing Page

**Files:**
- Modify: `src/pages/LandingPage/LandingPage.tsx`
- Reference: `src/pages/LandingPage/LandingPage.tsx.bak`

- [ ] Replace the generic landing page implementation with the reference-aligned component containing the reference brand, hero copy, five-stage creation pipeline, open capability cards, and final CTA.
- [ ] Preserve existing auth and navigation wiring in the restored component.

### Task 2: Verify The User-Facing Result

**Files:**
- No additional files.

- [ ] Run `npm run build` and confirm Vite exits with code 0.
- [ ] Request `http://127.0.0.1:5173/` and confirm status 200.
- [ ] Inspect the live browser DOM for `东方古典美人`, `从点子到剧集`, `整个计划：创意生产流水线`, and `现已开放的能力`.
- [ ] Capture a desktop and narrow viewport screenshot to confirm the first viewport is the reference page and remains readable on mobile.
