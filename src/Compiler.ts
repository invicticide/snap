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

// File system stuff
import * as fs from "fs";
import * as path from "path";
import * as util from "util";

// Set up the Markdown parser and renderer
import * as commonmark from "commonmark";
const markdownReader = new commonmark.Parser({smart: false});
const markdownWriter = new commonmark.HtmlRenderer({softbreak: "<br/>"});

// Beautification and minification
import * as beautifier from "js-beautify";
import * as minifier from "html-minifier";

// Project file validation and overlay support
import * as ajv from "ajv";
import * as overrideJSON from "json-override";
import { SnapProject } from "./ProjectSchema";
export let ProjectDefaults : SnapProject = {
	markdown: [ "source/**/*.md" ],
	javascript: [ "source/**/*.js" ],
	assets: [ "assets/**" ],
	ignore: [],
	aliases: [],
	template: "template.html",
	output: "build",
	outputFormat: "prettify",
	linkTags: {
		external: {
			html: "",
			prepend: false
		}
	}
};
import * as globby from "globby";

// CLI colors
import * as clc from "cli-color";

export interface CompilerOptions
{
	/**
	 * If true, log what would've been done but don't actually modify any files on disk
	 */
	dryRun? : boolean;
	/**
	 * If true, log extra execution details
	 */
	verbose? : boolean;
	/**
	 * If true, log additional debug info during build
	 */
	debug? : boolean;
}

export namespace Compiler
{
	let project : SnapProject = null;

	/**
	 * Inserts the given source html into an html template, and returns the complete resulting html file contents as a string
	 * @param html The html-formatted story text to insert into the template
	 * @return The complete resulting html file contents as a string
	 */
	function ApplyTemplate(basePath : string, html : string) : string
	{
		let templatePath : string = path.resolve(basePath, project.template);
		if(!fs.existsSync(templatePath))
		{
			console.log(`Template file not found: "${templatePath}"`);
			process.exit(1);
		}
		if(!fs.lstatSync(templatePath).isFile())
		{
			console.log(`Template "${templatePath}" is not a file`);
			process.exit(1);
		}

		// Base template
		let template : string = fs.readFileSync(templatePath, "utf8");

		// Insert html content
		template = template.split("<!--{content}-->").join(html);
		
		if(project.outputFormat === 'minify')
		{
			return minifier.minify(template, {
				collapseWhitespace: true,
				minifyCSS: true,
				minifyJS: true,
				removeAttributeQuotes: true,
				removeComments: true,
				removeEmptyAttributes: true,
				removeEmptyElements: false, // The history and currentSection divs are empty; don't remove them!
				removeRedundantAttributes: true
			});
		}
		else if(project.outputFormat === 'prettify')
		{
			return beautifier.html(template);
		}
		else
		{
			return template;
		}
	}

	/**
	 * Deletes the given directory and all files and subdirectories within it
	 * @param targetPath The directory to delete
	 * @param options Compiler options blob
	 */
	function CleanDirectoryRecursive(targetPath: string, options : CompilerOptions)
	{
		if(fs.lstatSync(targetPath).isDirectory())
		{
			let files : Array<string> = fs.readdirSync(targetPath, "utf8");
			for(let i = 0; i < files.length; i++)
			{
				CleanDirectoryRecursive(path.resolve(targetPath, files[i]), options);
			}
			if(!options.dryRun) { fs.rmdirSync(targetPath); }
		}
		else
		{
			if(!options.dryRun) { fs.unlinkSync(targetPath); }
		}
	}

