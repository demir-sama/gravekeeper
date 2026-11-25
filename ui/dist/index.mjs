import { jsxs as a, Fragment as k, jsx as r } from "react/jsx-runtime";
import { useAppApi as u } from "@kirocrew/app-sdk";
import { PageHeader as f } from "@kirocrew/app-sdk/ui";
import { useState as h, useCallback as v, useEffect as b } from "react";
const x = { tombstone: "Tombstone", ghost: "Ghost", zombie: "Zombie" }, w = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, y = `
.gk { --ink:#ece7dc; --dim:#a9a5b8; --bg:#14162a; --card:#1c1f38; --line:#343859; --lantern:#f5b94a; --ok:#7fd17a; --warn:#f0b64a; --bad:#ff7b6b;
  color:var(--ink); background:var(--bg); border-radius:14px; padding:20px; font-size:14px; line-height:1.5 }
.gk a { color:var(--lantern); text-underline-offset:3px }
.gk a:focus-visible, .gk summary:focus-visible, .gk button:focus-visible { outline:3px solid var(--lantern); outline-offset:3px; border-radius:4px }
.gk-intro { color:var(--dim); margin:0 0 18px; max-width:62ch }
.gk-lantern { display:inline-block; animation:gk-flicker 4s ease-in-out infinite }
@media (prefers-reduced-motion: reduce) { .gk-lantern { animation:none } }
@keyframes gk-flicker { 0%,100% { opacity:1 } 45% { opacity:.82 } 60% { opacity:.95 } }
.gk-grid { display:grid; gap:16px; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); list-style:none; margin:0; padding:0 }
.gk-card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; height:100% }
.gk-card h2 { font-size:16px; margin:0 0 2px; font-weight:600; overflow-wrap:anywhere }
.gk-card h2 a { color:var(--ink) }
.gk-meta { color:var(--dim); font-size:12px; margin:0 0 12px }
.gk-row { display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-bottom:12px }
.gk-score { font-size:34px; font-weight:700; line-height:1; font-variant-numeric:tabular-nums }
.gk-score small { font-size:12px; font-weight:500; color:var(--dim); margin-left:4px }
.gk-mood { font-weight:600 }
.gk-ok { color:var(--ok) } .gk-warn { color:var(--warn) } .gk-bad { color:var(--bad) }
.gk-trend { color:var(--dim); font-size:12px }
.gk-counts { display:grid; grid-template-columns:repeat(3,1fr); gap:6px 12px; margin:0 0 12px }
.gk-counts div { display:flex; justify-content:space-between; border-bottom:1px dashed var(--line); padding-bottom:2px }
.gk-counts dt { color:var(--dim) } .gk-counts dd { margin:0; font-variant-numeric:tabular-nums; font-weight:600 }
.gk-card details { margin-top:10px }
.gk-card summary { cursor:pointer; padding:4px 0 }
.gk-graves { list-style:none; margin:8px 0 0; padding:0; display:grid; gap:10px }
.gk-graves li { border-left:3px solid var(--bad); padding-left:10px }
.gk-url { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; overflow-wrap:anywhere }
.gk-tag { font-size:11px; letter-spacing:.04em; text-transform:uppercase; color:var(--bad); font-weight:700 }
.gk-empty, .gk-error { background:var(--card); border:1px dashed var(--line); border-radius:12px; padding:18px }
.gk-btn { background:transparent; color:var(--ink); border:1px solid var(--lantern); border-radius:8px; padding:6px 12px; cursor:pointer }
.gk-btn:hover { background:rgba(245,185,74,.14) }
`, g = (e) => e >= 85 ? { word: "Peaceful", cls: "gk-ok" } : e >= 60 ? { word: "Uneasy", cls: "gk-warn" } : { word: "Haunted", cls: "gk-bad" }, N = (e) => {
  const t = new Date(e);
  return Number.isNaN(t.getTime()) ? e : t.toLocaleDateString(void 0, { year: "numeric", month: "short", day: "numeric" });
}, $ = (e) => /^\d{8}/.test(e) ? `${e.slice(0, 4)}-${e.slice(4, 6)}-${e.slice(6, 8)}` : e, m = (e) => {
  try {
    return new URL(e).protocol === "https:";
  } catch {
    return !1;
  }
};
function L({ points: e }) {
  const i = e.length ? `Health trend over ${e.length} walk${e.length === 1 ? "" : "s"}: ${e.join(", ")}` : "No health history yet", d = (o) => e.length === 1 ? 120 / 2 : 4 + o * 112 / (e.length - 1), s = (o) => 4 + (100 - Math.max(0, Math.min(100, o))) * 26 / 100, l = e.map((o, p) => `${p ? "L" : "M"}${d(p).toFixed(1)} ${s(o).toFixed(1)}`).join(" "), c = e.length - 1;
  return /* @__PURE__ */ a("svg", { width: 120, height: 34, viewBox: "0 0 120 34", role: "img", "aria-label": i, children: [
    /* @__PURE__ */ r("title", { children: i }),
    /* @__PURE__ */ r("line", { x1: "0", x2: 120, y1: s(85), y2: s(85), stroke: "#343859", strokeDasharray: "3 3" }),
    e.length > 1 && /* @__PURE__ */ r("path", { d: l, fill: "none", stroke: "#f5b94a", strokeWidth: "2", strokeLinejoin: "round", strokeLinecap: "round" }),
    e.length > 0 && /* @__PURE__ */ r("circle", { cx: d(c), cy: s(e[c]), r: "3.5", fill: "#f5b94a" })
  ] });
}
function z(e) {
  if (e.length < 2) return e.length ? "First walk, nothing to compare yet" : "";
  const t = e[e.length - 1] - e[e.length - 2];
  return t === 0 ? "Unchanged since the previous walk" : t > 0 ? `Up ${t} since the previous walk` : `Down ${-t} since the previous walk`;
}
function W({ row: e, lychgate: t }) {
  const { latest: n } = e, i = `gk-${e.repo.replace(/[^A-Za-z0-9]/g, "-")}`, d = e.history.map((l) => l.health), s = !!(n != null && n.reportUrl && t && n.reportUrl.startsWith(`${t}/r/`) && m(n.reportUrl));
  return /* @__PURE__ */ r("li", { children: /* @__PURE__ */ a("article", { className: "gk-card", "aria-labelledby": i, children: [
    /* @__PURE__ */ r("h2", { id: i, children: w.test(e.repo) ? /* @__PURE__ */ r("a", { href: `https://github.com/${e.repo}`, target: "_blank", rel: "noopener noreferrer", children: e.repo }) : e.repo }),
    n ? /* @__PURE__ */ a(k, { children: [
      /* @__PURE__ */ a("p", { className: "gk-meta", children: [
        "Last walked ",
        N(n.at)
      ] }),
      /* @__PURE__ */ a("div", { className: "gk-row", children: [
        /* @__PURE__ */ a("div", { className: "gk-score", children: [
          /* @__PURE__ */ r("span", { className: g(n.health).cls, children: n.health }),
          /* @__PURE__ */ r("small", { children: "/ 100 health" })
        ] }),
        /* @__PURE__ */ a("div", { children: [
          /* @__PURE__ */ r("div", { className: `gk-mood ${g(n.health).cls}`, children: g(n.health).word }),
          /* @__PURE__ */ r("div", { className: "gk-trend", children: z(d) })
        ] }),
        /* @__PURE__ */ r(L, { points: d })
      ] }),
      /* @__PURE__ */ a("dl", { className: "gk-counts", children: [
        /* @__PURE__ */ a("div", { children: [
          /* @__PURE__ */ r("dt", { children: "Living" }),
          /* @__PURE__ */ r("dd", { children: n.counts.living })
        ] }),
        /* @__PURE__ */ a("div", { children: [
          /* @__PURE__ */ r("dt", { children: "Tombstone" }),
          /* @__PURE__ */ r("dd", { children: n.counts.tombstone })
        ] }),
        /* @__PURE__ */ a("div", { children: [
          /* @__PURE__ */ r("dt", { children: "Ghost" }),
          /* @__PURE__ */ r("dd", { children: n.counts.ghost })
        ] }),
        /* @__PURE__ */ a("div", { children: [
          /* @__PURE__ */ r("dt", { children: "Zombie" }),
          /* @__PURE__ */ r("dd", { children: n.counts.zombie })
        ] }),
        /* @__PURE__ */ a("div", { children: [
          /* @__PURE__ */ r("dt", { children: "Drifted" }),
          /* @__PURE__ */ r("dd", { children: n.counts.drifted })
        ] }),
        /* @__PURE__ */ a("div", { children: [
          /* @__PURE__ */ r("dt", { children: "Links" }),
          /* @__PURE__ */ r("dd", { children: n.counts.total })
        ] })
      ] }),
      s ? /* @__PURE__ */ a("a", { href: n.reportUrl, target: "_blank", rel: "noopener noreferrer", children: [
        "Open the shared Lychgate report",
        /* @__PURE__ */ a("span", { className: "sr-only", children: [
          " for ",
          e.repo,
          " (opens in a new tab)"
        ] })
      ] }) : /* @__PURE__ */ r("span", { className: "gk-meta", children: "No shared report for the last walk." }),
      n.graves.length > 0 && /* @__PURE__ */ a("details", { children: [
        /* @__PURE__ */ a("summary", { children: [
          n.graves.length,
          " grave",
          n.graves.length === 1 ? "" : "s"
        ] }),
        /* @__PURE__ */ r("ul", { className: "gk-graves", children: n.graves.map((l) => /* @__PURE__ */ a("li", { children: [
          /* @__PURE__ */ r("span", { className: "gk-tag", children: x[l.cls] ?? l.cls }),
          /* @__PURE__ */ r("div", { className: "gk-url", children: l.url }),
          l.where.length > 0 && /* @__PURE__ */ a("div", { className: "gk-meta", children: [
            "Cited at ",
            l.where.join(", ")
          ] }),
          l.snapshot && m(l.snapshot.url) && /* @__PURE__ */ a("a", { href: l.snapshot.url, target: "_blank", rel: "noopener noreferrer", children: [
            "Wayback snapshot from ",
            $(l.snapshot.timestamp)
          ] })
        ] }, l.url)) })
      ] })
    ] }) : /* @__PURE__ */ r("p", { className: "gk-meta", children: "Not walked yet. The next walk will give this grave a first reading." })
  ] }) });
}
function A() {
  const e = u(), [t, n] = h(null), [i, d] = h(null), [s, l] = h(!0), c = v(() => {
    l(!0), d(null), e.get("/apps/gravekeeper/api/walks").then((o) => n(o)).catch((o) => d((o == null ? void 0 : o.message) ?? "Could not read the walk history")).finally(() => l(!1));
  }, []);
  return b(c, [c]), /* @__PURE__ */ a(k, { children: [
    /* @__PURE__ */ r(f, { title: "Gravekeeper", subtitle: "Keeper of the docs graveyard: weekly link walks over the repos you watch" }),
    /* @__PURE__ */ a("div", { className: "px-6 pb-8 overflow-y-auto flex-1 min-h-0", children: [
      /* @__PURE__ */ r("style", { children: y + ".sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" }),
      /* @__PURE__ */ a("div", { className: "gk", children: [
        /* @__PURE__ */ a("p", { className: "gk-intro", children: [
          /* @__PURE__ */ r("span", { className: "gk-lantern", "aria-hidden": "true", children: "🏮 " }),
          "Once a week the keeper walks each watched repo with the Lychgate scanner. Graves are links that are gone (Tombstone), lead nowhere real (Ghost) or answer with something else (Zombie)."
        ] }),
        s && /* @__PURE__ */ r("p", { role: "status", children: "Lighting the lantern…" }),
        i && /* @__PURE__ */ a("div", { className: "gk-error", role: "alert", children: [
          /* @__PURE__ */ a("p", { children: [
            "The keeper could not read the walk history: ",
            i
          ] }),
          /* @__PURE__ */ r("button", { className: "gk-btn", onClick: c, children: "Try again" })
        ] }),
        !s && !i && t && t.repos.length === 0 && /* @__PURE__ */ r("div", { className: "gk-empty", children: /* @__PURE__ */ a("p", { children: [
          "No repos are watched yet. Add ",
          /* @__PURE__ */ r("code", { children: "owner/repo" }),
          " entries to ",
          /* @__PURE__ */ r("code", { children: "watchlist.json" }),
          " in the app folder."
        ] }) }),
        !i && t && t.repos.length > 0 && /* @__PURE__ */ r("ul", { className: "gk-grid", "aria-label": "Watched repos", children: t.repos.map((o) => /* @__PURE__ */ r(W, { row: o, lychgate: t.lychgate }, o.repo)) })
      ] })
    ] })
  ] });
}
export {
  A as default
};
