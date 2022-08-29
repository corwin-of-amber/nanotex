import fs from 'fs';


class PackageRequirements {

    constructor(infoDB) { this.db = infoDB; }

    predictDeps(sources) {
        let moduleNames = [...this.expandModuleNames(sources)].map(o => o.mod);
        return this.findPackagesByModules(moduleNames);
    }

    *expandModuleNames(texSources, additionalModules = []) {
        for (let texSource of texSources)
            yield* this.extractModuleReferences(texSource);

        for (let mod of additionalModules)
            yield {mod};
    }

    *extractModuleReferences(texSource) {
        for (let mo of texSource.matchAll(/\\usepackage\s*(\[[^\]]*\])?\s*\{(.*?)\}/g)) {
            yield {mod: mo[2], options: mo[1]};
        }
    }

    *findPackagesByModules(moduleNames) {
        for (let [pkg, info] of Object.entries(this.db.pkgs)) {
            if (info.provides && 
                moduleNames.some(req => info.provides.includes(req))) {
                yield pkg;
            }
        }
    }
}


export { PackageRequirements }
