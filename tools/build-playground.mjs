#!/usr/bin/env node
// Regenerates playground.html from data/outcomes.jsonl + tools/playground-template.html.
// Trimmed fields only; JSON is script-escaped (< -> \u003c) for safe <script> embedding.
import { readFile, writeFile } from "node:fs/promises";

// guarded reads: clear messages instead of raw stack traces (fresh clone, truncated sync, hand edit)
async function read(p, hint) {
	try {
		return await readFile(p, "utf8");
	} catch {
		throw new Error(`cannot read ${p}${hint ? " — " + hint : ""}`);
	}
}
function parseJson(text, p) {
	try {
		return JSON.parse(text);
	} catch (e) {
		throw new Error(`${p} is malformed JSON: ${e.message}`);
	}
}
function parseJsonl(text, p) {
	return text
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((l, i) => {
			try {
				return JSON.parse(l);
			} catch (e) {
				throw new Error(`${p} line ${i + 1} is malformed: ${e.message}`);
			}
		});
}

async function main() {
	const rows = parseJsonl(
		await read("data/outcomes.jsonl", "run node sync.mjs first"),
		"data/outcomes.jsonl",
	).map((r) => ({
		code: r.code,
		title: r.title,
		descriptionText: r.descriptionText,
		lifeSkills: r.lifeSkills,
		isOverarching: r.isOverarching,
		stages: r.stages,
		relatedLifeSkillsOutcomeCodes: r.relatedLifeSkillsOutcomeCodes,
		syllabus: r.syllabus,
		syllabusSlug: r.syllabusSlug,
		syllabusYear: r.syllabusYear,
		kla: r.kla,
	}));
	const meta = parseJson(
		await read("data/sync-metadata.json", "run node sync.mjs first"),
		"data/sync-metadata.json",
	);
	const tpl = await readFile("tools/playground-template.html", "utf8");
	// function form for replace: no $-substitution surprises from payload text
	const html = tpl
		.replace(/<!--GEN-STRIP-->[\s\S]*?<!--\/GEN-STRIP-->/, "")
		.replace("__DATA__", () => JSON.stringify(rows).replace(/</g, "\\u003c"))
		.replace("__GENERATED__", () => meta.fetchedAt.slice(0, 10))
		.replace("__TOTAL__", () => String(rows.length))
		.replace("__SYLCOUNT__", () => String(meta.perSyllabus.length));
	await writeFile("playground.html", html);
	console.log(
		`[build] playground.html · ${rows.length} outcomes · ${(html.length / 1e6).toFixed(2)} MB`,
	);
}

main().catch((e) => {
	console.error("[build] FATAL", e);
	process.exit(1);
});
