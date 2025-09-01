import fs from 'fs';
import path from 'path';
import child from 'child-process-promise';
import glob from 'glob';
import readline from 'readline';
import downloadFile from './dl.js';
import { ensureDir, grepPrefix } from './files.js';
import { PackageRequirements } from './predict.js';


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
        pkg = pkg.toLowerCase();
        return path.join(this.opts.metadir, 'tlpobj', `${pkg}.tlpobj`);
    }

    has(pkg) {
        return fs.existsSync(this.tlpobj(pkg));
    }

    listFiles(pkg) {
        for (let fn of this.getFiles(pkg))
            console.log(fn);
    }

    getFiles(pkg) { return this._getFiles(this.tlpobj(pkg)); }
    getModules(pkg) { return this._getModules(this.tlpobj(pkg)); }
    getClasses(pkg) { return this._getClasses(this.tlpobj(pkg)); }
    getProvided(pkg) { return this._getProvided(this.tlpobj(pkg)); }
    getFontMaps(pkg) { return this._getFontMaps(this.tlpobj(pkg)); }

    _pkgName(tlpobj) {
        return path.basename(tlpobj).replace(/[.]tlpobj$/, '');
    }

    _getFiles(tlpobj) {
        var relocs = grepPrefix(tlpobj, [' ']);
        return relocs.map(({ln}) => ln.replace(/^\s+RELOC\//, ''));
    }

    _getModules(tlpobj) {
        return this._getFiles(tlpobj)
            .map(fn => fn.match(/([^/]+)[.](sty|tex|ltx)$/)?.[1]).filter(x => x);
    }

    _getClasses(tlpobj) {
        return this._getFiles(tlpobj)
            .map(fn => fn.match(/([^/]+)[.](cls)$/)?.[1]).filter(x => x);
    }

    _getProvided(tlpobj) {
        return [].concat(this._getModules(tlpobj), this._getClasses(tlpobj));
    }

    _getFontMaps(tlpobj) {
        return this._getFiles(tlpobj).filter(fn => fn.match(/[.]map$/));
    }

    async probe(pkgs, opts) {
        var tmp = this.opts.tmpdir, fn = path.join(tmp, 'probe.tex'),
            classes = [];
        if (opts.pkg) {
            let scan = pkgs.map(pkg => this.scanPkg(pkg, opts));
            pkgs = [].concat(...scan.map(s => s.modules));
            classes = [].concat(...scan.map(s => s.classes));
        }
        // Prepare input
        fs.mkdirSync(tmp, {recursive: true});
        fs.writeFileSync(fn, `
            \\documentclass${this._pkgref(opts.class ?? classes[0] ?? 'article')}
            ${pkgs.map(pkg => `\\usepackage${this._pkgref(pkg)}`).join('\n')}
            \\begin{document} \\end{document}
        `);

        // Clean .aux file from a previous run, if any (as it may skew the results)
        try { fs.unlinkSync(path.join(tmp, 'probe.aux')); } catch { }

        // Run pdflatex
        try { await this._pdflatex(opts, fn); } catch { return; }

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

    scanPkg(pkg, opts) {
        try       { var modules = this.getModules(pkg),
                        classes = this.getClasses(pkg); }
        catch (e) { if (opts.tenacious) return []; else throw e; }

        this.db.recordModules(pkg, [].concat(modules, classes));
        return {modules, classes};
    }

    async mktexlsr() {
        await child.spawn(path.join(this.opts.bindir, 'mktexlsr'), [], {
                env: {'PATH': `${this.opts.bindir}:${process.env['PATH']}`},
                stdio: 'inherit'
            });
    }

    async install(pkgs) {
        if (!Array.isArray(pkgs)) pkgs = [pkgs];
        let added = 0;
        for (let pkg of pkgs) {
            if (!this.has(pkg)) { await this.remote.fetch(pkg); added++; }
            else console.log(`${pkg} already installed.`)
        }
        console.log(`${added} package(s) added.`);
        if (added)
            await this.mktexlsr();
    }

    async predictDeps(sources, opts) {
        /* parse source list: path specs are treated as filenames,
         * plain identifiers (containing no `.` or `/`) are module names. */
        let texSources = [], additionalModules = [];
        for (let el of sources) {
            if (el.includes('.') || el.includes('/'))
                texSources.push(fs.readFileSync(el, 'utf-8'));
            else
                additionalModules.push(el);
        }

        await this.db.open();
        let preq = new PackageRequirements(this.db),
            pkgs = preq.predictDeps(texSources, additionalModules);

        if (opts.graph) {
            console.log(preq.dependencyGraph(pkgs));
        }
        else {
            for (let pkg of pkgs) console.log(pkg);
        }
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

    async _pdflatex(opts, ...args) {
        var outdir = `-output-directory=${this.opts.tmpdir}`;
        try {
            await child.spawn(this._bin('pdflatex'),
                [outdir, '-interaction', 'nonstopmode', ...args],
                {stdio: ['ignore', 'inherit', 'inherit'],
                 env: {"max_print_line": 99999}});
        }
        catch (e) {
            console.log(`[nanotex] pdflatex terminated with code=${e.code}`);
            if (!opts.tenacious) throw e;
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
        distdir: rel('tldist'),
        metadir: rel('tldist/tlpkg'),
        dbfn: rel('data/texlive2021-pkg-info.json'),
        bindir: rel('bin'),
        tmpdir: '/tmp/nanotex'
    };
}


class PackageInfoDB {
    constructor(opts) { this.opts = opts; }

    async open() { if (!this.root) await this.load(); }

    async load() {
        this.root = null;
        let http = this.opts.dbfn.match(/^http:(.*)$/);
        if (http) {
            this.root = await (await fetch(http[1])).json();
        }
        else {
            try { fs.statSync(this.opts.dbfn); }
            catch { this.root = {}; console.warn(`[nanotex] package database '${this.opts.dbfn}' not found`); }
            this.root ??= JSON.parse(fs.readFileSync(this.opts.dbfn));
        }
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

    recordModules(pkg, provides) {
        this.open();
        (this.pkgs[pkg] ??= {}).provides = provides;
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
        let fn = `${pkg.toLowerCase()}.tar.xz`,
            outFn = path.join(ensureDir(this.opts.archivedir), fn);
        await downloadFile(`${this.opts.baseUri}/archive/${fn}`,outFn);

        let p = await child.spawn('tar', ['xvf', outFn, '-C', ensureDir(this.opts.distdir)],
            { capture: [ 'stdout', 'stderr' ]});
        console.log(`  (${p.stderr.split('\n').length} files)`)
    }

    get indexFilePath() {
        return path.join(this.opts.tmpdir, this.opts.indexFn)
    }

    async fetchIndex() {
        fs.mkdirSync(this.opts.tmpdir, {recursive: true});
        await downloadFile(`${this.opts.baseUri}/${this.opts.indexPath}`, 
                           this.indexFilePath);
    }

    async fetchIndexM() {
        if (!fs.existsSync(this.indexFilePath))
            await this.fetchIndex();
    }

    async listPackages() {
        for await (const pkg of this.packageNames())
            console.log(pkg);
    }

    async listPackagesWith(ext = '.sty') {
        for await (const pkg of this.packageNamesWith(ext))
            console.log(pkg);
    }

    async *packageNames() {
        for await (const {name} of this._dbEntries())
            if (name) yield name;
    }

    async *packageNamesWith(ext = '.sty') {
        let cur = undefined;
        for await (const {name, file} of this._dbEntries()) {
            if (name) cur = name;
            if (cur && file && file.endsWith(ext)) 
                { yield cur; cur = undefined; }
        }
    }

    async *_dbEntries() {
        const lzma = await import('lzma-native');
        await this.fetchIndexM();
        const rl = readline.createInterface({
            input: fs.createReadStream(this.indexFilePath)
                     .pipe(lzma.createDecompressor()),
            terminal: false
        });

        for await (const ln of rl) {
            let mo = ln.match(/^name (.*)/);
            if (mo) yield {name: mo[1]};
            if (ln.startsWith(' ')) yield {file: ln.slice(1)};
        }
    }

    static OPTS = {
        //baseUri: 'https://ftp.tu-chemnitz.de/pub/tug/historic/systems/texlive/2025/tlnet-final',
        baseUri: 'https://ftp.cc.uoc.gr/mirrors/CTAN/systems/texlive/tlnet',
        indexPath: 'tlpkg/texlive.tlpdb.xz',
        archivedir: rel('tlarchive'),
        distdir: rel('tldist'),
        tmpdir: '/tmp/nanotex',
        indexFn: 'tlpdb.xz'
    }
}


function rel(fp) {
    return typeof import.meta === 'undefined' ? fp
        : path.join(path.dirname(import.meta.url).replace(/^file:/, ''), '..', fp);
}


export { PackageRepository, PackageInfoDB, RemotePackageRepository, rel }
