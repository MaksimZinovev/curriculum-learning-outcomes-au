import { readFile, writeFile } from "node:fs/promises";

// regenerates assets/count.svg from data/sync-metadata.json.
// the SVG is its own template: the current count is read from its aria-label,
// then every occurrence (text, label, ids) is swapped for the new count.

async function read(path, hint) {
	try {
		return await readFile(path, "utf8");
	} catch {
		throw new Error(`[badge] missing ${path} (${hint})`);
	}
}

function parse(json, path) {
	try {
		return JSON.parse(json);
	} catch {
		throw new Error(`[badge] ${path} is not valid JSON`);
	}
}

async function main() {
	const meta = parse(
		await read("data/sync-metadata.json", "run node tools/sync.mjs first"),
		"data/sync-metadata.json",
	);
	const svg = await read("assets/count.svg", "see README badge section");
	const m = svg.match(/aria-label="Record count: (\d+)"/);
	if (!m) throw new Error('[badge] no "Record count: N" aria-label in count.svg');
	const old = m[1];
	const next = String(meta.totalOutcomes);
	if (old === next) {
		console.log(`[badge] count.svg already shows ${next}`);
		return;
	}
	await writeFile("assets/count.svg", svg.replaceAll(old, next));
	console.log(`[badge] count.svg: ${old} -> ${next}`);
}

main().catch((e) => {
	console.error("[badge] FATAL", e.message);
	process.exit(1);
});