	/**
	 * Compile all source files described by the given project file into a static site distribution
	 * @param buildPath Path to the snap.json to build from
	 * @param options Compiler options blob
	 */
	export function Compile(buildPath : string, options : CompilerOptions) : void
	{
		let basePath = path.dirname(buildPath);

		// Load the target project file and overlay it onto the ProjectDefaults. This allows user-made project
		// files to only specify those properties which they want to override.
		let targetProject : SnapProject = JSON.parse(fs.readFileSync(buildPath, "utf8"));
		let validator = new ajv();
		let valid = validator.validate(JSON.parse(fs.readFileSync(path.join(__dirname, "../src/ProjectSchema.json"), "utf8")), targetProject);
		if(!valid)
		{
			LogError(`  ${buildPath}: Failed validating JSON`);
			for(let i = 0; i < validator.errors.length; i++)
			{
				LogError(`  ${validator.errors[i].dataPath} ${validator.errors[i].message} ${util.inspect(validator.errors[i].params)}`);
			}
			process.exit(1);
		}
		project = overrideJSON(ProjectDefaults, targetProject, true); // createNew

		// Validate inputs and outputs
		if(project.markdown.length < 1)
		{
			LogError("No Markdown input patterns were given (check the 'markdown' property in your snap.json)");
			process.exit(1);
		}
		if(project.output.length < 1)
		{
			LogError("No output directory was given (check the 'output' property in your snap.json)");
			process.exit(1);
		}
		if(options.dryRun) { console.log(clc.red("\n(This is a dry run. No output files will be written.)\n")); }

		// Create or clean output directory
		let cleanDir = path.resolve(basePath, project.output);
		if(!fs.existsSync(cleanDir)) { fs.mkdirSync(cleanDir); }
		else { CleanDirectoryRecursive(cleanDir, options); }

		// Gather all our target files to build
		let globOptions = {
			cwd: basePath,
			expandDirectories: true,
			ignore: project.ignore.concat(`${project.output}/**`),
			matchBase: true,
			nodir: true,
			nomount: true
		};
		let targets = {
			markdownFiles: globby.sync(project.markdown, globOptions),
			javascriptFiles: globby.sync(project.javascript, globOptions),
			assetFiles: globby.sync(project.assets, globOptions)
		};

		// Create output directory
		let outputDir = path.resolve(basePath, project.output);
		if(!fs.existsSync(outputDir)) { fs.mkdirSync(outputDir); }
		
		// Compile all the Markdown files
		for(let i = 0; i < targets.markdownFiles.length; i++)
		{
			if(options.verbose || options.dryRun) { LogAction(targets.markdownFiles[i], "render"); }

			let rendered : string = RenderFile(path.resolve(basePath, targets.markdownFiles[i]), options);
			if(rendered === null) { process.exit(1); }

			rendered = ApplyTemplate(basePath, rendered);
				
			let destinationFile = path.basename(targets.markdownFiles[i]).split(path.extname(targets.markdownFiles[i])).join(".html");
			let destinationPath : string = path.resolve(outputDir, destinationFile);

			if(options.verbose || options.dryRun) { LogAction(destinationPath, "output"); }
			if(!options.dryRun) { fs.writeFileSync(destinationPath, rendered, "utf8"); }
		}

		// Import all the Javascript files
		let javascript : string = "";
		for(let i = 0; i < targets.javascriptFiles.length; i++)
		{
			if(options.verbose || options.dryRun) { LogAction(targets.javascriptFiles[i], "import"); }
			javascript += `// ${targets.javascriptFiles[i]}\n${ImportFile(path.resolve(basePath, targets.javascriptFiles[i]))}\n`;
		}
		let scriptPath : string = path.join(outputDir, "script.js");
		if(options.verbose || options.dryRun) { LogAction(scriptPath, "output"); }
		if(!options.dryRun) { fs.writeFileSync(scriptPath, javascript, "utf8"); }

		// Copy all our assets
		for(let i = 0; i < targets.assetFiles.length; i++)
		{
			if(options.verbose || options.dryRun) { LogAction(targets.assetFiles[i], "copy"); }
			if(!options.dryRun)
			{
				let sourcePath = path.resolve(basePath, targets.assetFiles[i]);
				let destPath = path.resolve(outputDir, targets.assetFiles[i]);
				let destDir = path.dirname(destPath);
				if(!fs.existsSync(destDir)) { fs.mkdirSync(destDir); }
				fs.copyFileSync(sourcePath, destPath);
			}
		}

		console.log(clc.green(`Site deployed to ${outputDir}\n`));
	}

	/**
	 * Retrieves the text in between <a></a> tags for a CommonMark AST link node
	 * @param node The AST link node whose label you want to retrieve
	 * @return The link label (as rendered html), or null on error. If no error but the <a></a> tags are empty, returns an empty string instead of null.
	 */
	function GetLinkText(node) : string
	{
		if(node.type !== "link")
		{
			console.log(`GetLinkText received a node of type ${node.type}, which is illegal and will be skipped`);
			return null;
		}

		// Render the link node and then strip the <a></a> tags from it, leaving just the contents.
		// We do this to ensure that any formatting embedded inside the <a></a> tags is preserved.
		let html : string = markdownWriter.render(node);
		for(let i = 0; i < html.length; i++)
		{
			if(html[i] === ">")
			{
				html = html.substring(i + 1, html.length - 4);
				break;
			}
		}
		return html;
	}

