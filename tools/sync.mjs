#!/usr/bin/env node
// NSW curriculum outcomes sync — zero deps, Node 22+.
// Spec: shaping/mvp-spec.md · Probe recipes: shaping/payload-probe.md · Dedup: shaping/adr/0001-*
// ponytail: no `?.` / `??` / top-level await — the repo's lens TS grammar predates them and blocks
// every edit with false parse errors (verified: node --check passes; repro flagged only those tokens).
// Helpers val()/code1()/name1() and a main() wrapper replace them. Don't "modernize" back.
import { gzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const BASE = "https://curriculum.nsw.edu.au";
const DATA = "data";
const RAW = `${DATA}/raw`;
const UA =
	"scoolendar-sync/0.1 (github.com/MaksimZinovev/curriculum-learning-outcomes-au)";
const CONCURRENCY = 5;

const log = (...a) => console.log("[sync]", ...a);
const dbg = (...a) => console.log("[debug]", ...a);
const warn = (...a) => console.warn("[warn]", ...a);

// ponytail: test hooks (SYNC_FAIL_SLUGS=a,b forces failures; SYNC_PREV_TOTAL=n overrides gate baseline). Remove when CI covers both paths.
const failSlugs = (process.env.SYNC_FAIL_SLUGS || "")
	.split(",")
	.filter(Boolean);
const prevTotalOverride = process.env.SYNC_PREV_TOTAL
	? Number(process.env.SYNC_PREV_TOTAL)
	: null;

const readJson = async (p, fallback) => {
	try {
		return JSON.parse(await readFile(p, "utf8"));
	} catch {
		return fallback;
	}
};

// element accessors replacing optional chaining
const val = (e, k) => (e && e[k] ? e[k].value : undefined);
const code1 = (e, k) => {
	const v = val(e, k);
	return v && v[0] ? v[0].codename : undefined;
};
const name1 = (e, k) => {
	const v = val(e, k);
	return v && v[0] ? v[0].name : undefined;
};
const names = (v) => (Array.isArray(v) ? v.map((t) => t.name) : []);
const tax = (v, codename) =>
	Array.isArray(v) && v.some((t) => t.codename === codename);
const numOr = (v) => (v && /^\d+$/.test(v) ? Number(v) : v || null);
// CMS returns stages in arbitrary order; canonical order keeps diffs stable
const STAGE_ORDER = [
	"Early Stage 1",
	"Stage 1",
	"Stage 2",
	"Stage 3",
	"Stage 4",
	"Stage 5",
	"Stage 6",
];
const stageRank = (s) => {
	const i = STAGE_ORDER.indexOf(s);
	return i === -1 ? 99 : i;
};

async function jfetch(url, tries = 3) {
	let lastErr;
	for (let i = 0; i < tries; i++) {
		try {
			const r = await fetch(url, { headers: { "user-agent": UA } });
			if (r.ok) return r;
			lastErr = new Error(`HTTP ${r.status}`);
			if (r.status === 404) break; // fail fast, retries won't fix a missing page
		} catch (e) {
			lastErr = e;
		}
		log(
			`fetch retry ${i + 1}/${tries} for ${url.slice(0, 100)} (${lastErr.message})`,
		);
		await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
	}
	throw lastErr;
}

// tiny worker pool
async function pool(items, n, fn) {
	let i = 0;
	const workers = [];
	for (let w = 0; w < n; w++)
		workers.push(
			(async () => {
				while (i < items.length) {
					const idx = i++;
					await fn(items[idx], idx);
				}
			})(),
		);
	await Promise.all(workers);
}

function toText(html) {
	if (!html) return "";
	return html
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#0?39;|&apos;/g, "'")
		.replace(/&#x([0-9a-f]+);/gi, (_, h) =>
			String.fromCodePoint(parseInt(h, 16)),
		)
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
		.replace(/\s+/g, " ")
		.trim();
} // ponytail: minimal entity map, extend if output ever shows a raw &xxx;

async function main() {
	// ---- phase 1: endpoints -------------------------------------------------
	log("resolving buildId…");
	const bm = (await (await jfetch(`${BASE}/`)).text()).match(
		/_next\/static\/([^/]+)\/_buildManifest\.js/,
	);
	const buildId = bm ? bm[1] : null;
	if (!buildId) throw new Error("could not resolve buildId from homepage HTML");
	dbg("buildId =", buildId);

	log("reading sitemap…");
	const sm = await (await jfetch(`${BASE}/sitemap-0.xml`)).text();
	const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)]
		.map((m) => m[1])
		.filter((u) => u.endsWith("/outcomes"));
	// sitemap cross-lists some syllabuses under two learning areas (same slug, e.g.
	// /science/ and /tas/ science-and-technology-k-6-2024); one variant may serve an empty payload.
	const bySlug = new Map();
	let dupUrls = 0;
	for (const u of locs) {
		const slug = u.replace(`${BASE}/`, "").split("/").at(-2);
		if (bySlug.has(slug)) {
			bySlug.get(slug).push(u);
			dupUrls++;
		} else bySlug.set(slug, [u]);
	}
	if (dupUrls)
		dbg(
			`${dupUrls} duplicate sitemap URLs share a slug; fetching each slug once, alternates as fallback`,
		);
	const pages = [...bySlug.entries()];
	log(`${pages.length} unique /outcomes pages (${locs.length} sitemap URLs)`);
	if (pages.length < 50)
		throw new Error(
			`sitemap collapsed: only ${pages.length} pages, refusing to continue`,
		);

	const prevMeta = await readJson(`${DATA}/sync-metadata.json`, null);
	let prevRows = [];
	try {
		prevRows = (await readFile(`${DATA}/outcomes.jsonl`, "utf8"))
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l));
	} catch {
		/* first run */
	}
	dbg(
		`previous state: ${prevMeta ? prevMeta.totalOutcomes + " outcomes" : "none"}, ${prevRows.length} rows`,
	);

	// ---- phase 2: fetch + extract per page ----------------------------------
	const warnings = [];
	const note = (...a) => {
		warn(...a);
		warnings.push(a.join(" "));
	};

	function extract(data, slug) {
		if (!data || !data.syllabus || !data.syllabus.item)
			throw new Error("payload has no syllabus data");
		const els = data.syllabus.item.elements;
		const refs = val(els, "outcomes") || [];
		const li = data.syllabus.linkedItems || {};
		const pageMeta = {
			codename: val(els, "code") || slug.replaceAll("-", "_"),
			slug,
			name: val(els, "title") || null,
			year: numOr(val(els, "publication_year")),
			kla: name1(els, "key_learning_area_default") || null,
			stages: names(val(els, "stages__stages")),
			syllabusType: name1(els, "syllabus_type__items") || null,
			relatedLifeSkillsSyllabus:
				code1(els, "relatedlifeskillssyllabus") || null,
			outcomesCount: refs.length,
		};
		const outcomes = [];
		let missing = 0,
			printDummies = 0;
		for (const ref of refs) {
			const entry = li[ref];
			const rec = entry ? entry.item || entry : null;
			const type = rec && rec.system ? rec.system.type : null;
			if (type === "outcome_printdummy") {
				printDummies++;
				continue;
			} // CMS layout placeholder for print/PDF, not a real outcome
			if (!rec || type !== "outcome") {
				missing++;
				continue;
			}
			const e = rec.elements || {};
			const relRefs = val(e, "relatedlifeskillsoutcomes") || [];
			const relCodes = relRefs
				.map((r) => li[r])
				.map((entry2) => {
					const r2 = entry2 ? entry2.item || entry2 : null;
					return r2 && r2.elements ? val(r2.elements, "code") : null;
				})
				.filter(Boolean);
			if (relRefs.length !== relCodes.length)
				note(
					`${slug}: could not resolve some relatedLifeSkillsOutcome refs for ${val(e, "code") || ref}`,
				);
			outcomes.push({
				codename: ref,
				code: val(e, "code") || "",
				title: val(e, "title") || "",
				descriptionHtml: val(e, "description") || "",
				lifeSkills: tax(val(e, "syllabus_type__items"), "life_skills"),
				isOverarching: tax(val(e, "isoverarching"), "yes"),
				stages: names(val(e, "stages__stages")),
				relatedLifeSkillsOutcomeCodes: relCodes,
				backRef: code1(e, "syllabus") || pageMeta.codename, // ADR 0001: record's own syllabus wins when it maps to a page
				lastModified: rec.system.lastModified || null,
			});
		}
		if (missing)
			note(
				`${slug}: ${missing} of ${refs.length} outcome refs had no outcome record`,
			);
		if (printDummies) dbg(`${slug}: ${printDummies} print-dummy refs skipped`);
		if (!refs.length) note(`${slug}: 0 outcomes listed`);
		return { pageMeta, outcomes };
	}

	const results = [];
	await pool(pages, CONCURRENCY, async ([slug, urls]) => {
		const t0 = Date.now();
		let lastErr = null;
		for (const url of urls) {
			try {
				if (failSlugs.includes(slug))
					throw new Error(`SYNC_FAIL_SLUGS test hook`);
				const path = url.replace(`${BASE}/`, "");
				const raw = await (
					await jfetch(
						`${BASE}/_next/data/${buildId}/${path}.json?slug=${encodeURIComponent(path)}`,
					)
				).text();
				const data = JSON.parse(raw).pageProps.data;
				await mkdir(RAW, { recursive: true });
				await writeFile(`${RAW}/${slug}.json.gz`, gzipSync(Buffer.from(raw)));
				const ex = extract(data, slug);
				results.push({ slug, url, ...ex, status: "ok" });
				dbg(
					`${slug}: ${ex.pageMeta.outcomesCount} refs, ${ex.outcomes.length} records (${((Date.now() - t0) / 1000).toFixed(1)}s)${urls.length > 1 ? " [alt variant]" : ""}`,
				);
				return;
			} catch (e) {
				lastErr = e;
			}
		}
		results.push({
			slug,
			url: urls[0],
			status: "failed",
			error: lastErr.message,
			outcomes: [],
			pageMeta: { codename: null, slug, outcomesCount: 0 },
		});
		note(`${slug}: fetch failed — ${lastErr.message}`);
	});
	log(
		`fetched ${results.filter((r) => r.status === "ok").length}/${pages.length} payloads`,
	);

	// ---- phase 3: dedupe + normalize (ADR 0001 + fallback) ------------------
	// syllabus mapping: record's back-ref codename when it is some page's codename,
	// else the page that published the listing (14 CMS syllabus items have no page).
	const slugByCodename = new Map(
		results
			.filter((r) => r.status === "ok")
			.map((r) => [r.pageMeta.codename, r.slug]),
	);
	const pageBySlug = new Map(results.map((r) => [r.slug, r]));
	const fallbackRefs = new Map(); // backRef codename → outcome count, for one grouped warning

	const byCodename = new Map();
	let dupesSkipped = 0,
		conflicts = 0;
	for (const r of results) {
		for (const o of r.outcomes) {
			const prev = byCodename.get(o.codename);
			if (!prev) {
				byCodename.set(o.codename, { ...o, fetchedFromSlug: r.slug });
				continue;
			}
			dupesSkipped++;
			if (prev.code !== o.code || prev.descriptionHtml !== o.descriptionHtml) {
				conflicts++;
				note(
					`conflicting duplicate record ${o.codename} (${prev.code} vs ${o.code}) — keeping first copy`,
				);
			}
		}
	}

	function syllabusOf(o) {
		const viaBackRef = slugByCodename.get(o.backRef);
		const slug = viaBackRef || o.fetchedFromSlug;
		if (!viaBackRef)
			fallbackRefs.set(o.backRef, (fallbackRefs.get(o.backRef) || 0) + 1);
		const page = pageBySlug.get(slug);
		if (!page) note(`outcome ${o.code}: no page meta for slug ${slug}`);
		const m = page ? page.pageMeta : {};
		return {
			syllabusCodename: viaBackRef ? o.backRef : m.codename, // page codename so joins against syllabuses.json always hit
			syllabusSlug: slug,
			syllabus: m.name || slug,
			syllabusYear: m.year || null,
			kla: m.kla || null,
			sourceUrl: page ? page.url : null,
		};
	}
	for (const [cn, n] of fallbackRefs)
		note(
			`syllabus ${cn} has no /outcomes page; ${n} outcomes mapped to the page that lists them`,
		);

	const outcomes = [...byCodename.values()]
		.map((o) => {
			const s = syllabusOf(o);
			const { backRef, fetchedFromSlug, lastModified, ...rest } = o;
			return {
				...rest,
				stages: [...rest.stages].sort((a, b) => stageRank(a) - stageRank(b)),
				descriptionText: toText(rest.descriptionHtml),
				...s,
				fetchedAt: new Date().toISOString(),
			};
		})
		.sort(
			(a, b) =>
				a.syllabusSlug.localeCompare(b.syllabusSlug) ||
				a.code.localeCompare(b.code) ||
				a.codename.localeCompare(b.codename),
		);

	const syllabuses = results
		.map((r) => ({
			codename: r.pageMeta.codename,
			slug: r.slug,
			name: r.pageMeta.name,
			year: r.pageMeta.year,
			kla: r.pageMeta.kla,
			stages: r.pageMeta.stages || [],
			syllabusType: r.pageMeta.syllabusType,
			relatedLifeSkillsSyllabus: r.pageMeta.relatedLifeSkillsSyllabus || null,
			outcomesCount: r.pageMeta.outcomesCount,
			status: r.status,
			...(r.error ? { error: r.error } : {}),
			lastFetched: r.status === "ok" ? new Date().toISOString() : null,
			sourceUrl: r.url,
		}))
		.sort((a, b) => a.slug.localeCompare(b.slug));

	// ---- phase 4: validation gate (spec: only >10% total drop aborts) -------
	const total = outcomes.length;
	let prevTotal;
	if (prevTotalOverride !== null && prevTotalOverride !== undefined) {
		prevTotal = prevTotalOverride;
	} else if (prevMeta && prevMeta.totalOutcomes !== undefined) {
		prevTotal = prevMeta.totalOutcomes;
	} else {
		prevTotal = null;
	}
	if (prevTotal !== null && prevTotal !== undefined) {
		const ratio = prevTotal === 0 ? 1 : total / prevTotal;
		dbg(
			`gate: ${total} now vs ${prevTotal} before = ${(ratio * 100).toFixed(1)}%`,
		);
		if (ratio < 0.9) {
			log(
				`ABORT: total ${total} is below 90% of previous ${prevTotal}. No files written.`,
			);
			process.exit(1);
		}
	}

	// ---- phase 5: keep last-known rows for failed syllabuses, write ---------
	const failedSlugs = new Set(
		syllabuses.filter((s) => s.status === "failed").map((s) => s.slug),
	);
	let staleKept = 0;
	if (failedSlugs.size && prevRows.length) {
		const known = new Set(outcomes.map((o) => o.codename));
		for (const row of prevRows) {
			if (!failedSlugs.has(row.syllabusSlug) || known.has(row.codename))
				continue;
			outcomes.push(row);
			staleKept++;
		}
		outcomes.sort(
			(a, b) =>
				a.syllabusSlug.localeCompare(b.syllabusSlug) ||
				a.code.localeCompare(b.code) ||
				(a.codename || "").localeCompare(b.codename || ""),
		);
		if (staleKept)
			note(
				`kept ${staleKept} last-known rows for failed syllabuses [${[...failedSlugs].join(", ")}]`,
			);
	}
	// rows for syllabuses that vanished from the sitemap
	const liveSlugs = new Set(syllabuses.map((s) => s.slug));
	const orphan = prevRows.filter(
		(r) =>
			!liveSlugs.has(r.syllabusSlug) &&
			!outcomes.some((o) => o.codename === r.codename),
	);
	if (orphan.length)
		note(
			`${orphan.length} previous rows reference syllabuses no longer in the sitemap; keeping them (stale)`,
		);

	const finalOutcomes = [...outcomes, ...orphan].map((o) => ({
		...o,
		stale:
			o.stale || failedSlugs.has(o.syllabusSlug) || orphan.includes(o)
				? true
				: undefined,
	}));
	const metadata = {
		fetchedAt: new Date().toISOString(),
		buildId,
		totalOutcomes: finalOutcomes.length,
		mainstreamCount: finalOutcomes.filter((o) => !o.lifeSkills).length,
		lifeSkillsCount: finalOutcomes.filter((o) => o.lifeSkills).length,
		dedupe: {
			uniqueRecords: byCodename.size,
			duplicatesSkipped: dupesSkipped,
			conflicts,
		},
		gate: {
			previousTotal: prevTotal,
			ratio: prevTotal ? +(total / prevTotal).toFixed(3) : null,
		},
		staleRowsKept: staleKept + orphan.length,
		perSyllabus: syllabuses.map((s) => ({
			slug: s.slug,
			status: s.status,
			outcomesCount: s.outcomesCount,
			...(s.error ? { error: s.error } : {}),
		})),
		warnings,
	};

	await mkdir(DATA, { recursive: true });
	await writeFile(
		`${DATA}/outcomes.jsonl`,
		finalOutcomes.map((o) => JSON.stringify(o)).join("\n") + "\n",
	);
	await writeFile(
		`${DATA}/syllabuses.json`,
		JSON.stringify(syllabuses, null, 2) + "\n",
	);
	await writeFile(
		`${DATA}/sync-metadata.json`,
		JSON.stringify(metadata, null, 2) + "\n",
	);

	log(
		`wrote ${finalOutcomes.length} outcomes (${metadata.mainstreamCount} mainstream / ${metadata.lifeSkillsCount} life skills), ${syllabuses.length} syllabuses`,
	);
	log(
		`warnings: ${warnings.length} · duplicates skipped: ${dupesSkipped} · stale rows kept: ${staleKept + orphan.length}`,
	);
	log(
		`files: ${DATA}/outcomes.jsonl, ${DATA}/syllabuses.json, ${DATA}/sync-metadata.json, raw snapshots in ${RAW}/ (gitignored)`,
	);
}

main().catch((e) => {
	console.error("[sync] FATAL", e);
	process.exit(1);
});
