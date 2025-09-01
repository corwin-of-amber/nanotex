#!/usr/bin/env node

import fs from 'fs';
import path from 'path';


function getSplitPath() {
    return process.env['PATH'].split(path.delimiter);
}

function joinPath(pes) {
    return pes.join(path.delimiter);
}

function hasTeX(pe) {
    return hasExec(pe, 'mktexmf');
}

function hasExec(dir, fn) {
    let fp = path.join(dir, fn), s;
    try { s = fs.statSync(fp); }
    catch { return false; }

    return !s.isDirectory() && !!(s.mode & fs.constants.S_IXUSR);
}

export function filteredPath() {
    return getSplitPath().filter(pe => !hasTeX(pe));
}

export function envString() {
    return `PATH=${joinPath(filteredPath())}\n`;
}

