/*
Snap: A simple static site generator -- https://github.com/invicticide/snap
Copyright (C) 2017 Josh Sutphin

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

require("source-map-support").install();

var cp = require("child_process");
var fs = require("fs");
var path = require("path");
var jsonSchemaToTypescript = require("json-schema-to-typescript");
var clc = require("cli-color");

const { performance } = require("perf_hooks");
let startTime = performance.now();

// True on Windows, false on Mac/Linux, for platform-specific calls
var isWindows = /^win/.test(process.platform);

/**
 * Compiles the engine files. Typings files should've been built before this.
 */
function BuildEngine()
{
	console.log("Building engine...");
	
	let result = cp.spawnSync(isWindows ? "node_modules\\.bin\\tsc.cmd" : "node_modules/.bin/tsc", [], { env : process.env });
	
	// If result.error is set, then node failed launching the process or the process timed out. This isn't a tsc error.
	if(result.error)
	{
		console.error(clc.red(`\n${result.error}`));
		process.exit(1); // result.status is not valid in this case
	}
	
	// I've never seen tsc write to stderr, but node might, so we need to at least echo it.
	if(result.stderr !== null)
	{
		let s = result.stderr.toString();
		if(s.length > 0) { console.error(clc.red(`\n${s}`)); }
	}

	// tsc return codes: https://github.com/Microsoft/TypeScript/blob/master/src/compiler/types.ts (search `enum ExitStatus`)
	// Currently both 0 and 2 produce outputs (0 is clean, 2 has warnings) and only 1 is actually an error result.
	if(result.status === 1)
	{
		// tsc doesn't write to stderr; its errors are all on stdout, because... reasons?
		if(result.stdout !== null)
		{
			let s = result.stdout.toString();
			if(s.length > 0) { console.error(clc.red(`\n${s}`)); }
		}
		process.exit(result.status);
	}
	else
	{
		// tsc may emit error messages but still succeed if those error types are disabled in the tsconfig.
		// We'll rewrite those as warnings here, for clarity.
		if(result.stdout !== null)
		{
			let s = result.stdout.toString();
			if(s.length > 0) { console.log(clc.yellow(`\n${s.split(": error TS").join(": warning TS")}`)); }
		}
	}
}

function Finish()
{
	let duration = (performance.now() - startTime) / 1000;
	let durationString = duration.toLocaleString(undefined, { useGrouping: true, maximumFractionDigits: 2 });
	console.log(clc.green(`\nBuild finished in ${durationString} seconds\n`));
}

const schemaInput = "src/ProjectSchema.json";
const schemaOutput = "src/ProjectSchema.d.ts";

console.log("Generating type declarations...");

jsonSchemaToTypescript.compileFromFile(schemaInput).then(ts =>
{
	fs.writeFileSync(schemaOutput, ts, "utf8"); // For TypeScript completion at edit-time
	fs.copyFileSync(schemaInput, "lib/ProjectSchema.json"); // For JSON validation at runtime
	BuildEngine();
	Finish();
});