	/**
	 * Reads and returns the raw contents of a file
	 * @param filepath The path and filename of the file to import
	 * @return The text contents of the file, or null on error
	 */
	function ImportFile(filepath : string) : string
	{
		if(!fs.existsSync(filepath))
		{
			console.log(`File not found: "${filepath}"`);
			process.exit(1);
		}
		if(!fs.lstatSync(filepath).isFile())
		{
			console.log(`"${filepath} is not a file`);
			process.exit(1);
		}
		return fs.readFileSync(filepath, "utf8");
	}

	/**
	* Check if a URL is considered external and its link should be marked with the external link mark defined in snap.json
	* @param url
	*/
	function IsExternalLink(url : string)
	{
		let tokens : Array<string> = url.split("/");
		switch(tokens[0].toLowerCase())
		{
			case "http:":
			case "https:":
			case "mailto:":
			{
				return true;
			}
		}
		return false;
	}

	/**
	 * Dumps the given AST to the console in a tree-like format.
	 * This doesn't render the AST; it's just a debug visualization of its current structure.
	 * @param ast The AST to display
	 */
	// @ts-ignore unused function warning
	function LogAST(ast)
	{
		if(ast === null) { return; }

		let indent : number = 0;
		let getIndent = function(indent)
		{
			let result : string = '';
			for(let i = 0; i < indent; i++) { result += '  '; }
			return result;
		};
		let walker = ast.walker();
		var event;
		while((event = walker.next()))
		{
			if(event.node.isContainer && !event.entering) { indent--; }
			if(!event.node.isContainer || event.entering)
			{
				console.log(clc.blue(`${getIndent(indent)}${event.node.type}: ${event.node.literal ? event.node.literal.split('\n').join('\\n') : ''}`));
			}
			if(event.node.isContainer && event.entering) { indent++; }
		}
	}

	/**
	 * Logs a consistently formatted file action to stdout
	 * @param filePath The path of the file an action was performed on
	 * @param action The action that was performed
	 */
	function LogAction(filePath : string, action: string)
	{
		console.log(`  ${clc.green(action)} ${filePath}`);
	}

	/**
	 * Logs a consistently formatted error message to stderr
	 * @param text The text to display
	 */
	function LogError(text : string)
	{
		console.error(clc.red(text));
	}

	/**
	 * Log a consistently-formatted parse error including the line/character number where the error occurred.
	 * @param text The error message to display.
	 * @param lineNumber The line where the error occurred.
	 * @param characterNumber The character within the line where the error occurred.
	 */
	function LogParseError(text : string, filePath : string, node, lineOffset? : number, columnOffset? : number)
	{
		if(node && node.sourcepos)
		{
			let line : number = node.sourcepos[0][0] + (lineOffset !== undefined ? lineOffset : 0);
			let column : number = node.sourcepos[0][1] + (columnOffset !== undefined ? columnOffset : 0);
			LogError(`${filePath} (${line},${column}): ${text}`);
		}
		else
		{
			LogError(`${filePath}: ${text}`);
		}
	}

	/**
	 * Renders the given Markdown file to HTML
	 * @param filepath The path and filename of the Markdown file to render
	 * @param options Compiler options blob
	 * @return The rendered HTML, or null on error
	 */
	function RenderFile(filepath : string, options : CompilerOptions) : string
	{
		if(!fs.existsSync(filepath))
		{
			console.log("File not found: " + filepath);
			process.exit(1);
		}

		// Read the Markdown source and apply alias replacements
		let markdown = ReplaceAliases(fs.readFileSync(filepath, "utf8"));

		// Parse the Markdown source into an Abstract Syntax Tree
		let ast = markdownReader.parse(markdown);
		if(options.debug)
		{
			console.log("\nRAW AST\n");
			LogAST(ast);
		}

		// Consolidate contiguous `text` nodes in the AST. I'm not sure why these get arbitrarily split up -- it does
		// seem to be triggered by punctuation -- but it's a huge pita to process macros that way.
		let walker = ast.walker();
		var event, node, prevNode;
		while((event = walker.next()))
		{
			node = event.node;
			if(node.type === "text" && prevNode && prevNode.type === "text")
			{
				if(node.literal) { prevNode.literal += node.literal; }
				node.unlink();
			}
			else
			{
				prevNode = node;
			}
		}

		if(options.debug)
		{
			console.log("\nCONSOLIDATED AST\n");
			LogAST(ast);
		}

		// Custom AST manipulation before rendering. When we're done, there should be no functional {macros} left in
		// the tree; they should all be rewritten to html tags with data-attributes describing their function.
		walker = ast.walker();
		while((event = walker.next()))
		{
			node = event.node;
			switch(node.type)
			{
				case "link":
				{
					if(!RenderLink(walker, event, filepath)) { return null; }
					break;
				}
				case "image":
				{
					if(!RenderImage(walker, event, filepath)) { return null; }
					break;
				}
			}
		}

		if(options.debug)
		{
			console.log("\nFINAL AST\n");
			LogAST(ast);
		}

		return markdownWriter.render(ast);
	}

