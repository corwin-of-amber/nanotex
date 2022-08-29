#!/usr/bin/env node

import assert from 'assert';
import fs from 'fs';
import path from 'path';

import commander from 'commander';
import child from 'child-process-promise';
import glob from 'glob';

import { PackageRepository } from './repo.js';


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
        /** @oops `./` is somehow needed for locally built gftopk */
        await child.spawn('./bin/gftopk', ['./' + outgf, outpk],
            {stdio: ['ignore', 'inherit', 'inherit']});
    }

    mkmap(pkgNames, mapfile = 'dist/pdftex.map') {

        var actions = packageRepository.collectActions(),
            entries = pkgNames.length > 0 ? 
                pkgNames.map(k => actions[k]).filter(x => x) :
                Object.values(actions),
            inputs = [];

        for (let v of entries)
            for (let [cmd, ...args] of v)
                if (['addMap', 'addMixedMap'].includes(cmd))
                    inputs.push(...args);

        if (inputs.length == 0) {
            console.warn(`warning: no font maps found for packages [${pkgNames}]`);
            return;
        }

        console.log(inputs);

        var entries = this.grepMapEntries(inputs),
            map = guard(() => fs.readFileSync(mapfile, 'utf-8'), ''),
            existing = new Set([...map.matchAll(/^\S+/mg)].map(mo => mo[0])),
            count = 0;

        if (!map.endsWith('\n')) map += '\n';

        for (let {key, ln} of entries) {
            if (!existing.has(key)) {
                existing.add(key);
                map += `${ln}\n`;
                count++;
            }
        }

        if (count) fs.writeFileSync(mapfile, map);

        console.log(`added ${count} font map entries.`);
    }

    grepMapEntries(filenames) {
        var d = this.opts.mapdir, pat = ln => {
            var mo = ln.match(/^(\S+) .*<\S+[.]pfb$/);
            return mo && {key: mo[1], ln: mo[0]};
        };
        return [].concat(...filenames.map(fn =>
                   [].concat(...glob.sync(`${d}/**/${fn}`).map(fn =>
                       readlines(fn).map(pat).filter(x => x)))));
    }

    grepMaps(fonts) {
        var d = this.opts.mapdir, prefixes = fonts.map(x => `${x} `);
        return [].concat(...
            glob.sync(`${d}/**/*.map`).map(fn => grepPrefix(fn, prefixes)));
    }

    async buildFonts(fonts, opts) {
        if (opts.map) {
            this.mkmap(fonts); return;
        }

        for (let font of fonts) {
            try {
                if (opts.pk)
                    await this.mktexpk(font);
                else {
                    console.log("error: what to do?"); throw new BuildError();
                }
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


const packageRepository = new PackageRepository();


class BuildError { }


function ensureDir(d) { assert(d); fs.mkdirSync(d, {recursive: true}); return d; }
function readlines(filename) { return fs.readFileSync(filename, 'utf-8').split('\n'); }
function guard(op, fallback = '') { try { return op(); } catch { return fallback; } }

function grepPrefix(filename, prefixes) {
    return readlines(filename).map(ln => {
        var m = prefixes.find(p => ln.startsWith(p));
        return m && {key: m, ln};
    }).filter(x => x);
}


function main() {
    var o = commander
        .description('nanoTeX installation manager')
        .option('--pkg-info <json>', 'location of the package db (`pkg-info.json`)')
        .option('--trace', 'show full trace in case of error')
        .option('--tenacious', 'continue in spite of errors');

    let copts = opts => ({...o.opts(), ...opts});

    o.on('option:pkg-info', json => packageRepository.opts.dbfn = json);

    o.command('font')
     .option('--pk', 'create bitmap fonts (.600pk)')
     .option('--map', 'update main map file with pfb associations')
     .action((opts, {args}) => fontFoundry.buildFonts(args, copts(opts)));

    o.command('ls')
     .action((opts, {args}) =>
        args.forEach(pkg => packageRepository.listFiles(pkg)));

    o.command('probe')
     .description('precompute and store dependencies of a module or package')
     .option('--class <name>', 'set the document class [default: `article`]')
     .option('--pkg', 'interpret arguments as package names and ' +
                      'probe all `.sty` modules therein')
     .action((opts, {args}) => packageRepository.probe(args, copts(opts)));

    o.command('install <pkgs...>')
     .action(async (pkgs) => packageRepository.install(pkgs));

    o.command('deps <sources...>')
     .description('get the list of packages needed to ' +
                  'compile the given TeX sources')
     .action(async (sources) => packageRepository.predictDeps(sources));

    o.parseAsync(process.argv)
        .catch(err => {
            if (o.opts().trace) console.error(err);
            else if (!(err instanceof BuildError))
                console.error(`error:\n${err}`);
            process.exit(1);
        });
}


main();
