#!/usr/bin/env node

import assert from 'assert';
import fs from 'fs';
import path from 'path';

import commander from 'commander';
import child from 'child-process-promise';
import glob from 'glob';


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


class PackageRepository {

    constructor(opts = PackageRepository.OPTS) {
        this.opts = opts;
    }

    collectActions() {
        return Object.fromEntries(this.tlpobjs().map(fn => {
            let actions = grepPrefix(fn, ['execute'])
                .map(({ln}) => ln.split(/\s+/).slice(1));
            if (actions.length) return [this._pkgName(fn), actions];
        }).filter(x => x));
    }

    collectFiles() {
        return Object.fromEntries(this.tlpobjs().map(fn => 
            [this._pkgName(fn), this._getFiles(fn)]));
    }

    fileIndex() {
        var byPackage = this.collectFiles(),
            byFilename = this._byFilename(byPackage);

        return {byPackage, byFilename};
    }
        
    _byFilename(byPackage) {
        var byFilename = new Map();
        for (let [pkg, fns] of Object.entries(byPackage)) {
            for (let fn of fns) {
                var key = path.basename(fn),
                    v = byFilename.get(key);
                if (!v) byFilename.set(key, v = []);
                v.push(pkg);
            }
        }
        return byFilename;
    }

    tlpobjs() {
        return glob.sync(`${this.opts.metadir}/**/*.tlpobj`);
    }

    tlpobj(pkg) {
        return path.join(this.opts.metadir, 'tlpobj', `${pkg}.tlpobj`);
    }

    listFiles(pkg) {
        for (let fn of this.getFiles(pkg))
            console.log(fn);
    }

    getFiles(pkg) {
        return this._getFiles(this.tlpobj(pkg));
    }

    _pkgName(tlpobj) {
        return path.basename(tlpobj).replace(/[.]tlpobj$/, '');
    }

    _getFiles(tlpobj) {
        var relocs = grepPrefix(tlpobj, [' ']);
        return relocs.map(({ln}) => ln.replace(/^\s+RELOC\//, ''));
    }

    async probe(pkgs, opts) {
        var tmp = this.opts.tmpdir, fn = path.join(tmp, 'probe.tex');
        fs.mkdirSync(tmp, {recursive: true});
        fs.writeFileSync(fn, `
            \\RequirePackage{snapshot}
            \\documentclass{${opts.class ?? 'article'}}
            ${pkgs.map(pkg => `\\usepackage{${pkg}}`).join('\n')}
            \\begin{document} \\end{document}
        `);

        try { await this._pdflatex(fn); } catch { return; }

        var depsText = fs.readFileSync(fn.replace(/[.]tex$/, '.dep'), 'utf-8'),
            deps = depsText.split(/\n+/).map(ln => {
                var mo = / \*{(.*?)}\s*{(.*?)}/.exec(ln);
                return mo && {kind: mo[1], name: mo[2]};
            }).filter(x => x);
        console.log(deps);

        var idx = this.fileIndex(),
            pkgs = new Set();
        for (let {kind, name} of deps) {
            var keys = [];
            switch (kind) {
                case 'file': keys = [name, `${name}.tex`]; break;
                case 'class': keys = [`${name}.cls`]; break;
                case 'package': keys = [`${name}.sty`]; break;
            }
            var lu = [].concat(...
                keys.map(key => idx.byFilename.get(key) ?? []));
            console.log(kind, name, lu);
            for (let pkg of lu) pkgs.add(pkg);
        }
        pkgs.delete('snapshot');
        console.log([...pkgs].join(' '));
        return pkgs;
    }

    async _pdflatex(...args) {
        var outdir = `-output-directory=${this.opts.tmpdir}`;
        try {
            await child.spawn(this._bin('pdflatex'), [outdir, ...args],
                {stdio: ['ignore', 'inherit', 'inherit']});
        }
        catch (e) {
            console.log(`[nanotex] pdflatex terminated with code=${e.code}`);
            throw e;
        }
    }

    _bin(fn) { return path.join(this.opts.bindir, fn); }

    static OPTS = {
        metadir: 'tldist/tlpkg',
        bindir: 'bin',
        tmpdir: '/tmp/nanotex'
    };
}

const packageRepository = new PackageRepository();


class BuildError { }


function ensureDir(d) { assert(d); mkdir.sync(d, {recursive: true}); return d; }
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
        .description('nanoTeX installation manager');

    o.command('font')
     .option('--pk', 'create bitmap fonts (.600pk)')
     .option('--map', 'update main map file with pfb associations')
     .action((opts, {args}) => fontFoundry.buildFonts(args, opts));

    o.command('ls')
     .action((opts, {args}) =>
        args.forEach(pkg => packageRepository.listFiles(pkg)));

    o.command('probe')
     .option('--class <name>', 'set the document class [default: `article`]')
     .action((opts, {args}) => packageRepository.probe(args, opts));

    o.parseAsync(process.argv)
        .catch(err => {
            if (err instanceof BuildError) process.exit(1);
            else throw err;
        });
}


main();