	/**
	 * Rewrite the image tag to echo the alt text into the title attribute, so it appears on mouseover
	 * @param walker The current AST iterator state
	 * @param event The AST event to process (this should be a link node)
	 * @param filepath The path of the file we're currently processing (for error reporting)
	 * @returns True on success, false on error
	 */
	function RenderImage(walker, event, filepath : string) : boolean
	{
		if(!walker || !event)
		{
			LogParseError("RenderImage received an invalid state", filepath, event.node);
			return false;
		}
		if(event.node.type !== "image")
		{
			LogParseError(`RenderImage was passed a ${event.node.type} node, which is illegal`, filepath, event.node);
			return false;
		}

		let alt : string = "";
		if(event.node.firstChild && event.node.firstChild.type == "text")
		{
			alt = event.node.firstChild.literal;
			event.node.firstChild.unlink();
		}

		let url : string = event.node.destination;
		let newNode = new commonmark.Node("html_inline");
		newNode.literal = `<img src="${url}" alt="${alt}" title="${alt}">`;

		event.node.insertBefore(newNode);
		event.node.unlink();

		walker.resumeAt(newNode);
		return true;
	}

	/**
	 * Tag external links with an icon
	 * @param walker The current AST iterator state
	 * @param event The AST event to process (this should be a link node)
	 * @param filepath The path of the file we're currently processing (for error reporting)
	 * @returns True on success, false on error
	 */
	function RenderLink(walker, event, filepath : string) : boolean
	{
		if(!walker || !event)
		{
			LogParseError("RenderLink received an invalid state", filepath, event.node);
			return false;
		}
		if(event.node.type !== "link")
		{
			LogParseError(`RenderLink received a ${event.node.type} node, which is illegal`, filepath, event.node);
			return false;
		}
		if(IsExternalLink(event.node.destination))
		{
			if(event.entering)
			{
				// Add link tag before we enter the link's subtree, so the tag gets processed like any other text node
				let newNode = new commonmark.Node("html_inline", event.node.sourcepos);
				newNode.literal = project.linkTags.external.html;
				if(project.linkTags.external.prepend)
				{
					event.node.prependChild(newNode);
					walker.resumeAt(newNode);
				}
				else
				{
					event.node.appendChild(newNode);
				}
				return true;
			}
			else
			{
				return RewriteLinkNode(event.node, [
					{ "attr": "target", "value": "_blank"}, // Open links in a new window
					{ "attr": "href", "value": event.node.destination }
				], null);
			}
		}
		else
		{
			return true;
		}
	}

	/**
	 * Replaces aliases in the given Markdown source according to the "aliases" entry in the project config, and returns the new Markdown source.
	 * @param source The Markdown source text to parse
	 * @returns New Markdown source text with all aliases replaced
	 */
	function ReplaceAliases(source : string) : string
	{
		// Don't parse anything if there aren't any aliases defined
		if(project.aliases.length < 1) { return source; }

		let markdown : string = source;
		for(let i = 0; i < markdown.length; i++)
		{
			if(markdown[i] === '\\')
			{
				i = SkipEscapedSubstring(markdown, i);
				continue;
			}
			else if(markdown[i] === '{')
			{
				let bIsEnd : boolean = (markdown[i + 1] === '/');
				for(let j = i + 1; j < markdown.length; j++)
				{
					if(markdown[j] === '{')
					{
						// If there's another opening brace inside the macro, then this isn't an alias, so just ignore it
						i = j;
						break;
					}
					else if(markdown[j] === '}')
					{
						// This is the end of the macro; see if it's an alias, or something else
						let macro : string = markdown.substring(i, j + 1);
						let macroName : string = macro.substring(bIsEnd ? 2 : 1, macro.length - 1);
						let replacement: string = null;
						for(let k = 0; k < project.aliases.length; k++)
						{
							if(macroName === project.aliases[k].alias)
							{
								replacement = (bIsEnd ? project.aliases[k].end : project.aliases[k].replaceWith);
								break;
							}
						}
						if(replacement)
						{
							// Replace all occurrences of this macro and jump the scan index to the end of this instance
							markdown = markdown.split(macro).join(replacement);
							i += replacement.length - 1;
						}
						break;
					}
				}
			}
		}
		return markdown;
	}

