#!/usr/bin/env node

import commander from 'commander';
import mkdirp from 'mkdirp';
import child from 'child-process-promise';


/**
 * Responsible for building fonts (with mf) and fontmaps.
 */
class FontFoundry {

    constructor(opts = FontFoundry.OPTS) {
        this.opts = opts;
    }

    outdir() {
        mkdirp.sync(this.opts.outdir);
        return this.opts.outdir;
    }

    mktexpk(fontName, opts={}) {
        console.log(fontName);
        var outdir = `-output-directory=${this.outdir()}`,
            directive = `\\mode:=${opts.mode ?? 'ljfour'}; mag:=1+0/600; input ${fontName}`;
        return child.spawn("./bin/mf", [outdir, directive],
            {stdio: ['ignore', 'inherit', 'inherit']});
    }

    async buildFonts(fonts) {
        for (let font of fonts) {
            try {
                await this.mktexpk(font);
            }
            catch (e) {
                if (e.code) throw new BuildError();
            }
        }
    }

    static OPTS = {
        outdir: '_build/fonts', mapdir: 'tldist/fonts/map/dvips'
    };
}

const fontFoundry = new FontFoundry();


class BuildError { }


function main() {
    var o = commander
        .description('nanoTeX installation manager');

    o.command('font')
     .action((opts, {args}) => fontFoundry.buildFonts(args));

    o.parseAsync(process.argv)
        .catch(err => {
            if (err instanceof BuildError) process.exit(1);
        });
}


main();
