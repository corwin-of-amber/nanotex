

class PackageRequirements {

    constructor(infoDB) { this.db = infoDB; }

    predictDeps(texSources, additionalModules = []) {
        return closure(new Set(
            this.findReferencedPackages(texSources, additionalModules)),
            pkg => this._pkgDeps(pkg));
    }

    dependencyGraph(pkgs) {
        const header = 'digraph {', footer = '}',
              edges = []
        for (let pkg of pkgs) {
            for (let dpkg of this._pkgDeps(pkg)) {
                edges.push(`"${pkg}" -> "${dpkg}";`);
            }
        }
        return [header, ...edges, footer].join('\n');
    }

    findReferencedPackages(texSources, additionalModules = []) {
        let moduleNames = [...this.expandModuleNames(texSources, additionalModules)]
                          .map(o => o.mod);
        return this.findPackagesByModules(moduleNames);
    }

    *expandModuleNames(texSources, additionalModules = []) {
        for (let texSource of texSources)
            yield* this.extractModuleReferences(texSource);

        for (let mod of additionalModules)
            yield {mod};
    }

    *extractModuleReferences(texSource) {
        for (let mo of texSource.matchAll(/\\(?:usepackage|documentclass)\s*(\[[^\]]*\])?\s*\{(.*?)\}/g)) {
            for (let mn of mo[2].split(','))
                yield {mod: mn.trim(), options: mo[1]};
        }
    }

    *findPackagesByModules(moduleNames) {
        for (let [pkg, info] of Object.entries(this.db.pkgs)) {
            if (!this._isExcluded(pkg) && info.provides && 
                moduleNames.some(req => info.provides.includes(req))) {
                yield pkg;
            }
        }
    }

    _isExcluded(pkg) { return pkg.match(/-dev$/); }
    _pkgDeps(pkg) {
        return (this.db.pkgs[pkg]?.deps ?? []).filter(pkg => !this._isExcluded(pkg));
    }
}


/**
 * Helper function to compute the closure of a set `s`
 * under an operation `tr`.
 * 
 * @template T
 * @param {Set<T>} s initial set
 * @param {(t: T) => T[]} tr operation functor
 * @return {Set<T>} the original set, updated
 */
 function closure(s, tr) {
    var wl = [...s];
    while (wl.length > 0) {
        var u = wl.shift();
        for (let v of tr(u))
            if (!s.has(v)) { s.add(v); wl.push(v); }
    }
    return s;
}

export { PackageRequirements }
