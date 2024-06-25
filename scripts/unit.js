#!/usr/bin/env node

import fs from 'fs';
import child_process from 'child_process';
import commander from 'commander';


function main() {
    var o = commander
        .description('unit-testing helper');

    o.parse(process.argv);

    for (let fn of o.args) {
        let prog = fn.endsWith('.ltx') ? 'pdflatex' : 'pdftex';
        if (fs.readFileSync(fn, 'utf-8').match(/documentclass/)) prog = 'pdflatex';
        try {
            child_process.execFileSync(`./bin/${prog}`,
                ['-interaction=nonstopmode', '-output-directory=tmp', fn],
                {stdio: 'inherit'});
        }
        catch (e) { console.log('command execution failed.'); break; }
    }
}


main();
