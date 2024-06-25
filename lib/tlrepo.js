#!/usr/bin/env node

/**
 * THIS IS OBSOLETE
 * 
 * tlprobe
 * 
 * Locates required packages in the TeXLive repository.
 */

import fs from 'fs';
import commander from 'commander';

const INDEX_URI = 'http://mirrors.ctan.org/systems/texlive/tlnet/tlpkg/texlive.tlpdb.xz';


async function main() {
    var opts = commander
        .parse();

    var lookFor = new RegExp(`/(${opts.args.join('|')})(\\.sty)?$`),
        matcher = //(...a) => matchLinesInIndex(INDEX_URI, ...a);
                  (...a) => matchFilesInRepo('/tmp/tldb.json', ...a);

    await matcher(lookFor, (current, line, mo) =>
        console.log(current.name));
        //console.log(` * [${current.name}]   ${line}  (${mo[1]})`));
}

async function matchFilesInRepo(tmpfn, lookFor, callback) {
    if (!fs.existsSync(tmpfn))
        await downloadIndexFromRepo(tmpfn);

    return await matchFilesInJSON(tmpfn, lookFor, callback);
}

async function downloadIndexFromRepo(outfn) {

    var outf = fs.createWriteStream(outfn);

    var spawn = spawn,
        ls    = require('child_process').spawn('tlmgr', ['list', '--json']);
    
    ls.stdout.pipe(outf);
    ls.stderr.pipe(process.stderr);
    
    return new Promise((resolve, reject) =>
        ls.on('close', function (code) {
            if (code == 0) resolve(outfn); else reject('tlmgr error');
        }));
}

async function matchFilesInJSON(filename, lookFor, callback) {
    var json = JSON.parse(fs.readFileSync(filename)), mo;
    for (let pkg of json) {
        for (let fn of pkg.runfiles) {
            if (mo = fn.match(lookFor))
                callback(pkg, fn, mo);
        }
    }
}

async function matchLinesInIndex(uri, lookFor, callback) {
    const fetch = require('node-fetch'),
          xz = require('xz'),
          lines = require('line-stream');

    var resp = await fetch(uri);

    var dec = new xz.Decompressor(),
        current = {};

    return new Promise(resolve =>
        resp.body.pipe(dec).pipe(lines('\n').on('data', line => {
            var t = line.toString('utf-8').trimRight(), mo;
            
            if (mo = t.match(/^name (.*)$/)) {
                current = {name: mo[1]};
            }
            else if (mo = t.match(lookFor)) {
                callback(current, t, mo);
            }
        }))
        .on('end', resolve));
}


main();
