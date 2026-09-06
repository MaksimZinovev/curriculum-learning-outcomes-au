import { readFile, writeFile } from "node:fs/promises";

// regenerates assets/count.svg from data/sync-metadata.json.
// the SVG is its own template: the current count is read from its aria-label.
// replacement is targeted at the count's exact token shapes (aria-label,
// the display text node, and the Recordcount<n> id/url tokens), so a count
// that coincides with width/viewBox/path coordinates can never corrupt
// the badge geometry.

async function read(path, hint) {
	try {
		return await readFile(path, "utf8");
	} catch (e) {
		throw new Error(`[badge] missing ${path} (${hint})`, { cause: e });
	}
}

function parse(json, path) {
	try {
		return JSON.parse(json);
	} catch (e) {
		throw new Error(`[badge] ${path} is not valid JSON`, { cause: e });
	}
}

function replaceCount(svg, next) {
	const out = svg
		.replace(/(aria-label="Record count: )\d+"/, `$1${next}"`)
		.replace(/>(\d+)<\/text>/, `>${next}</text>`)
		.replace(/Recordcount\d+n/g, `Recordcount${next}n`);
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
	await writeFile("assets/count.svg", replaceCount(svg, next));
	console.log(`[badge] count.svg: ${m[1]} -> ${next}`);
}

main().catch((e) => {
	console.error("[badge] FATAL", e.message);
	if (e.cause) console.error("[badge] cause:", e.cause.message);
	process.exit(1);
});
