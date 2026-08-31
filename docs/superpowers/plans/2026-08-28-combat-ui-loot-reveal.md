# Combat UI and Loot Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move squad health/name displays onto their stage actors and add simultaneous rarity-timed loot-search reveals.

**Architecture:** The header stops rendering squad health. Stage rendering gains pure markup/timing helpers so actor nameplates and loot slots can be tested without a browser DOM. Crate loot is rolled when scavenging begins, stored on the serializable node, visually revealed by rarity, and committed to carry only when scavenging finishes.

**Tech Stack:** Vanilla JavaScript ES modules, CSS animations, Node test runner.

**Spec:** User-approved conversation design on 2026-08-28.

## Global Constraints

- Multiple loot slots search simultaneously.
- Higher rarity must take longer to reveal.
- Loot enters carry only after scavenging completes.
- Existing external-image-ready `itemArt` rendering must be reused.

---

### Task 1: Squad nameplates on actors

**Files:**
- Modify: `js/ui/explore/panel.js`
- Modify: `js/ui/explore/stage.js`
- Modify: `css/stage.css`
- Test: `tests/exploreStage.test.mjs`

**Interfaces:**
- Produces: `actorMarkup(operator, member, action)` returning stage actor HTML.

- [ ] Write tests asserting the header omits squad health and actor markup includes the member name, health ratio, and downed state.
- [ ] Run `node --test tests/exploreStage.test.mjs` and verify failure because the old header contains squad health and `actorMarkup` is absent.
- [ ] Remove header health rendering and implement the actor wrapper/nameplate markup and CSS.
- [ ] Run `node --test tests/exploreStage.test.mjs` and verify pass.
- [ ] Commit the independently working actor-health change.

### Task 2: Simultaneous rarity-timed loot reveal

**Files:**
- Modify: `js/systems/march.js`
- Modify: `js/ui/explore/stage.js`
- Modify: `css/stage.css`
- Test: `tests/exploreStage.test.mjs`
- Test: `tests/marchLootReveal.test.mjs`

**Interfaces:**
- Produces: `lootRevealAt(rarity)` returning a phase progress threshold from 0 to 1.
- Produces: `lootSearchMarkup(items, progress)` returning masked/revealed slot markup.
- Consumes: `itemArt(item, { size: 'sm' })` for revealed icons.

- [ ] Write tests proving rarity thresholds increase from common through red and unrevealed slots contain a magnifier while revealed slots contain item art.
- [ ] Run the focused tests and verify they fail because the reveal helpers do not exist.
- [ ] Implement reveal helpers, stage updates, and search-grid CSS.
- [ ] Write a failing integration test proving pending crate loot is reused at completion instead of rerolled.
- [ ] Pre-roll and store loot on the crate node; consume that list only at completion.
- [ ] Run all tests and verify pass.
- [ ] Commit the loot-search change.

### Task 3: Final verification and delivery

**Files:**
- Create: root-only update ZIP containing modified production and test files.

**Interfaces:**
- Produces: a GitHub-web-upload-ready archive.

- [ ] Run `node --test tests/*.test.mjs`.
- [ ] Run syntax checks for changed JavaScript modules and `git diff --check`.
- [ ] Review the final diff against every approved requirement.
- [ ] Package only root-relative changed files for GitHub web upload.
