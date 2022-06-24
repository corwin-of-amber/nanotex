#!/usr/bin/env node

import assert from 'assert';
import fs from 'fs';
import path from 'path';

import commander from 'commander';
import child from 'child-process-promise';
import glob from 'glob';

import downloadFile from './dl.js';


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


class PackageRepository {

    constructor(opts = PackageRepository.OPTS) {
        this.opts = opts;
        this.db = new PackageInfoDB(opts);
        this.remote = new RemotePackageRepository();
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

    has(pkg) {
        return fs.existsSync(this.tlpobj(pkg));
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
        // Prepare input
        fs.mkdirSync(tmp, {recursive: true});
        fs.writeFileSync(fn, `
            \\documentclass${this._pkgref(opts.class ?? 'article')}
            ${pkgs.map(pkg => `\\usepackage${this._pkgref(pkg)}`).join('\n')}
            \\begin{document} \\end{document}
        `);

        // Clean .aux file from a previous run, if any (as it may skew the results)
        try { fs.unlinkSync(path.join(tmp, 'probe.aux')); } catch { }

        // Run pdflatex
        try { await this._pdflatex(fn); } catch { return; }

        // Analyze pdflatex log file
        var logText = fs.readFileSync(fn.replace(/[.]tex$/, '.log'), 'utf-8'),
            deps = {files: this._parseFileDeps(logText), pkgs: {}},
            idx = this.fileIndex();
        for (let [k, v] of Object.entries(deps.files)) {
            for (let from of idx.byFilename.get(k) ?? [])
                for (let to of [].concat(...v.map(fn => 
                                    idx.byFilename.get(fn) ?? [])))
                    if (from !== to)
                        (deps.pkgs[from] ??= new Set).add(to);
        }
        console.log(deps.pkgs);
        this.db.recordDeps(deps.pkgs);
        this.db.save();
    }

    async mktexlsr() {
        await child.spawn('./bin/mktexlsr', [], {
                env: {'PATH': `${this.opts.bindir}:${process.env['PATH']}`},
                stdio: 'inherit'
            });
    }

    async install(pkgs) {
        if (!Array.isArray(pkgs)) pkgs = [pkgs];
        for (let pkg of pkgs) {
            if (!this.has(pkg)) await this.remote.fetch(pkg);
            else console.log(`${pkg} already installed.`)
        }
        await this.mktexlsr();
    }

    /**
     * Specify `package:options` or `[options]package` to set options
     */
    _pkgref(pkg) {
        var mo1 = pkg.match(/^(\[.*?\])(.*)$/),
            mo2 = pkg.match(/^(.*?):(.*)$/);
        return mo1 ? `${mo1[1]}{${mo1[2]}}` : 
               mo2 ? `[${mo2[2]}]{${mo2[1]}}` : `{${pkg}}`;
    }

    async _pdflatex(...args) {
        var outdir = `-output-directory=${this.opts.tmpdir}`;
        try {
            await child.spawn(this._bin('pdflatex'), [outdir, ...args],
                {stdio: ['ignore', 'inherit', 'inherit'],
                 env: {"max_print_line": 99999}});
        }
        catch (e) {
            console.log(`[nanotex] pdflatex terminated with code=${e.code}`);
            throw e;
        }
    }

    _bin(fn) { return path.join(this.opts.bindir, fn); }

    _parseFileDeps(logText) {
        var trace = logText.matchAll(/[()]|[/][\w./]+[/]tldist[/][^\s()]+/g),
            stack = [], deps = {};

        for (let mo of trace) {
            if (mo[0] == '(') stack.push('-');
            else if (mo[0] == ')') stack.pop();
            else if (stack.slice(-1)[0] == '-') {
                var from = [...stack].reverse().find(x => x !== '-'),
                    to = path.basename(mo[0]);
                stack.splice(-1, 1, to);
                if (from)
                    (deps[from] ??= []).push(to);
            }
        }
        if (stack.length) console.warn("dependency stack not empty");
        return deps;
    }

    static OPTS = {
        metadir: 'tldist/tlpkg',
        dbfn: 'data/pkg-info.json',
        bindir: 'bin',
        tmpdir: '/tmp/nanotex'
    };
}


class PackageInfoDB {
    constructor(opts) { this.opts = opts; }

    open() { if (!this.root) this.load(); }

    load() {
        this.root = null;
        try { fs.statSync(this.opts.dbfn); } catch { this.root = {}; }
        this.root ??= JSON.parse(fs.readFileSync(this.opts.dbfn));
        this.pkgs = this.root.packages ??= {};
    }

    save() {
        if (this.root) {
            fs.mkdirSync(path.dirname(this.opts.dbfn), {recursive: true});
            fs.writeFileSync(this.opts.dbfn, JSON.stringify(this.root, null, 2));
        }
    }

    recordDeps(pkg, deps) {
        if (typeof pkg == 'object') {
            for (let [k, deps] of Object.entries(pkg))
                this.recordDeps(k, deps);
        }
        else {
            this.open();
            var pre = (this.pkgs[pkg] ??= {}).deps ??= [];
            for (let d of deps)
                if (!pre.includes(d)) pre.push(d);
        }
    }
}


class RemotePackageRepository {

    constructor(opts = RemotePackageRepository.OPTS) {
        this.opts = opts;
    }

    async fetch(pkg) {
        if (Array.isArray(pkg)) {
            for (let pk of pkg) await this.fetch(pk);
            return;
        }
        let fn = `${pkg}.tar.xz`,
            outFn = path.join(ensureDir(this.opts.archivedir), fn);
        await downloadFile(`${this.opts.baseUri}/archive/${fn}`,outFn);

        let p = await child.spawn('tar', ['xvf', outFn, '-C', ensureDir(this.opts.distdir)],
            { capture: [ 'stdout', 'stderr' ]});
        console.log(`  (${p.stderr.split('\n').length} files)`)
    }

    fetchIndex() {
        fs.mkdirSync(this.opts.tmpdir, {recursive: true});
        downloadFile(`${this.opts.baseUri}/${this.opts.indexPath}`, 
                     path.join(this.opts.tmpdir, this.opts.indexFn));
    }

    static OPTS = {
        baseUri: 'https://ftp.cc.uoc.gr/mirrors/CTAN/systems/texlive/tlnet',
        indexPath: 'tlpkg/texlive.tlpdb.xz',
        archivedir: 'tlarchive',
        distdir: 'tldist',
        tmpdir: '/tmp/nanotex',
        indexFn: 'tlpdb.xz'
    }
}


const packageRepository = new PackageRepository();
const remoteRepository = new RemotePackageRepository();


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

    o.command('install')
     .action(async (opts, {args}) => packageRepository.install(args));

    o.parseAsync(process.argv)
        .catch(err => {
            if (err instanceof BuildError) process.exit(1);
            else throw err;
        });
}


main();
