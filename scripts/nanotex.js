#!/usr/bin/env node

import assert from 'assert';
import fs from 'fs';
import path from 'path';

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
        return ensureDir(this.opts.outdir);
    }

    distdir(forType) {
        return ensureDir(this.opts.distdirs[forType]);
    }

    async mktexpk(fontName, opts={}) {
        var outdir = `-output-directory=${this.outdir()}`,
            directive = `\\mode:=${opts.mode ?? 'ljfour'}; mag:=1+0/600; input ${fontName}`;
        await child.spawn('./bin/mf', [outdir, directive],
            {stdio: ['ignore', 'inherit', 'inherit']});

        // Move tfm to dist dir
        var outtfm = path.join(this.outdir(), `${fontName}.tfm`),
            disttfm = path.join(this.distdir('tfm'), `${fontName}.tfm`);
        console.log(`[mv] ${outtfm} --> ${disttfm}`);
        fs.renameSync(outtfm, disttfm);

        // Pack font using `gstopk`
        var outgf = path.join(this.outdir(), `${fontName}.600gf`),
            outpk = path.join(this.distdir('pk'), `${fontName}.600pk`);
        console.log(`[gftopk] ${outgf} --> ${outpk}`);
        /** @todo using system `gftopk` */
        await child.spawn('gftopk', [outgf, outpk],
            {stdio: ['ignore', 'inherit', 'inherit']});
    }

    async buildFonts(fonts) {
        for (let font of fonts) {
            try {
                await this.mktexpk(font);
            }
            catch (e) {
                if (typeof e.code === 'number') throw new BuildError();
                else throw e;
            }
        }
    }

    static OPTS = {
        outdir: '_build/fonts',
        mapdir: 'tldist/fonts/map/dvips',
        distdirs: {
            pk: 'dist/fonts/compiled/pk',
            tfm: 'dist/fonts/compiled/tfm'
        }
    };
}

const fontFoundry = new FontFoundry();


class BuildError { }


function ensureDir(d) { assert(d); mkdirp.sync(d); return d; }


function main() {
    var o = commander
        .description('nanoTeX installation manager');

    o.command('font')
     .action((opts, {args}) => fontFoundry.buildFonts(args));

    o.parseAsync(process.argv)
        .catch(err => {
            if (err instanceof BuildError) process.exit(1);
            else throw err;
        });
}


main();
