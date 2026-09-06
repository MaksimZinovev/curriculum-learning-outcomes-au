import { readFile, writeFile } from "node:fs/promises";

// regenerates assets/count.svg from data/sync-metadata.json.
// the SVG is its own template: the current count is read from its aria-label.
// replacement targets the count's exact tokens (aria-label, display text
// node, Recordcount<n> id/url tokens) and fails fast if any is missing,
// so template changes surface as loud errors, never silent wrong edits.

async function read(path, hint) {
	try {
		return await readFile(path, "utf8");
	} catch (e) {
		throw new Error(`[badge] unable to read ${path} (${hint})`, {
			cause: e,
		});
	}
}

function parse(json, path) {
	try {
		return JSON.parse(json);
	} catch (e) {
		throw new Error(`[badge] ${path} is not valid JSON`, { cause: e });
	}
}

function replaceCount(svg, old, next) {
	const tokens = [
		`aria-label="Record count: ${old}"`,
		`>${old}</text>`,
		`Recordcount${old}n`,
	];
	for (const t of tokens) {
		if (!svg.includes(t)) {
			throw new Error(`[badge] count.svg missing expected token: ${t}`);
		}
	}
	let out = svg;
	for (const t of tokens) {
		out = out.split(t).join(t.split(old).join(next));
	}
	return out;
}

async function main() {
	const meta = parse(
		await read("data/sync-metadata.json", "run node tools/sync.mjs first"),
		"data/sync-metadata.json",
	);
	const svg = await read("assets/count.svg", "see README badge section");
	const m = svg.match(/aria-label="Record count: (\d+)"/);
	if (!m)
		throw new Error('[badge] no "Record count: N" aria-label in count.svg');
	const next = String(meta.totalOutcomes);
	if (!/^\d+$/.test(next)) {
		throw new Error(`[badge] totalOutcomes is not a number: ${next}`);
	}
	if (m[1] === next) {
		console.log(`[badge] count.svg already shows ${next}`);
		return;
	}
	await writeFile("assets/count.svg", replaceCount(svg, m[1], next));
	console.log(`[badge] count.svg: ${m[1]} -> ${next}`);
}

main().catch((e) => {
	console.error("[badge] FATAL", e);
	process.exit(1);
});
