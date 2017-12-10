# Snap

> NOTE: Snap is in **very early** development and is not even remotely ready for prime-time. You probably shouldn't use it yet!

Snap is a simple static site generator which turns Markdown into HTML. It's kind of like [Jekyll](https://jekyllrb.com) but a lot simpler.

Snap is licensed under [AGPL-3.0+](https://github.com/invicticide/snap/blob/dev/license.md).

## Installation

Install [node.js](https://nodejs.org) by downloading it and running the installer. (Snap is currently developed on version 8.9.0 LTS.)

Install Snap:

	npm install -g snap

## Snap projects

Snap projects consist primarily of Markdown (.md) files, each of which corresponds to a single page in your site. At a minimum, all sites should have an `index.md` which will turn into your `index.html` once you build the site.

Snap projects can also contain Javascript (.js) files and additional assets (images, etc.). 

You can create a new project like this:

	snap create path/to/my/site

In the new project folder you'll see a structure like this:

	site
	|- assets/
	|- source/
	|- snap.json
	|- template.html

The `snap.json` is your **project file**. It contains all your project settings, like rules for where to find source files and where builds should go. If you take a peek inside, you'll see the default rules:

	markdown: [ "source/**/*.md" ],
	javascript: [ "source/**/*.js" ],
	assets: [ "assets/**" ],
	ignore: [],
	template: "template.html",
	output: "build",

These are in [glob syntax](https://github.com/isaacs/node-glob#glob-primer). Note that by default Snap expects to find all your Markdown and Javascript files in `source`, and anything else in `assets`.

## Basics

Page content is written in [Markdown](http://commonmark.org/help/).

Your `template.html` (or whatever you've set as `template` in your `snap.json`) defines a wrapper for this content. It's here that you would do any fancy layout, link in a stylesheet, set up boilerplate stuff like a nav bar or site footer, etc. Each Markdown file generates a corresponding HTML file which is a copy of this template, with the rendered Markdown content inserted at the position of the `<!--{content}-->` comment in the template.

## Aliases

Since Markdown also accepts HTML, you could style some text like this:

	On this site, some things are <span style="color:red">displayed in red</span>!

While functional, this looks ugly and makes your source text harder to read. It's also a lot to type out, and if you're going to be styling things consistently, you have to copy the same HTML snippet over and over again, which creates an opportunity for bugs to arise.

To solve this problem (and others like it) you can define custom macros, called **aliases**, which expand to other text or markup at compile-time. In your `snap.json` simply add some rules to the `aliases` field, like this:

	"aliases": [
		{ "alias": "red", "replaceWith": "<span style='color:red'>", "end": "</span>" },
		{ "alias": "blue", "replaceWith": "<span style='color:blue'>", "end": "</span>" }
	],

Then refer to the alias in your story text like this:

	In this story, some things are {red}displayed in red{/red}!

When you build your site, all instances of `{red}` will be replaced with `<span style='color:red'>` and all instances of `{/red}` will be replaced with `</span>`. If later you wanted to change all your red text to a more specific shade of red (for example) you could simply edit your alias like this, then rebuild your story and all existing usages of the `{red}` alias would be automatically updated:

	"aliases": [
		{ "alias": "red", "replaceWith": "<span style='color:#ff8888'>", "end": "</span>" },
		{ "alias": "blue", "replaceWith": "<span style='color:#8888ff'>", "end": "</span>" }
	],

If you need to use the `{` characters in your content directly (i.e. without it being interpreted as an alias) you can escape like `\{`.

## Adding multimedia

You can add multimedia elements, like images or videos, to your site. In most cases you'll just put those files in `assets` and then source them in your Markdown file. For example, you can place images like this:

	![Image alt text](assets/image.png)

Anything in `assets` gets copied over to your build output location when you publish your story, and the directory structure is preserved. (When writing asset paths in Markdown or Javascript, they should be relative to the project root, not the Markdown/Javascript file itself.)

Markdown also allows raw HTML, so you could embed e.g. a YouTube video using its normal embed code. A section with a video might look like this:

	{{VideoSection}}

	Here's a video!

	<iframe width="854" height="480" src="https://www.youtube.com/embed/dQw4w9WgXcQ" frameborder="0" gesture="media" allowfullscreen></iframe>

	Pretty sweet, yeah?

## Templates

You can control the visual layout and style of your site by providing a custom HTML template. When you create a new project via the Snap CLI, a basic `template.html` is created in your project root. You can edit or replace this at your leisure.

A template is a regular HTML file that includes a special macro: `<!--{content}-->` indicates where rendered Markdown content should be inserted. Generally you should put this inside your `<body>`.

You can also style your site with custom CSS; just source or embed it with `<style></style>` tags in the `<head>` of your HTML template.

## Publishing

When you're ready to share or test your site, you need to publish it:

	snap compile path/to/my/site

Snap will compile all Markdown, Javascript, and asset files in the given story folder and spit out HTML, Javascript, and asset files in the `output` directory defined in your `snap.json`. Simply open the output `index.html` in a browser to test, or upload it to your web server to publish it to the world.

If you specify a directory, Snap will look for a `snap.json` at that location, and use the settings it finds there to build the site. If you specify a path to a .json file, Snap will use that as the project file instead.

## Contributing

Fork the Snap repo on GitHub, then clone your fork:

	mkdir snap
	git clone git@github.com:path/to/your/fork.git snap

Install dependencies (this will also build Snap for the first time):

	cd snap
	npm install

Snap requires TypeScript 2.6, which is installed as a default dependency when you do `npm install` and invoked when you do `npm run build`. If you have a separate global install of TypeScript (e.g. at one point you did `npm install -g typescript`) you could also compile your changes by just doing `tsc` provided your global install is at least version 2.6. On Mac and *nix, you can use `which tsc` to find your global install, or on Windows, open the Node.js command prompt and do `where tsc`. That said, it's strongly recommended to just use `npm run build` instead. ;)

To test changes against a sample site, first build the Snap source into a local package:

	cd snap
	npm pack

Then install it locally into your site project:

	cd path/to/site
	npm install path/to/snap/snap-x.x.x.tgz

Then rebuild your story project:

	./node_modules/.bin/snap compile .

And finally, launch the resulting `index.html` and perform your tests.
