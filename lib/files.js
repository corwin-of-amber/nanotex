import fs from 'fs';
import assert from 'assert';


function ensureDir(d) { assert(d); fs.mkdirSync(d, {recursive: true}); return d; }
function readlines(filename) { return fs.readFileSync(filename, 'utf-8').split('\n'); }

function grepPrefix(filename, prefixes) {
    return readlines(filename).map(ln => {
        var m = prefixes.find(p => ln.startsWith(p));
        return m && {key: m, ln};
    }).filter(x => x);
}


export { ensureDir, readlines, grepPrefix }