	/**
	 * Rewrites a link node (from a CommonMark AST) applying the data attributes in dataAttrs appropriately.
	 * This function modifies the AST in-place by replacing the link node with an html_inline node that
	 * explicitly formats the rewritten <a> tag.
	 * @param node The AST link node to replace
	 * @param attributes Attributes to append, as {attr, value}
	 * @param linkText The text to place inside the <a></a> tags
	 * @param id The element id to assign
	 * @returns True on success, false on error
	 */
	function RewriteLinkNode(node, attributes : { attr : string, value : string }[], id : string) : boolean
	{
		if(node.type != "link")
		{
			console.log(`RewriteLinkNode received a node of type ${node.type}, which is illegal and will be skipped`);
			return false;
		}

		// Replace the link node with a new html_inline node to hold the rewritten <a> tag
		let newNode = new commonmark.Node("html_inline", node.sourcepos);
		let attrs : string = "";
		for(let i = 0; i < attributes.length; i++)
		{
			attrs += ` ${attributes[i].attr}="${attributes[i].value}"`;
		}
		newNode.literal = `<a ${attrs}`;
		if(id !== null) { newNode.literal += ` id="${id}"`; }
		newNode.literal += `>${GetLinkText(node)}</a>`;

		node.insertBefore(newNode);
		node.unlink();

		return true;
	}

	/**
	 * Output the command-line usage and options of the compiler
	 */
	export function ShowUsage()
	{
		console.log(``);
		console.log(`Usage:`);
		console.log(`${clc.green("node lib/CLI.js compile")} ${clc.blue("<siteDirectory|configFilePath>")} ${clc.yellow("[options]")}`);
		console.log(``);
		console.log(`${clc.blue("siteDirectory:")} The folder path where the site source files are located. Looks for snap.json in the root.`);
		console.log(`${clc.blue("configFilePath:")} If you want to build with a different config, specify the config.json path directly.`);
		console.log(``);
		console.log(`${clc.yellow("--dry-run:")} Log what would've been done, but don't actually touch any files.`);
		console.log(`${clc.yellow("--verbose:")} Log more detailed build information`);
		console.log(`${clc.yellow("--debug:")} Log debugging information during the build`);
		console.log(``);
		console.log(`${clc.green("node lib/CLI.js compile /Users/Desktop/MySite")} ${clc.yellow("--verbose")}`);
		console.log(``);
	}

	/**
	 * Helper function for character-wise string scanning. Given a string and the index of a \ character, skips to the
	 * end of the escape sequence and returns the index of the last character of the escape sequence. Most useful for
	 * skipping past escaped Snap macros, but can also skip regular escape sequences as well.
	 * @param s The string to scan
	 * @param startIndex The index of the \ character which begins the escape sequence to be skipped
	 * @returns The index of the last character of the escape sequence, or -1 on error (e.g. an unterminated Snap macro). If the starting character isn't a \ then this just returns startIndex.
	 */
	function SkipEscapedSubstring(s : string, startIndex : number)
	{
		// This isn't an escape at all
		if(s[startIndex] !== '\\') { return startIndex; }

		// This is a regular escape sequence, so just skip the escaped character
		if(s[startIndex + 1] !== '{') { return startIndex + 1; }

		// This is an escaped macro, so skip to the end of the macro
		let braceCount : number = 0;
		for(let i = startIndex + 1; i < s.length; i++)
		{
			if(s[i] === '{') { ++braceCount; }
			else if(s[i] === '}' && --braceCount === 0) { return i; }
		}

		return -1;
	}
}
